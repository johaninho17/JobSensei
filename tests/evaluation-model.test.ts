import { describe, expect, it } from "vitest";
import { evaluationLabel, evaluationSection, parseEvaluationRequirements } from "../src/renderer/evaluation-model";

const evaluation = `# Evaluation

- **Weighted Fit Score:** 3.80 / 5
- **Fit Confidence:** medium
- **Apply Recommendation:** Recommended with transferable gaps

### Requirement Scoring
| Requirement | Category | Weight | Material | Classification | Evidence |
| --- | --- | ---: | --- | --- | --- |
| Diagnose customer issues | core | 35% | yes | direct | context:support:logs |
| TypeScript | technical | 20% | yes | strong_transferable | context:engineering:javascript |
| Customer communication | scope | 15% | yes | direct | context:delivery:customer |
| Measured resolution impact | outcomes | 15% | yes | gap | none |
| Recruiting technology | domain | 10% | no | adjacent_transferable | context:platform:integration |
| Learn new systems | learning | 5% | no | direct | context:delivery:learning |

## Direct Matches
- Customer troubleshooting and communication.

## Important Gaps or Hard Blockers
- No measured resolution outcome.
`;

describe("evaluation presentation model", () => {
  it("parses the scoring table for the structured evaluation view", () => {
    const requirements = parseEvaluationRequirements(evaluation);
    expect(requirements).toHaveLength(6);
    expect(requirements[0]).toMatchObject({ category: "core", material: true, classification: "direct", weight: 35 });
    expect(requirements[1]?.evidence).toBe("context:engineering:javascript");
  });

  it("extracts dashboard labels and narrative sections", () => {
    expect(evaluationLabel(evaluation, /Weighted Fit Score/i)).toBe("3.80 / 5");
    expect(evaluationLabel(evaluation, /Apply Recommendation/i)).toBe("Recommended with transferable gaps");
    expect(evaluationSection(evaluation, /Direct Matches/i)).toContain("Customer troubleshooting");
    expect(evaluationSection(evaluation, /(?:Important Gaps|Hard Blockers)/i)).toContain("No measured resolution outcome");
  });

  it("accepts the legacy bold-label format used by existing job evaluations", () => {
    const legacy = evaluation.replace("**Weighted Fit Score:**", "**Weighted Fit Score**:").replace("**Fit Confidence:**", "**Fit Confidence**:");
    expect(evaluationLabel(legacy, /Weighted Fit Score/i)).toBe("3.80 / 5");
    expect(evaluationLabel(legacy, /Fit Confidence/i)).toBe("medium");
  });
});
