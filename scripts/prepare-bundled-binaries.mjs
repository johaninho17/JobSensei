import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const buildResourcesDir = join(rootDir, "build-resources", "bin");

const MANIFEST_BASE = "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests";

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return response.json();
}

async function downloadFile(url, destPath) {
  await mkdir(dirname(destPath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${url}`);

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(destPath, buffer);
}

async function prepareWindows(targetDir) {
  const targetBinary = join(targetDir, "win", "agy.exe");
  if (existsSync(targetBinary)) {
    const s = await stat(targetBinary);
    if (s.size > 1_000_000) {
      console.log(`[prepare-binaries] Windows agy.exe already present (${Math.round(s.size / 1024 / 1024)} MB).`);
      return;
    }
  }
  console.log("[prepare-binaries] Fetching Windows agy manifest...");
  const manifest = await fetchJson(`${MANIFEST_BASE}/windows_amd64.json`);
  console.log(`[prepare-binaries] Downloading Windows agy v${manifest.version} from ${manifest.url}...`);
  await downloadFile(manifest.url, targetBinary);
  console.log(`[prepare-binaries] Windows agy.exe ready at ${targetBinary}`);
}

async function prepareMac(targetDir) {
  const targetBinary = join(targetDir, "mac", "agy");
  const antigravityBinary = join(targetDir, "mac", "antigravity");
  if (!existsSync(targetBinary) && existsSync(antigravityBinary)) {
    const { copyFile } = await import("node:fs/promises");
    await copyFile(antigravityBinary, targetBinary);
    await chmod(targetBinary, 0o755);
  }
  if (existsSync(targetBinary)) {
    const s = await stat(targetBinary);
    if (s.size > 1_000_000) {
      console.log(`[prepare-binaries] macOS agy already present (${Math.round(s.size / 1024 / 1024)} MB).`);
      return;
    }
  }
  console.log("[prepare-binaries] Fetching macOS agy manifest...");
  const arch = process.arch === "arm64" ? "darwin_arm64" : "darwin_amd64";
  const manifest = await fetchJson(`${MANIFEST_BASE}/${arch}.json`);
  console.log(`[prepare-binaries] Downloading macOS agy v${manifest.version} from ${manifest.url}...`);
  const archivePath = join(targetDir, "mac", "agy.tar.gz");
  await downloadFile(manifest.url, archivePath);

  // Extract tar.gz
  console.log("[prepare-binaries] Extracting macOS archive...");
  execFileSync("tar", ["-xzf", archivePath, "-C", join(targetDir, "mac")]);
  await unlink(archivePath).catch(() => {});

  // If extracted binary is named differently (e.g. agy or cli_mac_*), normalize to 'agy'
  const macBinDir = join(targetDir, "mac");
  const { copyFile, readdir, rename } = await import("node:fs/promises");
  const antigravityPath = join(macBinDir, "antigravity");
  if (existsSync(antigravityPath) && !existsSync(targetBinary)) {
    await copyFile(antigravityPath, targetBinary);
  }
  const files = await readdir(macBinDir);
  for (const file of files) {
    if (file !== "agy" && (file.startsWith("cli_") || file.startsWith("agy_"))) {
      await rename(join(macBinDir, file), targetBinary);
      break;
    }
  }

  if (existsSync(targetBinary)) {
    await chmod(targetBinary, 0o755);
    console.log(`[prepare-binaries] macOS agy ready at ${targetBinary}`);
  }
  if (existsSync(antigravityPath)) {
    await chmod(antigravityPath, 0o755);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const targetPlatform = args.find((a) => a.startsWith("--platform="))?.split("=")[1]
    || (process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "all");

  console.log(`[prepare-binaries] Preparing offline agy binary for: ${targetPlatform}`);

  try {
    if (targetPlatform === "win" || targetPlatform === "all") {
      await prepareWindows(buildResourcesDir);
    }
    if (targetPlatform === "mac" || targetPlatform === "all") {
      await prepareMac(buildResourcesDir);
    }
  } catch (err) {
    console.warn(`[prepare-binaries] Warning: Could not complete offline binary preparation: ${err.message}`);
    console.warn("[prepare-binaries] Continuing without offline binary cache (fallback to PATH/system).");
  }
}

main();
