import type { Terminal } from "@xterm/xterm";

/**
 * Utility functions for terminal input handling
 */

function wordBoundaries(input: string, leftSide = true): number[] {
  const words: number[] = [];
  const rx = /\w+/g;
  let match: RegExpExecArray | null;

  while ((match = rx.exec(input))) {
    if (leftSide) {
      words.push(match.index);
    } else {
      words.push(match.index + match[0].length);
    }
  }

  return words;
}

function closestLeftBoundary(input: string, offset: number): number {
  const found = wordBoundaries(input, true)
    .reverse()
    .find((x) => x < offset);
  return found ?? 0;
}

function closestRightBoundary(input: string, offset: number): number {
  const found = wordBoundaries(input, false).find((x) => x > offset);
  return found ?? input.length;
}

function offsetToColRow(
  input: string,
  offset: number,
  maxCols: number
): { row: number; col: number } {
  let row = 0;
  let col = 0;

  for (let i = 0; i < offset; ++i) {
    const chr = input.charAt(i);
    if (chr === "\n") {
      col = 0;
      row += 1;
    } else {
      col += 1;
      if (col >= maxCols) {
        col = 0;
        row += 1;
      }
    }
  }

  return { row, col };
}

function countLines(input: string, maxCols: number): number {
  return offsetToColRow(input, input.length, maxCols).row + 1;
}

