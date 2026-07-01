// Type declarations for CSS imports
declare module "*.css" {
  const content: { [className: string]: string };
  export default content;
}

declare module "@xterm/xterm/css/xterm.css" {
  const content: any;
  export default content;
}

// Webpack public path override
declare let __webpack_public_path__: string;
