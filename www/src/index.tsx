import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ITerminalAddon } from "@xterm/xterm";

import "./index.css";
import XTerm from "./xterm-for-react";
import { webShell } from "./web-shell";
import { DevWindow } from "./dev-window";
import { OpfsDebugger } from "./opfs-debugger";

// create component containing xterm and the addon
export class WebShellComponent extends React.Component {
  terminal: ITerminalAddon;
  constructor(props: {} | Readonly<{}>) {
    super(props);
    this.terminal = webShell("./binaries");
  }

  render() {
    return (
      <XTerm
        addons={[this.terminal]}
        options={{ fontSize: 15, fontFamily: "monospace" }}
      />
    );
  }
}

const App = () => {
  const [showExplorer, setShowExplorer] = useState(false);
  return (
    <div className="main-app">
      {/* Your actual React 19 + WASM Application Canvas */}
      <WebShellComponent />

      {/* Floating Developer Trigger */}
      {process.env["NODE_ENV"] === 'development' && (
        <button
          onClick={() => setShowExplorer(!showExplorer)}
          style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999, padding: '10px', borderRadius: '50%' }}
        >
          📦 OPFS
        </button>
      )}

      {/* Renders the inspector in a separate external screen! */}
      {showExplorer && (
        <DevWindow onClose={() => setShowExplorer(false)}>
          <OpfsDebugger />
        </DevWindow>
      )}
    </div>
  );
}

// initialize web shell component
const container = (window as any).__wasmShellMountPoint || document.getElementById("web-shell");
if (container) {
  const root = createRoot(container);
  root.render(<App />)
}
