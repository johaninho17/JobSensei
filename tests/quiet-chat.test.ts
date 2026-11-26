// #212: the Agy chat shows the conversation, not chrome.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("a quieter Agy chat (#212)", () => {
  it("has no greeting, engine tags, emoji, or keyword-scraped steps", async () => {
    const panel = await readFile("src/renderer/TerminalPanel.tsx", "utf8");
    for (const gone of ["AGY_GREETING", "JobSensei Copilot", "Sensei Copilot", "⚡", "🐚", "💬", "🖥️", "📄", "Executing steps", "CLI log", "newSteps", "job-actions-primary", "Inserts the request"]) expect(panel, gone).not.toContain(gone);
    expect(panel).toContain('entry.sender === "assistant" ? "Agy"');
    expect(panel).toContain('"Message Agy or paste a job link"');
  });
});
