import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The app shell and the page files split out of it (issue #29), in one string, for tests that check source text. */
export const RENDERER_PAGE_FILES = ["App", "app-shared", "JobsHome", "JobWorkspace", "SetupAndContext", "InterviewsHome", "Documents", "TerminalPanel"];

export async function rendererPagesSource(root = process.cwd()): Promise<string> {
  const parts = await Promise.all(RENDERER_PAGE_FILES.map((name) => readFile(join(root, "src/renderer", `${name}.tsx`), "utf8")));
  return parts.join("\n");
}
