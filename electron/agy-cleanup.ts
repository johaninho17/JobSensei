// One-time clean-up of background Agy conversations made before the app started recording them
// (`recordHeadlessConversation` in agy-home.ts). Only conversations whose first prompt is one the app's background runs
// send (Job Search, light rating, written answers) are listed; the terminal's own application runs are never touched.
// Dry run by default: `node dist-electron/electron/agy-cleanup.js <agyHome> [--days 14] [--apply]`.
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/** Opening words of the prompts the app's headless runs send (owned by buildSearchPrompt, buildRatingPrompt, buildQuestionPrompt). */
export const HEADLESS_PROMPT_OPENINGS = ["Find up to", "Rate how well this candidate", "You are helping the candidate with the written questions"];

export async function legacyHeadlessConversations(agyHome: string, options: { olderThanDays?: number; now?: Date } = {}): Promise<Array<{ id: string; kind: string; modifiedAt: string; bytes: number }>> {
  const { olderThanDays = 14, now = new Date() } = options;
  const folder = join(agyHome, ".gemini", "antigravity-cli", "conversations");
  const out: Array<{ id: string; kind: string; modifiedAt: string; bytes: number }> = [];
  for (const name of (await readdir(folder).catch(() => [] as string[])).filter((entry) => entry.endsWith(".db"))) {
    const path = join(folder, name);
    const info = await stat(path).catch(() => null);
    if (!info || now.getTime() - info.mtimeMs < olderThanDays * 86_400_000) continue;
    // SQLite stores the prompt text as plain bytes; the first app opening found names the kind of run.
    const text = (await readFile(path)).toString("latin1");
    const hits = HEADLESS_PROMPT_OPENINGS.map((opening) => [opening, text.indexOf(opening)] as const).filter(([, index]) => index >= 0).sort((a, b) => a[1] - b[1]);
    if (!hits.length) continue;
    out.push({ id: name.slice(0, -3), kind: hits[0]![0], modifiedAt: info.mtime.toISOString(), bytes: info.size });
  }
  return out;
}

export async function removeConversations(agyHome: string, ids: string[]): Promise<void> {
  const cli = join(agyHome, ".gemini", "antigravity-cli");
  for (const id of ids) {
    if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) continue;
    for (const path of [join(cli, "conversations", `${id}.db`), join(cli, "conversations", `${id}.db-shm`), join(cli, "conversations", `${id}.db-wal`), join(cli, "annotations", `${id}.pbtxt`), join(cli, "brain", id)]) {
      await rm(path, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  const [agyHome, ...rest] = process.argv.slice(2);
  if (!agyHome) { console.error("Usage: agy-cleanup <agyHome> [--days 14] [--apply]"); process.exit(2); }
  const daysIndex = rest.indexOf("--days");
  const days = daysIndex >= 0 ? Number(rest[daysIndex + 1]) : 14;
  void legacyHeadlessConversations(agyHome, { olderThanDays: days }).then(async (found) => {
    const total = found.reduce((sum, entry) => sum + entry.bytes, 0);
    const byKind = found.reduce<Record<string, number>>((counts, entry) => ({ ...counts, [entry.kind]: (counts[entry.kind] ?? 0) + 1 }), {});
    console.log(JSON.stringify({ count: found.length, megabytes: Math.round(total / 1e5) / 10, byKind }, null, 2));
    if (rest.includes("--apply")) { await removeConversations(agyHome, found.map((entry) => entry.id)); console.log(`Removed ${found.length}.`); }
    else console.log("Dry run: nothing removed. Add --apply to remove these.");
  });
}
