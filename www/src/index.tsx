import React from "react";
import { createRoot } from "react-dom/client";
import type { ITerminalAddon } from "xterm";

import "./index.css";
import XTerm from "./xterm-for-react";
import { webShell } from "./web-shell";

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

// initialize web shell component
const container = document.getElementById("web-shell");
if (container) {
  const root = createRoot(container);
  root.render(<WebShellComponent />);
}
