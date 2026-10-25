import { delimiter, join, resolve, sep } from "node:path";
import { stat } from "node:fs/promises";
import type { CandidateProfile, CandidateProfileCreate, InterviewLogistics, Settings } from "../src/shared/schemas";
import { EMPTY_INTERVIEW_LOGISTICS, candidateProfileCreateSchema, candidateProfileSchema } from "../src/shared/schemas";
import { readJson, writeJsonAtomic } from "./persistence";

export const candidateProfileRelativePath = "profile/candidate.json";

function safeWorkspacePath(workspacePath: string, relativePath: string): string {
  const root = resolve(workspacePath);
  const candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) throw new Error("Candidate profile contains a path outside the workspace.");
  return candidate;
}

export async function readCandidateProfile(workspacePath: string): Promise<CandidateProfile | null> {
  const value = await readJson<unknown>(join(workspacePath, candidateProfileRelativePath));
  const parsed = candidateProfileSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function createCandidateProfile(
  workspacePath: string,
  input: CandidateProfileCreate,
  settings: Settings,
): Promise<CandidateProfile> {
  const value = candidateProfileCreateSchema.parse(input);
  const existing = await readCandidateProfile(workspacePath);
  if (existing) return existing;
  const profile = candidateProfileSchema.parse({
    schemaVersion: 1,
    identity: {
      fullName: value.fullName,
      artifactPrefix: value.artifactPrefix,
      email: null,
      phone: null,
      location: null,
      links: [],
    },
    sources: {
      baseResumePath: settings.baseResumePath,
      secondaryResumePaths: settings.secondaryResumePaths,
      linkedinProfilePath: settings.linkedinProfilePath,
      structuredContextRoots: ["context/structured"],
      broadContextRoots: ["context/broad"],
      denylistPath: "context/denylist.md",
      applicationVoicePath: "context/application_voice_profile.md",
    },
    career: {
      employers: [],
      education: [],
      transitionSummary: value.transitionSummary ?? "",
      preferredRoleFamilies: [],
    },
    preferences: {
      resume: {
        includeSummary: false,
        totalExperienceBullets: { min: 10, max: 14 },
        currentEmployerBullets: { min: 6, max: 8 },
        skillsCategories: [],
      },
      coverLetter: {
        storyGuidance: [],
        voiceGuidance: [],
        narrativePillars: value.narrativePillars,
      },
    },
    truth: {
      factualAuthority: "Selected structured career evidence",
      boundaries: ["Never invent candidate facts, dates, metrics, ownership, credentials, or outcomes."],
    },
    updatedAt: new Date().toISOString(),
  });
  await writeJsonAtomic(join(workspacePath, candidateProfileRelativePath), profile);
  return profile;
}

export async function updateCandidateProfileSources(workspacePath: string, settings: Settings): Promise<void> {
  const current = await readCandidateProfile(workspacePath);
  if (!current) return;
  await writeJsonAtomic(join(workspacePath, candidateProfileRelativePath), candidateProfileSchema.parse({
    ...current,
    sources: {
      ...current.sources,
      baseResumePath: settings.baseResumePath,
      secondaryResumePaths: settings.secondaryResumePaths,
      linkedinProfilePath: settings.linkedinProfilePath,
    },
    updatedAt: new Date().toISOString(),
  }));
}

export async function updateCandidateProfilePreferences(
  workspacePath: string,
  preferences: CandidateProfile["preferences"],
): Promise<CandidateProfile> {
  const current = await readCandidateProfile(workspacePath);
  if (!current) throw new Error("No candidate profile found to update.");
  const next = candidateProfileSchema.parse({
    ...current,
    preferences: {
      ...current.preferences,
      ...preferences,
      voice: {
        ...current.preferences.voice,
        ...preferences.voice,
      },
      resume: {
        ...current.preferences.resume,
        ...preferences.resume,
      },
      coverLetter: {
        ...current.preferences.coverLetter,
        ...preferences.coverLetter,
      },
    },
    updatedAt: new Date().toISOString(),
  });
  await writeJsonAtomic(join(workspacePath, candidateProfileRelativePath), next);
  return next;
}

/** Settings fields that live outside `preferences`: career direction and the candidate's truth rules. */
export async function updateCandidateProfileDetails(
  workspacePath: string,
  details: { transitionSummary?: string; confidentialNames?: string[]; boundaries?: string[]; interviewLogistics?: Partial<InterviewLogistics> },
): Promise<CandidateProfile> {
  const current = await readCandidateProfile(workspacePath);
  if (!current) throw new Error("No candidate profile found to update.");
  const clean = (values: string[] | undefined) => values?.map((value) => value.trim()).filter(Boolean);
  const next = candidateProfileSchema.parse({
    ...current,
    career: {
      ...current.career,
      ...(details.transitionSummary !== undefined ? { transitionSummary: details.transitionSummary.trim() } : {}),
    },
    ...(details.interviewLogistics ? {
      preferences: {
        ...current.preferences,
        interview: {
          ...current.preferences.interview,
          ...Object.fromEntries(Object.entries(details.interviewLogistics)
            .filter(([key, value]) => Object.hasOwn(EMPTY_INTERVIEW_LOGISTICS, key) && typeof value === "string")
            .map(([key, value]) => [key, (value as string).trim()])),
        },
      },
    } : {}),
    truth: {
      ...current.truth,
      ...(details.confidentialNames ? { confidentialNames: clean(details.confidentialNames) } : {}),
      ...(details.boundaries ? { boundaries: clean(details.boundaries) } : {}),
    },
    updatedAt: new Date().toISOString(),
  });
  await writeJsonAtomic(join(workspacePath, candidateProfileRelativePath), next);
  return next;
}

export async function profileHasBaseResume(workspacePath: string, profile: CandidateProfile | null, settings: Settings): Promise<boolean> {
  const candidate = profile?.sources.baseResumePath ?? settings.baseResumePath;
  if (!candidate) return false;
  try {
    const path = safeWorkspacePath(workspacePath, candidate);
    return Boolean((await stat(path).catch(() => null))?.isFile());
  } catch {
    return false;
  }
}

export async function executableAvailable(name: string): Promise<boolean> {
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(directory, process.platform === "win32" ? `${name}${extension.toLowerCase()}` : name);
      const alternate = process.platform === "win32" ? join(directory, `${name}${extension.toUpperCase()}`) : candidate;
      if ((await stat(candidate).catch(() => null))?.isFile() || (await stat(alternate).catch(() => null))?.isFile()) return true;
    }
  }
  return false;
}
