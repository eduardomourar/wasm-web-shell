# local-echo

Local echo controller for xterm.js - TypeScript implementation with paste fix.

## Features

- **TypeScript native** - Full type safety and modern ES modules
- **xterm.js v6 compatible** - Works with the latest xterm.js
- **Paste handling** - Bulk insert for pasted content to prevent visual duplication
- **Command history** - Arrow key navigation through command history
- **Line editing** - Full readline-like editing capabilities
- **Multi-line support** - Handle incomplete commands spanning multiple lines

## Origin

This is a TypeScript rewrite of [local-echo](https://github.com/wavesoft/local-echo) by Ioannis Charalampidis, with modifications for:

- TypeScript migration from JavaScript
- Removed autocomplete functionality (not needed)
- Fixed paste handling for long commands
- Updated for xterm.js v6 API compatibility
- Fixed cursor positioning on wrapped lines

## Usage

```typescript
import LocalEcho from "local-echo";
import { Terminal } from "@xterm/xterm";

const terminal = new Terminal();
const localEcho = new LocalEcho();

localEcho.activate(terminal);

// Read a line from the user
const input = await localEcho.read("$ ");
console.log("User entered:", input);
```

## API

### Constructor

```typescript
new LocalEcho(term?: Terminal | null, options?: { historySize?: number })
```

### Methods

- `activate(terminal: Terminal): void` - Attach to an xterm.js terminal
- `read(prompt: string): Promise<string>` - Read a line from the user
- `readChar(prompt: string): Promise<string>` - Read a single character
- `print(message: string): void` - Print text to the terminal
- `dispose(): Promise<void>` - Clean up resources

### Properties

- `history` - History controller instance for managing command history
- `term` - Reference to the xterm.js Terminal instance

## Key Fixes

### Paste Handling

Long pasted commands are handled as a single bulk insert instead of character-by-character, preventing visual duplication with wrapped lines.

### Cursor Positioning

Fixed `offsetToColRow` calculation to properly handle cursor positioning when text wraps to multiple lines. Changed wrap condition from `col > maxCols` to `col >= maxCols`.

## License

MIT - See LICENSE file for details
