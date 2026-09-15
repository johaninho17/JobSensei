import { describe, expect, it } from "vitest";
import { buildApplicationRouting } from "../electron/evidence-snapshot";
import type { EvidenceSnapshotRow } from "../src/shared/schemas";

function row(index: number, source: string, family: string | null, evidenceId: string): EvidenceSnapshotRow {
  return {
    evidenceId,
    year: index % 2 ? "2026" : "2025-present",
    startYear: 2025,
    endYear: 2026,
    isOngoing: index % 2 === 0,
    recencyBand: index % 2 ? "recent" : "current",
    project: "Northstar customer delivery",
    employer: "Northstar Labs",
    claim: `Supported customer API integration, troubleshooting, documentation, and technical workflow ${index}.`,
    scope: "Contributed implementation and customer support scope.",
    sourcePath: source,
    sourceFamily: family,
    sourceLocator: `Evidence ${index}`,
    confidence: "high",
    classification: "verified",
    eligibility: "eligible",
  };
}

describe("job-scoped evidence routing", () => {
  it("builds a bounded, source-balanced packet while limiting LinkedIn authority", () => {
    const structured = Array.from({ length: 90 }, (_, index) => {
      const sourceIndex = index % 9;
      return row(index, `context/structured/project-${sourceIndex}.md`, `project-${sourceIndex}`, `context:project-${sourceIndex}:claim-${index}`);
    });
    const linkedIn = Array.from({ length: 30 }, (_, index) =>
      row(index, "context/structured/linkedin-profile.md", "linkedin-profile", `linkedin:northstar:claim-${index}`));
    const screeningEvidence = row(999, "context/structured/rare.md", "rare", "context:rare:screening");
    screeningEvidence.claim = "Worked with an unrelated legacy workflow.";
    const routing = buildApplicationRouting(
      [...structured, ...linkedIn, screeningEvidence],
      "Support customer API integrations, troubleshoot technical workflows, and write documentation.",
      [screeningEvidence.evidenceId],
    );

    expect(routing?.selectedEvidenceIds.length).toBeGreaterThanOrEqual(36);
    expect(routing?.selectedEvidenceIds.length).toBeLessThanOrEqual(48);
    expect(routing?.selectedEvidenceIds.filter((id) => id.startsWith("linkedin:")).length).toBeLessThanOrEqual(8);
    expect(routing?.selectedEvidenceIds).toContain(screeningEvidence.evidenceId);
    expect(routing?.routes.find((route) => route.evidenceId.startsWith("linkedin:") && route.timeline === "current")).toMatchObject({
      sourceAuthority: "corroboration",
      maximumClassification: "strong_transferable",
    });
    expect(new Set(routing?.selectedEvidenceIds.filter((id) => id.startsWith("context:")).map((id) => id.split(":")[1])).size).toBeGreaterThanOrEqual(9);
    expect(routing?.excludedEvidenceCount).toBeGreaterThan(70);
  });

  it("is deterministic and keeps all evidence when the selected set is already small", () => {
    const rows = Array.from({ length: 18 }, (_, index) =>
      row(index, `context/structured/source-${index % 3}.md`, `source-${index % 3}`, `context:small:claim-${index}`));
    const jd = "Debug customer API integrations and document technical workflows.";
    const first = buildApplicationRouting(rows, jd);
    const second = buildApplicationRouting([...rows].reverse(), jd);

    expect(first?.selectedEvidenceIds).toEqual(second?.selectedEvidenceIds);
    expect(first?.selectedEvidenceIds).toHaveLength(18);
    expect(first?.excludedEvidenceCount).toBe(0);
  });

  it("promotes recent customer-facing evidence for customer-facing roles", () => {
    const technical = Array.from({ length: 80 }, (_, index) => {
      const value = row(index, "context/structured/platform.md", "platform", `context:platform:technical-${index}`);
      value.project = "Platform engineering";
      value.claim = `Built Python API and container workflow ${index}.`;
      value.scope = "Hands-on technical implementation.";
      return value;
    });
    const customer = Array.from({ length: 4 }, (_, index) => {
      const value = row(index, "context/structured/customer-delivery.md", "customer-delivery", `context:customer:delivery-${index}`);
      value.claim = `Presented technical demonstrations and translated platform behavior for client onboarding ${index}.`;
      return value;
    });

    const routing = buildApplicationRouting(
      [...technical, ...customer],
      "Customer-facing solutions engineer responsible for customer discovery, technical onboarding, and partner feedback.",
    );

    expect(customer.every((value) => routing?.selectedEvidenceIds.includes(value.evidenceId))).toBe(true);
    expect(routing?.routes.filter((route) => route.evidenceId.startsWith("context:customer:")).every((route) =>
      route.reason.includes("customer-facing priority"))).toBe(true);
  });

  it("routes supported AI and agent evidence for AI roles without requiring identical JD wording", () => {
    const general = Array.from({ length: 70 }, (_, index) => row(index, "context/structured/general.md", "general", `context:general:${index}`));
    const aiEvidence = Array.from({ length: 4 }, (_, index) => {
      const value = row(index, "context/structured/agents.md", "agents", `context:agents:workflow-${index}`);
      value.project = "Named Agents";
      value.claim = `Configured and tested agent connector steps using task-result variables ${index}.`;
      value.scope = "Configuration and testing; no model architecture or production ownership.";
      return value;
    });

    const routing = buildApplicationRouting(
      [...general, ...aiEvidence],
      "Deploy generative AI and machine-learning products into customer operational workflows.",
    );

    expect(aiEvidence.every((value) => routing?.selectedEvidenceIds.includes(value.evidenceId))).toBe(true);
    expect(routing?.routes.filter((route) => route.evidenceId.startsWith("context:agents:")).every((route) =>
      route.reason.includes("AI capability priority"))).toBe(true);
  });

  it("prioritizes support and diagnostic evidence for technical support roles", () => {
    const general = Array.from({ length: 70 }, (_, index) => row(index, "context/structured/general.md", "general", `context:general:${index}`));
    const supportEvidence = Array.from({ length: 4 }, (_, index) => {
      const value = row(index, "context/structured/diagnostics.md", "diagnostics", `context:support:troubleshoot-${index}`);
      value.project = "API Support";
      value.claim = `Troubleshot API connectivity, authentication, and Docker runtime issues using Postman and curl ${index}.`;
      value.scope = "Diagnostic and troubleshooting scope.";
      return value;
    });

    const routing = buildApplicationRouting(
      [...general, ...supportEvidence],
      "Technical Support Engineer responsible for issue escalation, deliverability troubleshooting, and API diagnostics.",
    );

    expect(supportEvidence.every((value) => routing?.selectedEvidenceIds.includes(value.evidenceId))).toBe(true);
    expect(routing?.routes.filter((route) => route.evidenceId.startsWith("context:support:")).every((route) =>
      route.reason.includes("technical support priority"))).toBe(true);
  });

  it("prioritizes application development evidence for software engineering roles", () => {
    const general = Array.from({ length: 70 }, (_, index) => row(index, "context/structured/general.md", "general", `context:general:${index}`));
    const devEvidence = Array.from({ length: 4 }, (_, index) => {
      const value = row(index, "context/structured/dev.md", "dev", `context:dev:components-${index}`);
      value.project = "Application Development";
      value.claim = `Developed modular Angular and TypeScript frontend components and Node.js RESTful API endpoints ${index}.`;
      value.scope = "Hands-on software implementation.";
      return value;
    });

    const routing = buildApplicationRouting(
      [...general, ...devEvidence],
      "Associate Applications Dev Engineer building web applications, frontend components, and backend microservices.",
    );

    expect(devEvidence.every((value) => routing?.selectedEvidenceIds.includes(value.evidenceId))).toBe(true);
    expect(routing?.routes.filter((route) => route.evidenceId.startsWith("context:dev:")).every((route) =>
      route.reason.includes("application development priority"))).toBe(true);
  });

  it("prioritizes QA, verification, and automated testing evidence for quality assurance roles", () => {
    const general = Array.from({ length: 70 }, (_, index) => row(index, "context/structured/general.md", "general", `context:general:${index}`));
    const qaEvidence = Array.from({ length: 4 }, (_, index) => {
      const value = row(index, "context/structured/qa.md", "qa", `context:qa:testing-${index}`);
      value.project = "Quality Assurance";
      value.claim = `Designed automated test verification routines, executed defect triage, and verified build integrity ${index}.`;
      value.scope = "Test automation and verification scope.";
      return value;
    });

    const routing = buildApplicationRouting(
      [...general, ...qaEvidence],
      "Quality Assurance Engineer II responsible for automated test plans, defect reproduction, and release verification.",
    );

    expect(qaEvidence.every((value) => routing?.selectedEvidenceIds.includes(value.evidenceId))).toBe(true);
    expect(routing?.routes.filter((route) => route.evidenceId.startsWith("context:qa:")).every((route) =>
      route.reason.includes("QA/testing priority"))).toBe(true);
  });
});
