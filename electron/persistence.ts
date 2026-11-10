import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

/**
 * A text file's contents, unpacked when it was saved compressed (gzip, as evidence snapshots are), so every reader
 * works with compressed and older uncompressed files alike.
 */
export async function readTextFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString("utf8");
}

/** Saves JSON compressed (gzip) under its usual name; read it back with `readTextFile` / `readJson`. */
export async function writeCompressedJsonAtomic<T>(path: string, value: T): Promise<void> {
  await writeBinaryAtomic(path, gzipSync(Buffer.from(JSON.stringify(value), "utf8"), { level: 6 }));
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readTextFile(path)) as T;
  } catch {
    return null;
  }
}

export async function writeJsonAtomic<T>(path: string, value: T): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export async function writeTextAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tempPath, value, "utf8");
  await rename(tempPath, path);
}

export async function writeBinaryAtomic(path: string, value: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tempPath, value);
  await rename(tempPath, path);
}
