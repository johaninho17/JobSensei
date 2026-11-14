// Shared by create-issue.mjs and issues-index.mjs. GitHub Issues own the tasks; these only format them.

export const PRIORITIES = ["P0", "P1", "P2", "P3"];
export const TYPES = ["feat", "fix", "refactor", "perf", "test", "docs", "ci", "chore"];
export const SCOPES = ["jobs", "workspace", "pipeline", "search", "interviews", "agy", "today", "setup", "ui", "recruiter", "ci", "docs"];

/** `<type>(<scope>): summary (refs #N)`: the form every commit and PR title takes. */
export const TITLE_PATTERN = new RegExp(`^(${TYPES.join("|")})\\((${SCOPES.join("|")})\\)!?: .+ \\(refs #\\d+(, ?(#\\d+|FEAT-\\d{3}))*\\)$`);

const refs = (numbers) => (numbers.length ? numbers.map((n) => `#${n}`).join(", ") : "none");

export function numberList(value) {
  return String(value ?? "").split(",").map((part) => Number(part.trim().replace(/^#/, ""))).filter((n) => Number.isInteger(n) && n > 0);
}

export function featureLabels(value) {
  const labels = String(value ?? "").split(",").map((part) => part.trim().toUpperCase()).filter(Boolean);
  const bad = labels.filter((label) => !/^FEAT-\d{3}$/.test(label));
  if (bad.length) throw new Error(`Feature labels look like FEAT-004. Got: ${bad.join(", ")}`);
  return labels;
}

export function issueBody({ features, dependsOn = [], blocks = [], correlates = [], problem, approach = "", acceptance = [] }) {
  return [
    `**Feature:** ${features.join(", ")}`,
    `**Depends on:** ${refs(dependsOn)} · **Blocks:** ${refs(blocks)} · **Correlates with:** ${refs(correlates)}`,
    "",
    "### Problem",
    problem,
    "",
    "### Approach and files",
    approach || "To be filled in when picked up.",
    "",
    "### Acceptance",
    ...acceptance.map((line) => `- [ ] ${line}`),
    "- [ ] Feature entry in `tasks/features.md` updated; correlated issues checked",
  ].join("\n");
}

/** The generated index: open issues by priority, each with its features. */
export function indexMarkdown(issues) {
  const names = (issue) => issue.labels.map((label) => label.name);
  const open = issues.filter((issue) => issue.state === "OPEN").sort((a, b) => a.number - b.number);
  const lines = [
    "# Open issues",
    "",
    "Generated from GitHub Issues by `npm run issues:index`. Do not edit by hand; change the issue on GitHub and regenerate.",
    "",
  ];
  for (const priority of [...PRIORITIES, null]) {
    const group = open.filter((issue) => (priority ? names(issue).includes(priority) : !names(issue).some((name) => PRIORITIES.includes(name))));
    if (!group.length) continue;
    lines.push(`## ${priority ?? "No priority"}`, "", "| # | Issue | Features | Blocked |", "|---|---|---|---|");
    for (const issue of group) {
      const features = names(issue).filter((name) => name.startsWith("FEAT-")).sort().join(", ") || "—";
      lines.push(`| #${issue.number} | ${issue.title.replace(/\|/g, "\\|")} | ${features} | ${names(issue).includes("status:blocked") ? "yes" : ""} |`);
    }
    lines.push("");
  }
  lines.push(`${open.length} open.`, "");
  return lines.join("\n");
}
