// electron-builder afterPack hook: give unsigned macOS builds a valid ad-hoc signature.
// Without it, Electron's linker signature no longer matches the bundle, and a downloaded copy is
// reported as "damaged" with no way to open it. With a real Developer ID (CSC_LINK / CSC_NAME),
// electron-builder signs and this hook does nothing.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

exports.default = async function adhocSignMac(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  console.log(`  • ad-hoc signed ${app}`);
};
