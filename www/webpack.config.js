import path from "node:path";
import { fileURLToPath } from "node:url";
import HtmlWebpackPlugin from "html-webpack-plugin";
import CopyWebpackPlugin from "copy-webpack-plugin";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const ASSET_PATH = process.env.ASSET_PATH || "./";

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
        use: 'ts-loader',
        exclude: /node_modules/,
      }
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(dirname, "static", "index.html"),
      inject: true,
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(dirname, "node_modules/**/aws*.wasm"),
          to: path.resolve(dirname, "dist", "[name][ext]"),
        },
        { 
          from: path.resolve(dirname, "static", "binaries"),
          to: path.resolve(dirname, "dist", "binaries"),
        },
      ],
    }),
  ],
  output: {
    filename: "main.js",
    path: path.resolve(dirname, "dist"),
    publicPath: ASSET_PATH,
  },
  devtool: "source-map",
  devServer: {
    port: 8080,
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin"
    },
    https: true,
    compress: false,
    static: false,
    // static: {
    //   directory: path.join(dirname, 'dist'),
    // },
  },
  experiments: {
    asyncWebAssembly: true,
    // topLevelAwait: true,
  },
};
