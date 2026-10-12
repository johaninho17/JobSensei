import { describe, expect, it } from "vitest";
import { deriveVoicePresets, getUniversalPresets } from "../src/shared/voice-presets";
import type { CandidateProfile } from "../src/shared/schemas";

function mockProfile(overrides: Partial<CandidateProfile["career"]> = {}): CandidateProfile {
  return {
    schemaVersion: 1,
    identity: {
      fullName: "Jane Doe",
      artifactPrefix: "Jane_Doe",
      email: "jane@example.com",
      phone: null,
      location: null,
      links: [],
    },
    sources: {
      baseResumePath: "resumes/base.pdf",
      secondaryResumePaths: [],
      linkedinProfilePath: null,
      structuredContextRoots: [],
      broadContextRoots: [],
      denylistPath: null,
      applicationVoicePath: null,
    },
    career: {
      employers: [],
      education: [],
      transitionSummary: "",
      preferredRoleFamilies: [],
      ...overrides,
    },
    preferences: {
      resume: {
        includeSummary: false,
        totalExperienceBullets: { min: 10, max: 14 },
        currentEmployerBullets: { min: 6, max: 8 },
        skillsCategories: [],
      },
      coverLetter: { storyGuidance: [], voiceGuidance: [] },
      voice: {
        tonePreset: "direct_outcomes",
        customGuidance: "",
        antiSlopStrictness: "aggressive",
        interactiveQuestions: "on_gaps",
        narrativeDepth: "journey_first",
      },
    },
    truth: {
      factualAuthority: "evidence",
      boundaries: [],
    },
    updatedAt: new Date().toISOString(),
  };
}

describe("deriveVoicePresets", () => {
  it("returns universal role-agnostic presets when profile is null", () => {
    const presets = deriveVoicePresets(null);
    expect(presets).toHaveLength(3);
    expect(presets.map((p) => p.id)).toEqual(["direct_outcomes", "strategic_partner", "narrative_storyteller"]);
  });

  it("returns universal presets when profile has no specified discipline", () => {
    const presets = deriveVoicePresets(mockProfile());
    expect(presets).toHaveLength(3);
    expect(presets[0].id).toBe("direct_outcomes");
    expect(presets[0].name).toContain("Direct & Results-Driven Operator");
  });

  it("dynamically generates People & Culture presets for an HR profile", () => {
    const hrProfile = mockProfile({
      preferredRoleFamilies: ["Human Resources", "People Operations", "Talent Acquisition"],
      transitionSummary: "Transitioned from recruiting to people operations and culture strategy.",
    });
    const presets = deriveVoicePresets(hrProfile);
    expect(presets).toHaveLength(3);
    expect(presets[0].id).toBe("people_strategy");
    expect(presets[0].name).toContain("People & Culture");
    expect(presets[1].id).toBe("talent_operations");
  });

  it("dynamically generates Commercial presets for a Sales / BD profile", () => {
    const salesProfile = mockProfile({
      preferredRoleFamilies: ["Enterprise Sales", "Business Development", "Account Executive"],
      employers: [
        {
          name: "Acme Corp",
          title: "Senior Account Executive",
          startDate: "2022-01",
          endDate: null,
          location: null,
          contextPaths: [],
        },
      ],
    });
    const presets = deriveVoicePresets(salesProfile);
    expect(presets).toHaveLength(3);
    expect(presets[0].id).toBe("commercial_executive");
    expect(presets[0].name).toContain("Commercial");
  });

  it("dynamically generates Marketing presets for a Marketing profile", () => {
    const marketingProfile = mockProfile({
      preferredRoleFamilies: ["Product Marketing", "Demand Generation", "Brand Strategy"],
    });
    const presets = deriveVoicePresets(marketingProfile);
    expect(presets).toHaveLength(3);
    expect(presets[0].id).toBe("growth_marketer");
    expect(presets[1].id).toBe("brand_storyteller");
  });

  it("dynamically generates Systems / Solutions presets for an Engineering profile", () => {
    const engProfile = mockProfile({
      preferredRoleFamilies: ["Solutions Engineering", "Cloud Architecture"],
      employers: [
        {
          name: "Tech Inc",
          title: "Senior Solutions Architect",
          startDate: "2022-01",
          endDate: null,
          location: null,
          contextPaths: [],
        },
      ],
    });
    const presets = deriveVoicePresets(engProfile);
    expect(presets).toHaveLength(3);
    expect(presets[0].id).toBe("systems_builder");
    expect(presets[1].id).toBe("solutions_partner");
  });
});
