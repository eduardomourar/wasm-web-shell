import { Terminal, ITerminalAddon } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import LocalEcho from "local-echo";
import { parse } from "shell-quote";

import History from "./history";
import LineBuffer from "./line-buffer";

export interface WasmFile {
  name: string;
  timestamp: number;
  bytes: Uint8Array;
}

export interface WasmModule {
  name: string;
  type: "wasi-preview2" | "component";
  module?: WebAssembly.Module;
}

type CommandCallback = (argv: string[], stdinPreset: string | null) => Promise<string> | AsyncGenerator<string> | string;

interface JsCommand {
  name: string;
  callback: CommandCallback;
  autocomplete?: () => string[];
}

interface ParsedCommand {
  argv: string[];
  redirect?: { path: string; append: boolean };
}

export default class WasmTerminal implements ITerminalAddon {
  public wasmBinaryPath: string;
  public isRunningCommand: boolean = false;

  // Lifecycle hooks
  public onActivated: () => void | Promise<void> = () => {};
  public onDisposed: () => void | Promise<void> = () => {};
  public onFileSystemUpdate: (files: WasmFile[]) => void | Promise<void> = () => {};
  public onBeforeCommandRun: () => void | Promise<void> = () => {};
  public onCommandRunFinish: () => void | Promise<void> = () => {};
  /** Called after a command whose stdout was redirected (`>`/`>>`) finishes running. */
  public onRedirectOutput: (path: string, data: string, append: boolean) => void | Promise<void> = () => {};

  // Internal state
  public _xterm?: Terminal;
  public _xtermEcho?: LocalEcho;
  public _xtermFitAddon?: FitAddon;
  private _xtermPrompt: () => Promise<string> = async () => "$ ";

  public _jsCommands: Map<string, JsCommand> = new Map();
  public _wasmModules: WasmModule[] = [];
  public _wasmFsFiles: WasmFile[] = [];

  private _stdoutBuffer?: LineBuffer;
  private _stderrBuffer?: LineBuffer;
  private _outputBuffer: string = "";
  private _lastOutputTime: number = 0;
  private _suppressOutputs: boolean = false;

  // Redirection (`>`/`>>`) state - when set, stdout is buffered instead of written to xterm
  private _redirectTarget: string | null = null;
  private _redirectAppend: boolean = false;
  private _redirectBuffer: string = "";

  constructor(wasmBinaryPath: string) {
    this.wasmBinaryPath = wasmBinaryPath;
  }

  /* xterm.js addon lifecycle */

  async activate(xterm: Terminal): Promise<void> {
    this._xterm = xterm;

    // Create xterm addon to fit size
    this._xtermFitAddon = new FitAddon();
    this._xtermFitAddon.activate(this._xterm);

    // Fit xterm size to container
    setTimeout(() => this._xtermFitAddon?.fit(), 1);

    // Handle container resize
    window.addEventListener("resize", () => {
      this._xtermFitAddon?.fit();
    });

    // Create xterm local echo addon (internalized with paste fix)
    this._xtermEcho = new LocalEcho(undefined, { historySize: 1000 });
    this._xtermEcho.activate(this._xterm);

    // Patch history controller
    this._xtermEcho.history = new History(this._xtermEcho.history?.size || 10);

    // Initialize stdout/stderr buffers - write directly to xterm to avoid circular calls
    this._stdoutBuffer = new LineBuffer((data) => {
      this._outputBuffer += data;
      this._lastOutputTime = Date.now();
      this._xterm?.write(data.replace(/\n/g, "\r\n"));
    });
    this._stderrBuffer = new LineBuffer((data) => {
      this._outputBuffer += data;
      this._lastOutputTime = Date.now();
      this._xterm?.write(data.replace(/\n/g, "\r\n"));
    });

    // Register default JS commands
    this.registerJsCommand("help", async () => {
      return "Available commands: " + Array.from(this._jsCommands.keys()).join(", ") + "\n";
    });

    this.registerJsCommand("clear", async () => {
      this._xterm?.clear();
      return await this.printWelcomeMessage();
    });

    // Register xterm data handler for Ctrl+C
    this._xterm.onData((data) => this._onXtermData(data));

    // Notify that we're ready
    await this.onActivated();

    // Write welcome message to terminal
    const welcomeMsg = await this.printWelcomeMessage();
    this._xterm.writeln(welcomeMsg);

    // Start REPL
    this.repl();

    // Focus terminal cursor
    setTimeout(() => this._xterm?.focus(), 1);
  }

