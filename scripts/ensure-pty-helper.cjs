const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const electronRoot = path.join(__dirname, "..", "node_modules", "electron");
const electronEntry = path.join(electronRoot, "path.txt");
if (!fs.existsSync(electronEntry)) {
  execFileSync(process.execPath, [path.join(electronRoot, "install.js")], { stdio: "inherit" });
}

if (process.platform === "darwin" || process.platform === "linux") {
  const helper = path.join(__dirname, "..", "node_modules", "node-pty", "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
}
