// Applies one Tune suggestion to a content file's Markdown (ledger U76, #117). Pure: text in, text out. Items are found
// the way the content check finds them (`contentItems`): a story bank section by its ID (`S3`), a table row by its
// first cell, a bullet by its first words under its section. Nothing is deleted outright: `replace` and `archive`
// return the old text so the runner keeps it in history.
import type { TuneSuggestion } from "../src/shared/tune-schemas";
import { contentItems, type ContentItem } from "./content-refresh";

export type ApplyResult = { ok: true; markdown: string; oldText: string | null } | { ok: false; reason: string };

const norm = (text: string) => text.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
const bulletBody = (line: string) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
const HEADING = /^(#{1,4})\s+(.*)$/;
const sameSection = (heading: string, section: string) => { const a = norm(heading); const b = norm(section); return a === b || a.startsWith(b) || b.startsWith(a); };

/** The item a suggestion points at, or null when it is gone or ambiguous. */
export function findTarget(file: string, markdown: string, section: string, target: string): ContentItem | null {
  const items = contentItems(file, markdown);
  const wanted = norm(target).replace(/^[-*+]\s+/, "");
  const byKey = items.find((item) => item.key.toLowerCase() === wanted || item.key === `row:${wanted}`);
  if (byKey) return byKey;
  const inSection = items.filter((item) => sameSection(item.section, section) && norm(bulletBody(item.text)).startsWith(wanted));
  if (inSection.length === 1) return inSection[0]!;
  const anywhere = items.filter((item) => norm(item.text).includes(wanted));
  return anywhere.length === 1 ? anywhere[0]! : null;
}

/** The new text shaped like the item it replaces: a bullet stays a bullet, a story keeps its heading. */
function shaped(text: string, like: ContentItem | null): string {
  if (/^\s*(?:#|\||[-*+]\s)/.test(text)) return text;
  if (!like) return `- ${text}`;
  if (like.text.startsWith("#")) return `${like.text.split("\n")[0]}\n${text}`;
  if (like.text.startsWith("|")) return text;
  return `${/^\s*(?:[-*+]|\d+[.)])\s+/.exec(like.text)?.[0] ?? "- "}${text}`;
}

function add(markdown: string, section: string, text: string): string {
  const lines = markdown.split("\n");
  const block = shaped(text, null);
  // A whole new section (a new story) goes at the end of the file.
  if (block.startsWith("#")) return `${markdown.replace(/\s*$/, "")}\n\n${block}\n`;
  const start = lines.findIndex((line) => { const heading = HEADING.exec(line); return heading ? sameSection(heading[2]!, section) : false; });
  if (start < 0) return `${markdown.replace(/\s*$/, "")}\n\n## ${section}\n\n${block}\n`;
  let end = lines.findIndex((line, index) => index > start && HEADING.test(line));
  if (end < 0) end = lines.length;
  const kind = block.startsWith("|") ? /^\s*\|/ : /^\s*(?:[-*+]|\d+[.)])\s+/;
  let at = -1;
  for (let index = start + 1; index < end; index++) if (kind.test(lines[index]!)) at = index;
  if (at < 0) { at = start; while (at + 1 < end && !lines[at + 1]!.trim()) at++; if (at === start) { lines.splice(start + 1, 0, ""); at = start + 1; } }
  lines.splice(at + 1, 0, block);
  return lines.join("\n");
}

/** Applies one checked suggestion. A target that is gone or ambiguous is reported, never guessed. */
export function applyTuneSuggestion(markdown: string, suggestion: Pick<TuneSuggestion, "operation" | "file" | "section" | "target" | "text">): ApplyResult {
  const text = markdown.replaceAll("\r\n", "\n");
  if (suggestion.operation === "add") {
    if (text.includes(suggestion.text!.trim())) return { ok: false, reason: "It is already in the file." };
    return { ok: true, markdown: add(text, suggestion.section, suggestion.text!), oldText: null };
  }
  const item = findTarget(suggestion.file, text, suggestion.section, suggestion.target!);
  if (!item) return { ok: false, reason: `"${suggestion.target}" is no longer in ${suggestion.file.split("/").pop()}, or matches more than one item.` };
  const index = text.indexOf(item.text);
  if (index < 0) return { ok: false, reason: `"${suggestion.target}" could not be found as written.` };
  if (suggestion.operation === "archive") {
    const after = text.slice(index + item.text.length).replace(/^\n/, "");
    return { ok: true, markdown: text.slice(0, index) + after, oldText: item.text };
  }
  return { ok: true, markdown: text.slice(0, index) + shaped(suggestion.text!, item) + text.slice(index + item.text.length), oldText: item.text };
}
