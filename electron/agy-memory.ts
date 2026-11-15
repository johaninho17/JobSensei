// Agy page → Memory (#41): what Agy remembers between conversations, and clearing it.
// Inspected 2026-11-15 on a scratch Agy home: Agy's own memory is its implicit memory, one binary file per item in
// `antigravity-cli/implicit/<id>.pb` (not readable as text, not tagged by folder). Saving memories or rules on purpose
// (`/learn`) is blocked in the app, because the app's Agy settings deny writes outside the workspace. A conversation's
// own record lives with that conversation (Agy page → Conversations). In the Recruiter Edition each candidate's
// memory is swapped in with their history (AGY_HISTORY_ENTRIES in agy-home.ts), so what is listed is the open one's.
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

export type AgyMemoryItem = { id: string; bytes: number; updatedAt: string };

const ID = /^[A-Za-z0-9-]{8,80}$/;
const implicitFolder = (agyHome: string) => join(agyHome, ".gemini", "antigravity-cli", "implicit");

/** Agy's memory items in this home, newest first. */
export async function listMemory(agyHome: string): Promise<AgyMemoryItem[]> {
  const folder = implicitFolder(agyHome);
  const items: AgyMemoryItem[] = [];
  for (const name of await readdir(folder).catch(() => [] as string[])) {
    const id = name.replace(/\.pb$/, "");
    if (!name.endsWith(".pb") || !ID.test(id)) continue;
    const info = await stat(join(folder, name)).catch(() => null);
    if (info?.isFile()) items.push({ id, bytes: info.size, updatedAt: info.mtime.toISOString() });
  }
  return items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** Deletes the chosen memory items (all of them when `ids` is "all"). Agy must be stopped. Returns what was removed. */
export async function deleteMemory(agyHome: string, ids: string[] | "all"): Promise<string[]> {
  const present = (await listMemory(agyHome)).map((item) => item.id);
  const chosen = ids === "all" ? present : ids.filter((id) => present.includes(id));
  for (const id of chosen) await rm(join(implicitFolder(agyHome), `${id}.pb`), { force: true });
  return chosen;
}
