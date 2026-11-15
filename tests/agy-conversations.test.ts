// Agy page → Conversations (#34): listing a workspace's conversations, resuming by ID, deleting chosen ones.
// The stores are built here in Agy's own layout (one SQLite file per conversation), with fictional prompts.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { deleteConversations, listConversations, promptFrom, protobufStrings, ranIn } from "../electron/agy-conversations";
import { agyArgs } from "../electron/terminal";

const field = (number: number, value: Uint8Array) => Uint8Array.from([(number << 3) | 2, value.length, ...value]);
const text = (value: string) => new TextEncoder().encode(value);
const payload = (prompt: string) => Uint8Array.from([...field(1, text("c0393a55-8ad2-4438-89f8-0270e0faa9f4")), ...field(4, Uint8Array.from([...field(1, text(prompt)), ...field(2, text("execute_url(*)"))]))]);

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function home(entries: Array<{ id: string; folder: string; prompt: string }>) {
  const root = await mkdtemp(join(tmpdir(), "agy-conv-"));
  temps.push(root);
  const cli = join(root, ".gemini", "antigravity-cli");
  await mkdir(join(cli, "conversations"), { recursive: true });
  await mkdir(join(cli, "cache"), { recursive: true });
  for (const entry of entries) {
    const db = new DatabaseSync(join(cli, "conversations", `${entry.id}.db`));
    db.exec("CREATE TABLE steps (idx integer PRIMARY KEY, step_type integer, step_payload blob); CREATE TABLE trajectory_metadata_blob (id text PRIMARY KEY, data blob);");
    db.prepare("INSERT INTO steps VALUES (0, 14, ?)").run(payload(entry.prompt));
    db.prepare("INSERT INTO trajectory_metadata_blob VALUES ('main', ?)").run(Uint8Array.from([...field(1, text(`file://${entry.folder}`))]));
    db.close();
    await mkdir(join(cli, "brain", entry.id), { recursive: true });
  }
  const index = new DatabaseSync(join(cli, "conversation_summaries.db"));
  index.exec("CREATE TABLE conversation_summaries (conversation_id text PRIMARY KEY, preview text)");
  for (const entry of entries) index.prepare("INSERT INTO conversation_summaries VALUES (?, ?)").run(entry.id, entry.prompt);
  index.close();
  await writeFile(join(cli, "cache", "last_conversations.json"), JSON.stringify({ "/work/alex": entries[0]?.id, "/work/other": "kept-0000-id" }));
  return { root, cli };
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("Agy conversations", () => {
  it("reads the first prompt from Agy's step payload", () => {
    expect(promptFrom(protobufStrings(payload("Draft the application for Northstar Labs, Support Lead (job: northstar-support-lead)")))).toBe("Draft the application for Northstar Labs, Support Lead (job: northstar-support-lead)");
  });

  it("lists only this workspace's conversations, with their job", async () => {
    const { root } = await home([
      { id: A, folder: "/work/alex", prompt: "Draft the application for Northstar Labs, Support Lead (job: northstar-support-lead)" },
      { id: B, folder: "/work/alex/jobs/x", prompt: "Prepare the recruiter round" },
      { id: C, folder: "/work/alexandra", prompt: "Someone else's workspace" },
    ]);
    const list = await listConversations(root, "/work/alex");
    expect(list.map((entry) => entry.id).sort()).toEqual([A, B].sort());
    expect(list.find((entry) => entry.id === A)?.jobId).toBe("northstar-support-lead");
  });

  it("matches a folder, not a folder whose name only starts the same", () => {
    expect(ranIn("x\u0012file:///work/alex\u001a", "file:///work/alex")).toBe(true);
    expect(ranIn("file:///work/alexandra", "file:///work/alex")).toBe(false);
  });

  it("deletes only the chosen conversations and forgets them as the last one", async () => {
    const { root, cli } = await home([{ id: A, folder: "/work/alex", prompt: "First job here" }, { id: B, folder: "/work/alex", prompt: "Second job here" }]);
    expect(await deleteConversations(root, [A, "../../etc"])).toEqual([A]);
    expect(await stat(join(cli, "conversations", `${A}.db`)).catch(() => null)).toBeNull();
    expect(await stat(join(cli, "brain", A)).catch(() => null)).toBeNull();
    expect(await stat(join(cli, "conversations", `${B}.db`))).toBeTruthy();
    expect(JSON.parse(await readFile(join(cli, "cache", "last_conversations.json"), "utf8"))).toEqual({ "/work/other": "kept-0000-id" });
    const index = new DatabaseSync(join(cli, "conversation_summaries.db"), { readOnly: true });
    expect((index.prepare("SELECT conversation_id FROM conversation_summaries").all() as Array<{ conversation_id: string }>).map((row) => row.conversation_id)).toEqual([B]);
    index.close();
  });

  it("resumes a chosen conversation with Agy's own flag", () => {
    expect(agyArgs(false, true, A)).toEqual(["--sandbox", "--conversation", A]);
    expect(agyArgs(false, true)).toEqual(["--sandbox", "--continue"]);
    expect(agyArgs(true, false, null)).toEqual([]);
  });
});
