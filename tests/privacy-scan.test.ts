import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Ledger W6: nothing personal or secret in tracked files. Generic patterns live here; personal names and
// employers live in the gitignored `dev-notes/privacy-terms.txt` (one term per line), so this test never leaks them.
const TEXT = /\.(?:ts|tsx|js|mjs|cjs|json|md|css|html|yml|yaml|txt)$/i;
const SKIP = /^(?:package-lock\.json|examples\/demo-workspace\/|docs\/archive\/)/;
const PATTERNS: Array<[string, RegExp]> = [
  ["email address", /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org)\b|anthropic\.com\b|users\.noreply\.github\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ["local user path", /(?:\/Users\/(?!someone\b|<)[A-Za-z0-9._-]+\/|C:\\Users\\(?!someone\b)[A-Za-z0-9._-]+\\)/],
  ["API key", /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[abp]-[A-Za-z0-9-]{10,})\b/],
  ["phone number (555 numbers are fictional)", /\(?\b(?!555)\d{3}\)?[ .-](?!555\b)\d{3}[ .-]\d{4}\b/],
];

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter((file) => file && TEXT.test(file) && !SKIP.test(file));
}

describe("privacy scan of tracked files", () => {
  it("finds no personal data or secrets", () => {
    const privateTermsPath = join(process.cwd(), "dev-notes", "privacy-terms.txt");
    const terms = existsSync(privateTermsPath)
      ? readFileSync(privateTermsPath, "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
      : [];
    const hits: string[] = [];
    for (const file of trackedFiles()) {
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const [label, pattern] of PATTERNS) if (pattern.test(text)) hits.push(`${file}: ${label}`);
      for (const term of terms) if (text.toLowerCase().includes(term.toLowerCase())) hits.push(`${file}: private term #${terms.indexOf(term) + 1}`);
    }
    expect(hits).toEqual([]);
  });
});
