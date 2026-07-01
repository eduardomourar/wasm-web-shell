import path from "node:path";
import { fileURLToPath } from "node:url";
import HtmlWebpackPlugin from "html-webpack-plugin";
import CopyWebpackPlugin from "copy-webpack-plugin";
import webpack from "webpack";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const ASSET_PATH = process.env.ASSET_PATH || "./";
const outputDir = path.resolve(dirname, "../extension/shell");

export default {
  mode: "development",
  entry: ["./src/index.tsx"],
  context: dirname,
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: [/node_modules/, /\.d\.ts$/],
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(dirname, "static", "index.html"),
      inject: true,
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "node_modules/aws-cli-wasm/component/aws.core*.wasm",
          to: path.resolve(outputDir, "[name][ext]"),
        },
        {
          from: "node_modules/coreutils-wasm/component/coreutils.core*.wasm",
          to: path.resolve(outputDir, "[name][ext]"),
        },
      ],
    }),
    new webpack.ContextReplacementPlugin(/aws-cli\/component/, /\.js$/),
    new webpack.ContextReplacementPlugin(/coreutils\/component/, /\.js$/),
  ],
  output: {
    filename: "main.js",
    path: outputDir,
    publicPath: ASSET_PATH,
    clean: true,
  },
  devtool: "source-map",
  devServer: {
    port: 8080,
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
    compress: false,
    static: false,
  },
  experiments: {
    asyncWebAssembly: true,
  },
};
