import { describe, expect, it } from "vitest";
import { listItems, markdownSections, parseInterviewCards, storyTitles } from "../src/renderer/interview-cards";

const BANK = `# Recruiter screen

## Primary for this round

### Question 1: Why are you looking to leave Northstar Labs?
- **Why they ask:** motivation and fit
- **Real example:** none
- **Cues:** want bigger customers · more hands-on · growth path
- **Land on:** ready for a larger team

### Question 2: How would you handle a customer whose sync keeps failing?
- **Why they ask:** troubleshooting approach
- **Your approach:** 1) reproduce the failure 2) check logs 3) agree next steps
- **Land on:** calm, methodical, clear
- **Careful:** no claims about their stack

## Gap questions

### Gap 1: Have you used Kotlin in production?
- **Gap:** Kotlin
- **Closest real experience:** S3 · Android coursework app
- **Ramp plan:** small service in two weeks
- **Land on:** strong foundation, fast ramp

## Questions to ask
- What does success look like in the first 90 days?
- How does the team split support and engineering work?
`;

describe("interview cards", () => {
  it("parses current-format cards by section with fields", () => {
    const cards = parseInterviewCards(BANK);
    expect(cards.map((card) => card.kind)).toEqual(["question", "question", "gap", "ask", "ask"]);
    expect(cards[0]).toMatchObject({ question: "Why are you looking to leave Northstar Labs?", example: null, cues: ["want bigger customers", "more hands-on", "growth path"], landOn: "ready for a larger team" });
    expect(cards[1]!.approach).toEqual(["reproduce the failure", "check logs", "agree next steps"]);
    expect(cards[1]!.careful).toBe("no claims about their stack");
    expect(cards[2]).toMatchObject({ question: "Have you used Kotlin in production?", gap: "Kotlin", closest: "S3 · Android coursework app", ramp: "small service in two weeks" });
    expect(cards[3]!.question).toBe("What does success look like in the first 90 days?");
    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
  });

  it("keeps older free-form answers as notes", () => {
    const cards = parseInterviewCards("## Primary for this round\n\n### Question 1: Tell me about yourself.\n\n**What it tests:** trajectory\n\n**Suggested answer:** Walk through the roles.\n");
    expect(cards[0]).toMatchObject({ question: "Tell me about yourself.", why: "trajectory" });
    expect(cards[0]!.notes).toContain("Walk through the roles.");
  });

  it("reads prep sections, list items, and story titles", () => {
    const prep = "## 3 things to get across\n1. Customer-facing troubleshooting\n2. Clear writing\n3. Fast ramp\n\n## Before you start\n- Shorter answers\n";
    const sections = markdownSections(prep);
    expect(sections.map((section) => section.title)).toEqual(["3 things to get across", "Before you start"]);
    expect(listItems(sections[0]!.body)).toEqual(["Customer-facing troubleshooting", "Clear writing", "Fast ramp"]);
    expect(storyTitles("## S1 · Partner launch\n## S2: Data migration")).toEqual({ S1: "Partner launch", S2: "Data migration" });
  });
});

describe("question card v3", () => {
  it("reads Say, Proof, and Likely follow-up into the card fields", async () => {
    const { splitIds } = await import("../src/renderer/interview-cards");
    const [card] = parseInterviewCards([
      "## Primary for this round",
      "### Question 1: Tell me about a hard import?",
      "- **Why they ask:** ownership",
      "- **Say:** bad date column · wrote the fix guide · customer back in two days",
      "- **Proof:** fixed a stalled customer import (S1)",
      "- **Likely follow-up:** How did you find it? → diffed two exports",
      "- **Land on:** found it, fixed it",
    ].join("\n"));
    expect(card).toMatchObject({ cues: ["bad date column", "wrote the fix guide", "customer back in two days"], example: "fixed a stalled customer import (S1)", followUp: "How did you find it? → diffed two exports" });
    expect(splitIds(card!.example!)).toEqual({ text: "fixed a stalled customer import", ids: ["S1"] });
    expect(splitIds("Imports fixed with `context:work:imports` for real customers (S1, S2)")).toEqual({ text: "Imports fixed with for real customers", ids: ["S1", "S2", "context:work:imports"] });
    expect(splitIds("S3 · Android coursework app")).toEqual({ text: "Android coursework app", ids: ["S3"] });
    expect(splitIds("Two weeks (remote first)")).toEqual({ text: "Two weeks (remote first)", ids: [] });
    expect(splitIds("context:work:imports · central bug triage for imports")).toEqual({ text: "central bug triage for imports", ids: ["context:work:imports"] });
  });
});
