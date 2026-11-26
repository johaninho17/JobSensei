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
    for (const phrase of ["Story bank", "story bank", "Interview prep", "Questions for you", "Job search", "debrief", "Written application questions"]) expect(text, phrase).not.toContain(phrase);
    const solo = DOCS.map((name) => featureText(featuresFor("solo"), read(name))).join("\n");
    for (const phrase of ["story bank", "Interview prep", "Questions for you", "Job search"]) expect(solo, phrase).toContain(phrase);
    expect(text).not.toMatch(/<!-- \/?feature/);
  });

  it("speaks to the recruiter about their candidates in the Recruiter Edition (2026-11-11)", () => {
    const recruiter = DOCS.map((name) => featureText(featuresFor("recruiter"), read(name))).join("\n");
    for (const phrase of ["Career context", "(Setup)", "Setup →", "your work records", "Add jobs instead"]) expect(recruiter, phrase).not.toContain(phrase);
    for (const phrase of ["Postings", "Profile → Notes", "Mark applied", "Instructions for Agy", "every checked file"]) expect(recruiter.toLowerCase(), phrase).toContain(phrase.toLowerCase());
    const solo = DOCS.map((name) => featureText(featuresFor("solo"), read(name))).join("\n");
    for (const phrase of ["Postings", "Profile → Notes", "Mark applied"]) expect(solo, phrase).not.toContain(phrase);
    expect(solo).toContain("Career context");
  });

  it("keeps text marked for an edition without a feature only in that edition", () => {
    const text = "a\n<!-- feature:!candidates -->\nsolo only\n<!-- /feature -->\n<!-- feature:candidates -->\nrecruiter only\n<!-- /feature -->\nb";
    expect(featureText(featuresFor("solo"), text)).toBe("a\nsolo only\nb");
    expect(featureText(featuresFor("recruiter"), text)).toBe("a\nrecruiter only\nb");
  });

  it("lists Agy commands from Agy's own /help", () => {
    const commands = read("agy-commands");
    for (const command of ["/help", "/model", "/effort", "/usage", "/config", "/skills", "/permissions"]) expect(commands).toContain(`\`${command}\``);
  });

  // #40: what runs without the Agy panel, owned by how-agy-uses-it.md and shown per edition.
  it("lists background processes per edition, as one unbroken table, with one owner", () => {
    const table = (text: string) => {
      const section = text.slice(text.indexOf("## What runs in the background"), text.indexOf("## What never uses Agy"));
      return section.split("\n").filter((line) => line.startsWith("|"));
    };
    const solo = featureText(featuresFor("solo"), read("how-agy-uses-it"));
    const recruiter = featureText(featuresFor("recruiter"), read("how-agy-uses-it"));
    const soloRows = table(solo).slice(2).map((line) => line.split("|")[1]!.trim());
    expect(soloRows).toEqual(["Application drafts", "Written application questions", "Job search", "Watched companies", "Light rating", "Filing your answers", "Interview content update", "Interview prep"]);
    expect(table(recruiter).slice(2).map((line) => line.split("|")[1]!.trim())).toEqual(["Application drafts"]);
    expect(recruiter).toContain("the app opens the next candidate with jobs waiting");
    // The rows follow the header with no gap, so Markdown draws one table in both editions.
    for (const text of [solo, recruiter]) {
      const section = text.slice(text.indexOf("| What |"), text.indexOf("Nothing here sends"));
      expect(section.trim().split("\n").every((line) => line.startsWith("|"))).toBe(true);
    }
    expect(readFileSync("PRODUCT_FLOWS.md", "utf8")).not.toContain("| Light rating");
  });
});
