import { delimiter, join, resolve, sep } from "node:path";
import { stat } from "node:fs/promises";
import type { CandidateProfile, CandidateProfileCreate, Settings } from "../src/shared/schemas";
import { candidateProfileCreateSchema, candidateProfileSchema } from "../src/shared/schemas";
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
    career: { employers: [], education: [], transitionSummary: "", preferredRoleFamilies: [] },
    preferences: {
      resume: {
        includeSummary: false,
        totalExperienceBullets: { min: 10, max: 14 },
        currentEmployerBullets: { min: 6, max: 8 },
        skillsCategories: [],
      },
      coverLetter: { storyGuidance: [], voiceGuidance: [] },
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
