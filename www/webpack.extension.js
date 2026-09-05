/**
 * Webpack config for building the extension's content script and background worker.
 *
 * Produces:
 * - content.js  (content script injected into Console pages)
 * - background.js (service worker handling credential fetches)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import webpack from "webpack";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(dirname, "../extension");

export default {
  mode: "development",
  entry: {
    content: "./src/extension/content.ts",
    background: "./src/extension/background.ts",
  },
  context: dirname,
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: [/node_modules/, /\.d\.ts$/],
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  plugins: [
    new webpack.IgnorePlugin({
      resourceRegExp: /^canvas$/
    })
  ],
  output: {
    filename: "[name].js",
    path: outputPath,
    clean: false,
  },
  devtool: "source-map",
  optimization: {
    splitChunks: false,
    runtimeChunk: false,
  },
};
