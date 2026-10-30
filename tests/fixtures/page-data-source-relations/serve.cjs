const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");
const webpack = require("next/dist/compiled/webpack/webpack-lib");

// A development-only component fixture. Never imports environment files or starts a backend.
const root = path.resolve(__dirname, "../../..");
const output = path.join(root, ".agentic/verification/page-data-source-relation-fixture");
const compiler = webpack({
  mode: "development",
  entry: path.join(__dirname, "entry.jsx"),
  output: { path: output, filename: "bundle.js" },
  resolve: { extensions: [".tsx", ".ts", ".jsx", ".js"], alias: { "@": path.join(root, "src") } },
  module: { rules: [
    { test: /\.[jt]sx?$/, exclude: /node_modules/, use: path.join(__dirname, "../named-boards/ts-loader.cjs") },
    { test: /\.css$/, use: path.join(__dirname, "../named-boards/css-loader.cjs") },
  ] },
  devtool: false,
});
compiler.run((error, stats) => {
  compiler.close(() => {});
  if (error || stats.hasErrors()) {
    console.error(error || stats.toString({ all: false, errors: true }));
    process.exitCode = 1;
    return;
  }
  const bundle = fs.readFileSync(path.join(output, "bundle.js"));
  const server = http.createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/bundle.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.end(bundle);
    } else if (req.url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page data-source relation fixture</title><style>body{font:14px system-ui;margin:16px;color:#202c42}*{box-sizing:border-box}main{max-width:1000px;margin:auto}button{margin:4px}output{display:block}</style><div id="root"></div><script src="/bundle.js"></script></html>');
    } else {
      res.writeHead(404).end();
    }
  });
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  server.listen(3123, "127.0.0.1", () => console.log("Page data-source relation fixture: http://127.0.0.1:3123 (Ctrl+C to stop)"));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
});