function isIncompleteInput(input: string): boolean {
  if (input.trim() === "") return false;

  // Check for dangling single quotes
  if ((input.match(/'/g) || []).length % 2 !== 0) return true;

  // Check for dangling double quotes
  if ((input.match(/"/g) || []).length % 2 !== 0) return true;

  // Check for dangling boolean or pipe operations
  if (input.split(/(\|\||\||&&)/g).pop()?.trim() === "") return true;

  // Check for trailing backslash
  if (input.endsWith("\\") && !input.endsWith("\\\\")) return true;

  return false;
}

interface PromptResolver {
  prompt: string;
  resolve: (value: string) => void;
  reject: (reason?: any) => void;
}

interface TermSize {
  cols: number;
  rows: number;
}

/**
 * LocalEcho - Local echo controller for xterm.js
 * Provides readline-like functionality with history support
 */
export default class LocalEcho {
  public term: Terminal | null = null;
  public history: any; // History controller instance

  private _disposables: Array<{ dispose: () => void }> = [];
  private _active = false;
  private _input = "";
  private _cursor = 0;
  private _activePrompt: PromptResolver | null = null;
  private _activeCharPrompt: PromptResolver | null = null;
  private _termSize: TermSize = { cols: 80, rows: 24 };

  constructor(term: Terminal | null = null, _options?: { historySize?: number }) {
    this.term = term;
  }

  /**
   * Detach from terminal
   */
  detach(): void {
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }

  /**
   * Attach to terminal
   */
  attach(): void {
    if (this.term?.onData && this.term?.onResize) {
      this._disposables.push(this.term.onData(this._handleTermData));
      this._disposables.push(this.term.onResize(this._handleTermResize));
    }
    this._termSize = {
      cols: this.term?.cols || 80,
      rows: this.term?.rows || 24,
    };
  }

  /**
   * Activate the terminal (for xterm addon compatibility)
   */
  activate(terminal: Terminal): void {
    this.term = terminal;
    this.attach();
  }

  /**
   * Dispose of resources
   */
  async dispose(): Promise<void> {
    this.detach();
  }

  /**
   * Read a line from the terminal
   */
  read(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.term?.write(prompt);
      this._activePrompt = { prompt, resolve, reject };
      this._active = true;
    });
  }

  /**
   * Read a single character
   */
  readChar(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.term?.write(prompt);
      this._activeCharPrompt = { prompt, resolve, reject };
      this._active = true;
    });
  }

  /**
   * Print text to terminal
   */
  print(message: string): void {
    const normInput = message.replace(/[\r\n]+/g, "\r\n");
    this.term?.write(normInput);
  }

  /**
   * Print and restart the prompt
   */
  printAndRestartPrompt(callback: () => void | Promise<void>): void {
    const cursor = this._cursor;

    // Complete input
    this.setCursor(this._input.length);
    this.term?.write("\r\n");

    // Prepare a function that will resume prompt
    const resume = () => {
      this.term?.write(this._activePrompt?.prompt || "");
      this.setInput(this._input);
      this.setCursor(cursor);
    };

    // Call the user callback
    const ret = callback();
    if (ret instanceof Promise) {
      ret.then(resume);
    } else {
      resume();
    }
  }

  /**
   * Print wide output (for autocomplete)
   */
  printWide(items: string[]): void {
    if (items.length === 0) return;

    const termWidth = this._termSize.cols;
    const itemWidth = Math.max(...items.map((e) => e.length)) + 2;
    const numCols = Math.floor(termWidth / itemWidth);
    const numRows = Math.ceil(items.length / numCols);

    let output = "";
    for (let row = 0; row < numRows; ++row) {
      let rowStr = "";
      for (let col = 0; col < numCols; ++col) {
        const i = col * numRows + row;
        if (i < items.length) {
          const item = items[i];
          rowStr += item.padEnd(itemWidth);
        }
      }
      output += rowStr + "\r\n";
    }

    this.print(output);
  }

  /**
   * Apply prompts to the given input
   */
  private applyPrompts(input: string): string {
    return (this._activePrompt?.prompt || "") + input;
  }

  /**
   * Get the prompt offset
   */
  private applyPromptOffset(_input: string, offset: number): number {
    return (this._activePrompt?.prompt.length || 0) + offset;
  }

  /**
   * Clear the current input
   */
  clearInput(): void {
    const currentPrompt = this.applyPrompts(this._input);
    const allRows = countLines(currentPrompt, this._termSize.cols);

    // Move cursor to the last line
    const { col } = offsetToColRow(
      currentPrompt,
      this._cursor + (this._activePrompt?.prompt.length || 0),
      this._termSize.cols
    );
    const moveUpRows = allRows - 1;

    for (let i = 0; i < moveUpRows; ++i) this.term?.write("\x1B[F");
    for (let i = 0; i < col; ++i) this.term?.write("\x1B[D");

    // Clear everything
    this.term?.write("\x1B[0J");
  }

  /**
   * Replace input with new input
   */
  setInput(newInput: string, clearInput = true): void {
    if (clearInput) this.clearInput();

    const newPrompt = this.applyPrompts(newInput);
    this.print(newPrompt);

    if (this._cursor > newInput.length) {
      this._cursor = newInput.length;
    }

    const newCursor = this.applyPromptOffset(newInput, this._cursor);
    const newLines = countLines(newPrompt, this._termSize.cols);
    const { col, row } = offsetToColRow(newPrompt, newCursor, this._termSize.cols);
    const moveUpRows = newLines - row - 1;

    this.term?.write("\r");
    for (let i = 0; i < moveUpRows; ++i) this.term?.write("\x1B[F");
    for (let i = 0; i < col; ++i) this.term?.write("\x1B[C");

    this._input = newInput;
  }

  /**
   * Set cursor position
   */
  setCursor(newCursor: number): void {
    if (newCursor < 0) newCursor = 0;
    if (newCursor > this._input.length) newCursor = this._input.length;

    const newCursorAbs = this.applyPromptOffset(this._input, newCursor);
    const oldCursorAbs = this.applyPromptOffset(this._input, this._cursor);

    const currentPrompt = this.applyPrompts(this._input);
    const { col: oldCol, row: oldRow } = offsetToColRow(
      currentPrompt,
      oldCursorAbs,
      this._termSize.cols
    );
    const { col: newCol, row: newRow } = offsetToColRow(
      currentPrompt,
      newCursorAbs,
      this._termSize.cols
    );

    // Move vertically
    if (oldRow > newRow) {
      for (let i = 0; i < oldRow - newRow; ++i) this.term?.write("\x1B[F");
    } else {
      for (let i = 0; i < newRow - oldRow; ++i) this.term?.write("\x1B[E");
    }

    // Move horizontally
    if (oldCol > newCol) {
      for (let i = 0; i < oldCol - newCol; ++i) this.term?.write("\x1B[D");
    } else {
      for (let i = 0; i < newCol - oldCol; ++i) this.term?.write("\x1B[C");
    }

    this._cursor = newCursor;
  }

  /**
   * Move cursor relative to current position
   */
  handleCursorMove(offset: number): void {
    this.setCursor(this._cursor + offset);
  }

  /**
   * Erase character at cursor
   */
  handleCursorErase(backspace: boolean): void {
    const { _cursor, _input } = this;
    if (backspace) {
      if (_cursor <= 0) return;
      const newInput = _input.substring(0, _cursor - 1) + _input.substring(_cursor);
      this.clearInput();
      this._cursor -= 1;
      this.setInput(newInput, false);
    } else {
      const newInput = _input.substring(0, _cursor) + _input.substring(_cursor + 1);
      this.setInput(newInput);
    }
  }

  /**
   * Insert character at cursor
   */
  handleCursorInsert(data: string): void {
    const { _cursor, _input } = this;
    const newInput = _input.substring(0, _cursor) + data + _input.substring(_cursor);
    this._cursor += data.length;
    this.setInput(newInput);
  }

  /**
   * Handle read completion
   */
  private handleReadComplete(): void {
    // Move cursor to end and write newline
    this.setCursor(this._input.length);
    this.term?.write("\r\n");

    if (this.history) {
      this.history.push(this._input);
    }
    if (this._activePrompt) {
      this._activePrompt.resolve(this._input);
      this._activePrompt = null;
    }
    this._active = false;
    this._input = "";
    this._cursor = 0;
  }

  /**
   * Handle terminal data (keyboard input)
   */
  private _handleTermData = (data: string): void => {
    if (!this._active) return;

    // Handle character prompts
    if (this._activeCharPrompt) {
      this._activeCharPrompt.resolve(data);
      this._activeCharPrompt = null;
      this.term?.write("\r\n");
      return;
    }

    // Handle paste operations - FIXED: Bulk insert to avoid visual duplication
    if (data.length > 3 && data.charCodeAt(0) !== 0x1b) {
      const cleanData = data.replace(/[\r\n]+/g, "");
      this.handleCursorInsert(cleanData);
      return;
    }

    // Handle single character input
    this.handleData(data);
  };

  /**
   * Handle a single character of data
   */
  handleData(data: string): void {
    if (!this._active) return;

    const ord = data.charCodeAt(0);
    let ofs: number | null;

    // Handle ANSI escape sequences
    if (ord === 0x1b) {
      switch (data.substring(1)) {
        case "[A": // Up arrow
          if (this.history) {
            const value = this.history.getPrevious();
            if (value) {
              this.setInput(value);
              this.setCursor(value.length);
            }
          }
          break;

        case "[B": // Down arrow
          if (this.history) {
            let value = this.history.getNext();
            if (!value) value = "";
            this.setInput(value);
            this.setCursor(value.length);
          }
          break;

        case "[D": // Left arrow
          this.handleCursorMove(-1);
          break;

        case "[C": // Right arrow
          this.handleCursorMove(1);
          break;

        case "[3~": // Delete
          this.handleCursorErase(false);
          break;

        case "[F": // End
          this.setCursor(this._input.length);
          break;

        case "[H": // Home
          this.setCursor(0);
          break;

        case "b": // ALT + LEFT
          ofs = closestLeftBoundary(this._input, this._cursor);
          if (ofs !== null) this.setCursor(ofs);
          break;

        case "f": // ALT + RIGHT
          ofs = closestRightBoundary(this._input, this._cursor);
          if (ofs !== null) this.setCursor(ofs);
          break;

        case "\x7F": // CTRL + BACKSPACE
          ofs = closestLeftBoundary(this._input, this._cursor);
          if (ofs !== null) {
            this.setInput(
              this._input.substring(0, ofs) + this._input.substring(this._cursor)
            );
            this.setCursor(ofs);
          }
          break;
      }
    }
    // Handle special characters
    else if (ord < 32 || ord === 0x7f) {
      switch (data) {
        case "\r": // ENTER
          if (isIncompleteInput(this._input)) {
            this.handleCursorInsert("\n");
          } else {
            this.handleReadComplete();
          }
          break;

        case "\x7F": // BACKSPACE
          this.handleCursorErase(true);
          break;

        case "\t": // TAB - just insert spaces, no autocomplete
          this.handleCursorInsert("    ");
          break;

        case "\x03": // CTRL+C
          this.setCursor(this._input.length);
          this.term?.write("^C\r\n" + (this._activePrompt?.prompt || ""));
          this._input = "";
          this._cursor = 0;
          if (this.history) this.history.rewind();
          break;
      }
    }
    // Handle visible characters
    else {
      this.handleCursorInsert(data);
    }
  }

  /**
   * Handle terminal resize
   */
  private _handleTermResize = (data: { rows: number; cols: number }): void => {
    const { rows, cols } = data;
    this.clearInput();
    this._termSize = { cols, rows };
    this.setInput(this._input, false);
  };
}
