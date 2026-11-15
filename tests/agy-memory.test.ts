// Agy page → Memory (#41): Agy's implicit memory items (one binary file each) listed and deleted. Scratch folders only.
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteMemory, listMemory } from "../electron/agy-memory";

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";

async function home() {
  const root = await mkdtemp(join(tmpdir(), "agy-mem-"));
  temps.push(root);
  const folder = join(root, ".gemini", "antigravity-cli", "implicit");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, `${A}.pb`), Buffer.alloc(400, 1));
  await writeFile(join(folder, `${B}.pb`), Buffer.alloc(200, 2));
  await writeFile(join(folder, "notes.txt"), "not a memory item");
  await utimes(join(folder, `${A}.pb`), new Date("2026-11-01"), new Date("2026-11-01"));
  return { root, folder };
}

describe("Agy memory", () => {
  it("lists memory items newest first, nothing else in the folder", async () => {
    const { root } = await home();
    expect((await listMemory(root)).map((item) => [item.id, item.bytes])).toEqual([[B, 200], [A, 400]]);
  });

  it("deletes only the chosen items, or all", async () => {
    const { root, folder } = await home();
    expect(await deleteMemory(root, [A, "../../x"])).toEqual([A]);
    expect((await readdir(folder)).sort()).toEqual([`${B}.pb`, "notes.txt"]);
    expect(await deleteMemory(root, "all")).toEqual([B]);
    expect(await readdir(folder)).toEqual(["notes.txt"]);
  });

  it("returns nothing for a home with no memory yet", async () => {
    expect(await listMemory(join(tmpdir(), "no-such-agy-home"))).toEqual([]);
  });
});
