// Markdown to sanitized HTML for document and interview views.
import type { QuestionEntry } from "./question-navigation";

export function sanitizeHtml(value: string): string {
  const document = new DOMParser().parseFromString(value, "text/html");
  document.querySelectorAll("script, iframe, object, embed, link, style").forEach((element) => element.remove());
  document.querySelectorAll("*").forEach((element) => [...element.attributes].forEach((attribute) => { if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name); }));
  return document.body.innerHTML;
}

export function normalizedCodeLanguage(value: string): string {
  const language = value.trim().toLowerCase().split(/\s+/)[0] ?? "";
  const aliases: Record<string, string> = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", sh: "bash", shell: "bash", zsh: "bash", yml: "yaml", ps1: "powershell" };
  return (aliases[language] ?? language) || "text";
}

export function inferCodeLanguage(value: string): string {
  if (/\b(?:interface|type)\s+[A-Z]|\b(?:const|let)\s+\w+\s*(?::[^=]+)?=|=>/.test(value)) return "typescript";
  if (/^\s*(?:def|from|import)\s+/m.test(value)) return "python";
  if (/\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE TABLE)\b/i.test(value)) return "sql";
  if (/\b(?:param|Write-Host|Get-ChildItem|New-Item)\b|\$[A-Za-z][\w-]*/.test(value)) return "powershell";
  if (/^\s*(?:#!.*(?:ba|z|k)?sh|export\s+|(?:npm|git|curl|rg)\s+)/m.test(value)) return "bash";
  return "text";
}

export function highlightCode(value: string, language: string, escape: (value: string) => string): string {
  const keywords: Record<string, string[]> = {
    javascript: ["const", "let", "var", "function", "return", "async", "await", "if", "else", "for", "while", "class", "new", "import", "export", "from", "try", "catch", "throw"],
    typescript: ["const", "let", "function", "return", "async", "await", "if", "else", "for", "interface", "type", "class", "new", "import", "export", "from", "extends", "implements"],
    python: ["def", "return", "async", "await", "if", "elif", "else", "for", "while", "class", "import", "from", "try", "except", "raise", "with", "as", "in"],
    bash: ["if", "then", "else", "fi", "for", "do", "done", "case", "esac", "function", "export"],
    powershell: ["function", "param", "if", "else", "foreach", "return", "throw", "try", "catch", "switch"],
    sql: ["select", "from", "where", "join", "on", "group", "by", "order", "insert", "update", "delete", "create", "table", "as", "and", "or"],
  };
  const keywordSet = new Set((keywords[language] ?? []).map((keyword) => keyword.toLowerCase()));
  const tokenPattern = /(\/\/[^\n]*|#[^\n]*|--[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
  let output = "";
  let cursor = 0;
  for (const match of value.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    const token = match[0];
    output += escape(value.slice(cursor, index));
    const lower = token.toLowerCase();
    const tokenClass = /^(?:\/\/|#|--)/.test(token) ? "comment" : /^["'`]/.test(token) ? "string" : /^\d/.test(token) ? "number" : keywordSet.has(lower) ? "keyword" : "identifier";
    output += `<span class="syntax-${tokenClass}">${escape(token)}</span>`;
    cursor = index + token.length;
  }
  return output + escape(value.slice(cursor));
}

/** Evidence IDs (`context:work:imports`) and story IDs (`S2`) in prose. */
const EVIDENCE_ID = /`?\b[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9.+-]*){2,}\b`?/gi;
const STORY_ID_IN_PARENS = /\(\s*((?:S\d{1,2}|`?[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9.+-]*){2,}`?)(?:\s*[,;]\s*(?:S\d{1,2}|`?[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9.+-]*){2,}`?))*)\s*\)/g;
const FIT_WORD = /^(met|learnable|gap|blocker|partial|direct|strong|adjacent|unclear)$/i;

export type MarkdownOptions = {
  /**
   * Reading view for generated prep and research: sources become a small "source" link, story and evidence IDs move
   * into a hover marker, and fit words in table cells become badges. Documents opened for editing keep the raw text.
   */
  readable?: boolean;
};

export function markdownHtml(markdown: string, questionEntries: QuestionEntry[] = [], options: MarkdownOptions = {}): string {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const formatted = (value: string) => escape(value).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  const inline = (value: string) => {
    if (!options.readable) return formatted(value);
    const ids: string[] = [];
    const sources: string[] = [];
    let text = value
      // "(source: https://…, accessed 2026-10-25)" or "(https://…, accessed …)" → a short link after the text.
      .replace(/(?<!\])\s*\((?:source:\s*)?(https?:\/\/[^\s,)]+)[^)]*\)/gi, (_whole, url: string) => { sources.push(url); return ""; })
      .replace(/\s*\(source:\s*original_jd\.md\)/gi, () => { sources.push("posting"); return ""; })
      .replace(STORY_ID_IN_PARENS, (_whole, inner: string) => { ids.push(...inner.split(/\s*[,;]\s*/).map((id) => id.replace(/`/g, ""))); return ""; })
      .replace(EVIDENCE_ID, (id) => { ids.push(id.replace(/`/g, "")); return ""; })
      .replace(/\(\s*[,;]?\s*\)/g, "")
      .replace(/\s+([.,;:])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
    // A table cell holding only a story ID.
    if (/^S\d{1,2}$/.test(text)) { ids.push(text); text = ""; }
    const fit = FIT_WORD.exec(text.replace(/[*_`]/g, ""));
    let html = fit ? `<span class="fit-chip is-${fit[1]!.toLowerCase()}">${escape(fit[1]!.toLowerCase())}</span>` : formatted(text).replace(/⚠ Fill in Settings[^<]*/g, (match) => `<span class="warn-chip">${match}</span>`);
    for (const source of sources) html += source === "posting"
      ? ' <span class="src-link" title="From the job posting">posting</span>'
      : ` <a class="src-link" href="${escape(source)}" title="${escape(source)}">source</a>`;
    if (ids.length) html += ` <span class="evid" title="${escape([...new Set(ids)].join(", "))}" aria-label="Evidence: ${escape([...new Set(ids)].join(", "))}">ⓘ</span>`;
    return html;
  };
  const tableCells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  const isTableSeparator = (row: string | undefined) => Boolean(row && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(row));
  const output: string[] = [];
  let list: "ul" | "ol" | null = null;
  let code = false;
  let codeLanguage = "text";
  let codeLines: string[] = [];
  const closeList = () => { if (list) { output.push(`</${list}>`); list = null; } };
  const questionIds = new Map(questionEntries.map((question) => [question.lineIndex, question.id]));
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  let tableEnd = -1;
  for (const [lineIndex, line] of lines.entries()) {
    if (lineIndex <= tableEnd) continue;
    // Pipe table: a header row, a separator row, then body rows until a line that is not a row.
    if (!code && /^\s*\|/.test(line) && isTableSeparator(lines[lineIndex + 1])) {
      closeList();
      let end = lineIndex + 2;
      while (end < lines.length && /^\s*\|/.test(lines[end]!)) end += 1;
      const head = tableCells(line).map((cell) => `<th>${inline(cell)}</th>`).join("");
      const body = lines.slice(lineIndex + 2, end).map((row) => `<tr>${tableCells(row).map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("");
      output.push(`<div class="md-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
      tableEnd = end - 1;
      continue;
    }
    if (line.trim().startsWith("```")) { if (code) { const codeValue = codeLines.join("\n"); output.push(`<div class="code-block language-${codeLanguage}"><div class="code-block-heading"><span>${escape(codeLanguage)}</span></div><pre><code>${highlightCode(codeValue, codeLanguage, escape)}</code></pre></div>`); codeLines = []; code = false; codeLanguage = "text"; } else { closeList(); code = true; codeLanguage = normalizedCodeLanguage(line.trim().slice(3)); } continue; }
    if (code) { codeLines.push(line); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    const questionId = questionIds.get(lineIndex);
    const headingId = heading ? `heading-${heading[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 54)}` : null;
    const anchorId = questionId ?? headingId;
    const anchor = anchorId ? ` id="${anchorId}" class="question-anchor"` : "";
    if (heading) { closeList(); output.push(`<h${heading[1].length}${anchor}>${inline(heading[2])}</h${heading[1].length}>`); }
    else if (bullet || numbered) { const next = bullet ? "ul" : "ol"; if (list !== next) { closeList(); list = next; output.push(`<${list}>`); } output.push(`<li${anchor}>${inline((bullet ?? numbered)![1])}</li>`); }
    else if (/^\s*>\s?/.test(line)) { closeList(); output.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ""))}</blockquote>`); }
    else if (!line.trim()) closeList();
    else { closeList(); output.push(`<p>${inline(line)}</p>`); }
  }
  if (code) { const codeValue = codeLines.join("\n"); output.push(`<div class="code-block language-${codeLanguage}"><div class="code-block-heading"><span>${escape(codeLanguage)}</span></div><pre><code>${highlightCode(codeValue, codeLanguage, escape)}</code></pre></div>`); }
  closeList();
  return sanitizeHtml(output.join("\n"));
}
