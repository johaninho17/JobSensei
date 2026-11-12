// The in-app Docs page (docs/app/*.md): every section exists, each edition keeps only its own parts, and the Agy
// commands listed are ones Agy's own /help shows.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { featureText, featuresFor } from "../src/shared/edition";

const DOCS = ["start-here", "your-data", "how-agy-uses-it", "agy-commands", "troubleshooting"];
const read = (name: string) => readFileSync(`docs/app/${name}.md`, "utf8");

describe("in-app docs", () => {
  it("has every section the Docs page shows, and nothing else", () => {
    expect(readdirSync("docs/app").filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3)).sort()).toEqual([...DOCS].sort());
    const page = readFileSync("src/renderer/DocsView.tsx", "utf8");
    for (const name of DOCS) expect(page).toContain(`docs/app/${name}.md?raw`);
  });

  it("drops left-out features from the Recruiter Edition's text", () => {
    const recruiter = featuresFor("recruiter");
    const text = DOCS.map((name) => featureText(recruiter, read(name))).join("\n");
    for (const phrase of ["Story bank", "story bank", "Interview prep", "Today", "Job search", "debrief", "Written application questions"]) expect(text, phrase).not.toContain(phrase);
    const solo = DOCS.map((name) => featureText(featuresFor("solo"), read(name))).join("\n");
    for (const phrase of ["story bank", "Interview prep", "Today", "Job search"]) expect(solo, phrase).toContain(phrase);
    expect(text).not.toMatch(/<!-- \/?feature/);
  });

  it("lists Agy commands from Agy's own /help", () => {
    const commands = read("agy-commands");
    for (const command of ["/help", "/model", "/effort", "/usage", "/config", "/skills", "/permissions"]) expect(commands).toContain(`\`${command}\``);
  });
});