  async dispose(): Promise<void> {
    await this._xtermEcho?.dispose();
    await this._xtermFitAddon?.dispose();
    await this.onDisposed();
  }

  /* JS command handling */

  registerJsCommand(name: string, callback: CommandCallback, autocomplete?: () => string[]): this {
    this._jsCommands.set(name, { name, callback, autocomplete });
    return this;
  }

  unregisterJsCommand(name: string): boolean {
    return this._jsCommands.delete(name);
  }

  get jsCommands(): Map<string, JsCommand> {
    return this._jsCommands;
  }

  /* REPL - Read Eval Print Loop */

  async repl(): Promise<void> {
    try {
      // Read
      const prompt = await this._xtermPrompt();
      const line = await this._xtermEcho!.read(prompt);

      // Empty input -> prompt again
      if (line.trim() === "") return this.repl();

      // Give user possibility to exec before run
      await this.onBeforeCommandRun();

      // Print newline before
      this._xterm!.write("\r\n");

      // Eval and print
      await this.runLine(line);

      // Flush any remaining buffered output
      this._stdoutBuffer?.flush();
      this._stderrBuffer?.flush();

      // Print extra newline if output doesn't end with one
      if (this._outputBuffer.slice(-1) !== "\n") {
        this._xterm!.write("\u23CE\r\n");
      }

      // Print newline after
      this._xterm!.write("\r\n");

      // Give user possibility to run after exec
      await this.onCommandRunFinish();

      // Loop
      this.repl();
    } catch (e) {
      console.error("Error during REPL:", e);
    }
  }

  /* Parse line as commands and handle them */

  private _parseCommands(line: string): ParsedCommand[] {
    let usesEnvironmentVars = false;
    let usesBashFeatures = false;

    // Parse line into tokens
    const commandLine = parse(line, (_key: string) => {
      usesEnvironmentVars = true;
      return undefined;
    });

    const commands: ParsedCommand[] = [];
    let cmd: string[] = [];
    let redirect: ParsedCommand["redirect"];

    const pushCommand = () => {
      commands.push(redirect ? { argv: cmd, redirect } : { argv: cmd });
      cmd = [];
      redirect = undefined;
    };

    for (let idx = 0; idx < commandLine.length; ++idx) {
      const item = commandLine[idx];

      if (typeof item === "string") {
        if (cmd.length === 0 && !redirect && item.match(/^\w+=.*$/)) {
          usesEnvironmentVars = true;
          continue;
        } else if (redirect && !redirect.path) {
          redirect.path = item;
        } else {
          cmd.push(item);
        }
      } else if (typeof item === "object" && "op" in item) {
        switch (item.op) {
          case "|":
            pushCommand();
            break;
          case ">":
            redirect = { path: "", append: false };
            break;
          case ">>":
            redirect = { path: "", append: true };
            break;
          default:
            usesBashFeatures = true;
            console.error("Unsupported shell operator:", item.op);
            break;
        }
      }
    }
    pushCommand();

    if (usesEnvironmentVars) {
      this.stderr("\x1b[1m[\x1b[33mWARN\x1b[39m]\x1b[0m Environment variables are not supported!\n");
    }
    if (usesBashFeatures) {
      this.stderr("\x1b[1m[\x1b[33mWARN\x1b[39m]\x1b[0m Advanced bash features are not supported! Only the pipe '|' and redirects '>'/'>>' work.\n");
    }

    return commands;
  }

