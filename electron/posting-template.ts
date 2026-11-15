// The one layout every saved posting gets (issue #54), whatever it came from: a board page, a board's JSON (Greenhouse,
// Workday, Oracle), a company page, or a paste. Title, then one facts block in a fixed order with each field's normal
// form (src/shared/posting-fields.ts), then the posting's own sections under `##` headings.
// The body keeps the posting's own wording and section order, because the requirement parser reads it; facts the
// posting doesn't state are left out of the file (the Role panel says "Not in the posting").
import { buildPostingRecord } from "./posting-record";

/** Header labels, in the order every posting shows them. `Source` is always last. */
export const POSTING_FACTS = ["Company", "Location", "Work setup", "Pay", "Employment type", "Posted", "Job ID", "Source"] as const;

const HEADER_LABEL = /^\s*(?:[-*•]\s*)?\*{0,2}(company|employer|location|work setup|workplace type|remote type|pay|compensation|salary|employment type|job type|time type|posted(?: on)?|date posted|job id|requisition id|req id|source(?: url)?|job url|url)\*{0,2}\s*:\*{0,2}\s*(.*)$/i;

const MODE_LABEL = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" } as const;

/** The posting rendered in the shared layout. */
export function postingTemplate(markdown: string, fallback: { url?: string | null } = {}): string {
  const record = buildPostingRecord(markdown);
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const titleIndex = lines.findIndex((line) => /^#\s/.test(line));
  const source = record.url ?? (fallback.url?.trim() || null);
  // Facts lines are dropped wherever they sit in the opening block (before the first section), then written once.
  const firstSection = lines.findIndex((line, index) => index > titleIndex && /^#{2,6}\s/.test(line));
  const body = lines
    .filter((line, index) => index !== titleIndex && !(index < (firstSection < 0 ? 40 : firstSection) && HEADER_LABEL.test(line.replace(/^<p>|<\/p>$/g, ""))))
    .map((line) => {
      // One heading level for sections; bold markers inside a heading removed ("## **About the Role**").
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (!heading) return line;
      const text = heading[2]!.replace(/\*\*/g, "").replace(/:$/, "").trim();
      return heading[1]!.length >= 4 ? `### ${text}` : heading[1]!.length === 3 ? `### ${text}` : `## ${text}`;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const facts: Array<[string, string | null]> = [
    ["Company", record.company],
    ["Location", record.location],
    ["Work setup", record.workSetup?.mode ? `${MODE_LABEL[record.workSetup.mode]}${record.workSetup.daysInOffice ? `, ${record.workSetup.daysInOffice} days a week in the office` : ""}` : null],
    ["Pay", record.pay?.text ?? null],
    ["Employment type", record.employmentType],
    ["Posted", record.postedAt],
    ["Job ID", record.jobId],
    ["Source", source],
  ];
  const header = [
    `# ${record.title ?? "Job Description"}`,
    "",
    ...facts.filter(([, value]) => value).map(([label, value]) => `**${label}:** ${value}  `),
  ];
  return `${header.join("\n").replace(/ {2}$/, "")}\n\n${body}\n`;
}
