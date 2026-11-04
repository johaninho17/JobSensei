import { describe, expect, it } from "vitest";
import { scoreStretch } from "../electron/stretch-score";

const rowText = new Map([
  ["context:work:api", "Configured and tested REST API integrations for customer workflows. Hands-on scope."],
  ["context:work:dash", "Built Looker dashboards that track delivery progress for two clients. Hands-on scope."],
]);
const baselineLines = ["Supported API integrations for customer teams.", "**Engineering:** TypeScript"];

describe("stretch score", () => {
  it("is low when changed lines say what their evidence says", () => {
    const result = scoreStretch({
      lines: [
        { text: "Supported API integrations for customer teams.", artifact: "resume", claimType: "baseline", evidenceIds: [] },
        { text: "Configured and tested REST API integrations for customer workflows.", artifact: "resume", claimType: "candidate", evidenceIds: ["context:work:api"] },
        { text: "I enjoy hard problems.", artifact: "cover-letter", claimType: "non-factual", evidenceIds: [] },
      ],
      baselineLines, rowText, unsupported: [],
    });
    expect(result).toMatchObject({ level: "low", tailoredPercent: 50, counts: { asEvidence: 1, reworded: 0, framed: 0, unsupported: 0 } });
  });

  it("flags lines framed stronger than their rows and lines that failed grounding", () => {
    const result = scoreStretch({
      lines: [
        { text: "Led enterprise-wide API integration strategy across all customer workflows.", artifact: "resume", claimType: "candidate", evidenceIds: ["context:work:api"] },
        { text: "Built Looker dashboards and Kubernetes pipelines for executives.", artifact: "resume", claimType: "candidate", evidenceIds: ["context:work:dash"] },
        { text: "In every engagement I strictly validate AI output.", artifact: "cover-letter", claimType: "framed", evidenceIds: ["context:work:api"] },
      ],
      baselineLines, rowText, unsupported: [{ text: "Built Looker dashboards and Kubernetes pipelines for executives.", reason: "Names terms the cited rows don't mention: Kubernetes." }],
    });
    expect(result.counts).toEqual({ asEvidence: 0, reworded: 0, framed: 2, unsupported: 1 });
    expect(result.level).toBe("high");
    expect(result.top[0]).toMatchObject({ level: 3, text: "Built Looker dashboards and Kubernetes pipelines for executives.", reason: "Names terms the cited rows don't mention: Kubernetes." });
    expect(result.top[1]!.reason).toMatch(/led|enterprise|across|all/);
    expect(result.tailoredPercent).toBe(100);
  });
});