  async runLine(line: string): Promise<void> {
    try {
      let stdinPreset: string | null = null;
      this._suppressOutputs = false;

      const commandsInLine = this._parseCommands(line);
      for (const [index, parsedCommand] of commandsInLine.entries()) {
        const { argv, redirect } = parsedCommand;
        const commandName = argv.shift();
        if (!commandName) continue;

        const command = this._jsCommands.get(commandName);

        // Try user registered JS commands first
        if (command?.callback) {
          if (redirect && !redirect.path) {
            this.stderr(`\x1b[1m[\x1b[31mERROR\x1b[39m]\x1b[0m Missing redirect target after '${redirect.append ? ">>" : ">"}'\n`);
            continue;
          }

          // Buffer stdout instead of writing to xterm while a redirect is active
          if (redirect) {
            this._redirectTarget = redirect.path;
            this._redirectAppend = redirect.append;
            this._redirectBuffer = "";
          }

          const result = command.callback(argv, stdinPreset);
          let output: string;

          try {
            // Await promises
            if (result && typeof result === "object" && "then" in result) {
              output = ((await result) || "").toString();
            }
            // Await yielding generator functions
            else if (result && typeof result === "object" && "next" in result) {
              let tempOutput = "";
              for await (const data of result as AsyncGenerator<string>) {
                tempOutput += data;
              }
              output = tempOutput;
            }
            // Default: when functions return normally
            else {
              output = result.toString();
            }
          } finally {
            if (redirect) {
              await this.onRedirectOutput(redirect.path, this._redirectBuffer, redirect.append);
              this._redirectTarget = null;
              this._redirectBuffer = "";
            }
          }

          // If is last command in pipe -> print output to xterm (unless redirected to a file)
          if (index === commandsInLine.length - 1) {
            if (!redirect) this.stdout(output);
          } else {
            stdinPreset = output || null;
          }
        }
        // Command not found
        else {
          this.stderr(`\x1b[1m[\x1b[31mERROR\x1b[39m]\x1b[0m Command not found: ${commandName}\n`);
        }
      }
    } catch (e) {
      // Catch errors
      if (this._outputBuffer.slice(-1) !== "\n") this.stderr("\n");
      this.stderr(`\x1b[1m[\x1b[31mERROR\x1b[39m]\x1b[0m ${e}\n`);
      console.error("Error running line:", e);
    }
  }

  /* Output handling */

  stdout(data: string): void {
    if (this._suppressOutputs) return;
    // While a redirect ('>'/'>>') is active, capture stdout instead of writing to xterm
    if (this._redirectTarget !== null) {
      this._redirectBuffer += data;
      return;
    }
    // Write to buffer which handles line buffering and outputs to xterm
    this._stdoutBuffer?.write(data);
  }

  stderr(data: string): void {
    if (this._suppressOutputs) return;
    // Write to buffer which handles line buffering and outputs to xterm
    this._stderrBuffer?.write(data);
  }

  private _onXtermData(data: string): void {
    // Handle Ctrl+C
    if (data === "\x03") {
      this._xterm?.write("^C\r\n");
      this.repl();
    }
  }

  /* Utilities */

  async printWelcomeMessage(): Promise<string> {
    return "WebAssembly Terminal Ready\r\nType 'help' for available commands.\r\n\r\n";
  }

  async _waitForOutputPause(timeout: number = 100): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (Date.now() - this._lastOutputTime > timeout) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
  }

  /* WASM module management - WASI Preview2 components */

  async _getOrFetchWasmModule(programName: string): Promise<WasmModule> {
    // Check if module already loaded
    let wasmModule = this._wasmModules.find((m) => m.name === programName);
    if (wasmModule?.module) return wasmModule;

    // Try to fetch WASM component binary
    try {
      const response = await fetch(`${this.wasmBinaryPath}/${programName}.wasm`);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${programName}.wasm`);
      }

      const wasmBinary = await response.arrayBuffer();
      if (!WebAssembly.validate(wasmBinary)) {
        throw new Error(`Invalid WASM binary: ${programName}`);
      }

      // WASI Preview2 components are standard WebAssembly modules
      const module = await WebAssembly.compile(wasmBinary);
      wasmModule = { name: programName, type: "wasi-preview2", module };
      this._wasmModules.push(wasmModule);

      return wasmModule;
    } catch (e) {
      throw new Error(`Unable to find WASI component for command ${programName}: ${e}`);
    }
  }
}
