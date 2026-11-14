import { describe, expect, it } from "vitest";
import { moveOpen, openOnly, toggleCard } from "../src/renderer/interview-cards";

describe("one interview question card open at a time", () => {
  it("opening a card closes the one that was open", () => {
    expect([...toggleCard(new Set(["q1"]), "q2")]).toEqual(["q2"]);
  });
  it("clicking the open card closes it", () => {
    expect(toggleCard(new Set(["q1"]), "q1").size).toBe(0);
  });
  it("after Expand all, clicking an open card closes only that one", () => {
    expect([...toggleCard(new Set(["q1", "q2", "q3"]), "q2")]).toEqual(["q1", "q3"]);
  });
  it("jumping from the question rail opens that card alone", () => {
    expect([...openOnly("q3")]).toEqual(["q3"]);
  });
  it("arrow keys move the single open card", () => {
    expect([...moveOpen(new Set(["q1"]), "q2")]).toEqual(["q2"]);
  });
  it("arrow keys leave nothing open when nothing was open, and keep Expand all", () => {
    expect(moveOpen(new Set(), "q2").size).toBe(0);
    expect(moveOpen(new Set(["q1", "q2"]), "q3").size).toBe(2);
  });
});
