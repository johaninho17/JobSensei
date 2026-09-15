import { describe, expect, it } from "vitest";
import { parseQuestionBank } from "../src/renderer/question-navigation";

const fictionalQuestionBank = [
  "## Primary for this round",
  ...Array.from({ length: 14 }, (_, index) => `### Question ${index + 1}: ${index === 0 ? "Tell me about yourself and your background." : `How would you approach example scenario ${index}?`}`),
  "## Likely follow-ups",
  "### Question 15: What did you learn from that work?",
  "## Secondary / later-round preparation",
  "### Question 16: Design a distributed queue.",
  "## Questions to ask",
  "1. How does the team define success in the first six months?",
  "2. What does the interview process include?",
].join("\n");

describe("question bank navigation", () => {
  it("indexes primary, follow-up, and reverse questions from a fictional bank", () => {
    const questions = parseQuestionBank(fictionalQuestionBank);

    expect(questions.length).toBeGreaterThanOrEqual(17);
    expect(questions[0]).toMatchObject({
      text: "Tell me about yourself and your background.",
      section: "Primary for this round",
    });
    expect(questions.some((question) => question.section === "Likely follow-ups")).toBe(true);
    expect(questions.some((question) => question.section === "Questions to ask")).toBe(true);
    expect(questions.some((question) => question.section === "Secondary / later-round preparation")).toBe(true);
    expect(new Set(questions.map((question) => question.id)).size).toBe(questions.length);
  });

  it("creates stable unique anchors for repeated question text", () => {
    const questions = parseQuestionBank([
      "## Primary for this round",
      "### Question 1: Why this role?",
      "### Question 2: Why this role?",
      "## Questions to ask",
      "1. What happens next?",
    ].join("\n"));

    expect(questions.map((question) => question.id)).toEqual([
      "question-why-this-role",
      "question-why-this-role-2",
      "question-what-happens-next",
    ]);
  });
});
