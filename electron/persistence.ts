import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJsonAtomic<T>(path: string, value: T): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${path.split("/").pop()}.tmp-${process.pid}-${randomUUID()}`);
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export async function writeTextAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${path.split("/").pop()}.tmp-${process.pid}-${randomUUID()}`);
  await writeFile(tempPath, value, "utf8");
  await rename(tempPath, path);
}

export async function writeBinaryAtomic(path: string, value: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${path.split("/").pop()}.tmp-${process.pid}-${randomUUID()}`);
  await writeFile(tempPath, value);
  await rename(tempPath, path);
}
