// Agy's past conversations for the open workspace (Agy page → Conversations, issue #34): list them with their first
// prompt, date, and job; delete chosen ones. Resuming one is Agy's own `--conversation <id>` flag (terminal.ts).
// Each conversation is one SQLite file in the Agy home (`antigravity-cli/conversations/<id>.db`, read with Node's
// built-in SQLite); its first step holds the prompt, and its metadata names the folder it ran in.
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type AgyConversation = {
  id: string;
  /** The first thing asked, shortened. */
  prompt: string;
  /** The job it was about, when its prompt names one (`(job: <id>)`). */
  jobId: string | null;
  startedAt: string;
  lastUsedAt: string;
  /** Started by the app in the background (Job Search, ratings, written answers), not in the Agy panel. */
  background: boolean;
};

const ID = /^[A-Za-z0-9-]{8,80}$/;
const cliFolder = (agyHome: string) => join(agyHome, ".gemini", "antigravity-cli");

/** Strings in a protobuf message, in order, looking inside nested messages. */
export function protobufStrings(bytes: Uint8Array, depth = 0): string[] {
  const out: string[] = [];
  let at = 0;
  const varint = (): number | null => {
    let value = 0;
    let shift = 0;
    while (at < bytes.length && shift < 50) {
      const byte = bytes[at++]!;
      value += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return value;
      shift += 7;
    }
    return null;
  };
  while (at < bytes.length) {
    const key = varint();
    if (key === null) break;
    const wire = key % 8;
    if (wire === 0) { if (varint() === null) break; continue; }
    if (wire === 1) { at += 8; continue; }
    if (wire === 5) { at += 4; continue; }
    if (wire !== 2) break;
    const length = varint();
    if (length === null || length < 0 || at + length > bytes.length) break;
    const field = bytes.subarray(at, at + length);
    at += length;
    const nested = depth < 6 && length > 1 ? protobufStrings(field, depth + 1) : [];
    const text = new TextDecoder("utf-8", { fatal: false }).decode(field);
    if (nested.length && !/^[\p{L}\p{N}\p{P}\p{Zs}\n\t]+$/u.test(text)) out.push(...nested);
    else if (/^[\p{L}\p{N}\p{P}\p{S}\p{Zs}\n\t]+$/u.test(text)) out.push(text);
    else out.push(...nested);
  }
  return out;
}

/** The prompt among a user step's strings: the first one that reads as words, not an ID or a permission rule. */
export function promptFrom(strings: string[]): string | null {
  return strings.find((value) => /\s/.test(value.trim()) && value.trim().length > 3 && !/^[0-9a-f-]{32,36}$/i.test(value) && !/^[a-z_]+\(.*\)$/.test(value)) ?? null;
}

async function background(agyHome: string): Promise<Set<string>> {
  try {
    const ledger = JSON.parse(await readFile(join(cliFolder(agyHome), "jobsensei-headless.json"), "utf8")) as { conversations?: Record<string, string> };
    return new Set(Object.keys(ledger.conversations ?? {}));
  } catch { return new Set(); }
}

/** Whether metadata names this folder (or a folder inside it), not a folder whose name only starts the same. */
export function ranIn(metadata: string, folderUrl: string): boolean {
  for (let at = metadata.indexOf(folderUrl); at >= 0; at = metadata.indexOf(folderUrl, at + 1)) {
    const next = metadata.charAt(at + folderUrl.length);
    if (next === "" || next === "/" || next < " ") return true;
  }
  return false;
}

/** The workspace's conversations, newest first. */
export async function listConversations(agyHome: string, workspacePath: string): Promise<AgyConversation[]> {
  const { DatabaseSync } = await import("node:sqlite");
  const folder = join(cliFolder(agyHome), "conversations");
  const headless = await background(agyHome);
  const places = [`file://${workspacePath}`, pathToFileURL(workspacePath).href].map((place) => place.replace(/\/$/, ""));
  const out: AgyConversation[] = [];
  for (const name of (await readdir(folder).catch(() => [] as string[])).filter((entry) => entry.endsWith(".db"))) {
    const id = name.slice(0, -3);
    if (!ID.test(id)) continue;
    const path = join(folder, name);
    let prompt: string | null = null;
    let inWorkspace = false;
    try {
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        const meta = db.prepare("SELECT data FROM trajectory_metadata_blob LIMIT 1").get() as { data?: Uint8Array } | undefined;
        const where = meta?.data ? Buffer.from(meta.data).toString("utf8") : "";
        inWorkspace = places.some((place) => ranIn(where, place));
        const first = db.prepare("SELECT step_payload FROM steps WHERE step_type = 14 ORDER BY idx LIMIT 1").get() as { step_payload?: Uint8Array } | undefined;
        if (first?.step_payload) prompt = promptFrom(protobufStrings(first.step_payload));
      } finally { db.close(); }
    } catch { continue; }
    if (!inWorkspace) continue;
    const info = await stat(path).catch(() => null);
    if (!info) continue;
    const text = (prompt ?? "").replace(/\s+/g, " ").trim();
    out.push({
      id,
      prompt: text ? (text.length > 140 ? `${text.slice(0, 139)}…` : text) : "(no prompt yet)",
      jobId: text.match(/\(job:\s*([A-Za-z0-9._-]+)\)/)?.[1] ?? null,
      startedAt: (info.birthtimeMs ? info.birthtime : info.mtime).toISOString(),
      lastUsedAt: info.mtime.toISOString(),
      background: headless.has(id),
    });
  }
  return out.sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
}

/** Whether a conversation with this ID exists in the home (so a resume never starts Agy on a made-up ID). */
export async function conversationExists(agyHome: string, id: string): Promise<boolean> {
  return ID.test(id) && Boolean(await stat(join(cliFolder(agyHome), "conversations", `${id}.db`)).catch(() => null));
}

/** Deletes conversations (their database, annotations, and brain folder) and forgets them as "last". Agy must be stopped. */
export async function deleteConversations(agyHome: string, ids: string[]): Promise<string[]> {
  const cli = cliFolder(agyHome);
  const removed: string[] = [];
  for (const id of ids.filter((value) => ID.test(value))) {
    for (const path of [join(cli, "conversations", `${id}.db`), join(cli, "conversations", `${id}.db-shm`), join(cli, "conversations", `${id}.db-wal`), join(cli, "annotations", `${id}.pbtxt`), join(cli, "brain", id), join(cli, "implicit", `${id}.pb`)]) {
      await rm(path, { recursive: true, force: true });
    }
    removed.push(id);
  }
  // "Most recent conversation" per folder (used by --continue) must not point at a deleted one.
  const lastPath = join(cli, "cache", "last_conversations.json");
  try {
    const last = JSON.parse(await readFile(lastPath, "utf8")) as Record<string, string>;
    const kept = Object.fromEntries(Object.entries(last).filter(([, id]) => !removed.includes(id)));
    if (Object.keys(kept).length !== Object.keys(last).length) await writeFile(lastPath, `${JSON.stringify(kept, null, 2)}\n`);
  } catch { /* no record yet */ }
  try {
    const ledgerPath = join(cli, "jobsensei-headless.json");
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as { conversations?: Record<string, string> };
    for (const id of removed) delete ledger.conversations?.[id];
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  } catch { /* no ledger */ }
  return removed;
}
