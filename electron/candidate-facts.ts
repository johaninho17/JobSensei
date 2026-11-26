// Saves the application facts sheet (Recruiter Edition, plan R8 P3). Contact details go to `identity`, the four
// logistics answers to `preferences.interview` (their one owner in both editions), and everything else to
// `preferences.applicationFacts.extra`. Nothing here reaches Agy.
import { join } from "node:path";
import { applicationFactsSchema, candidateProfileSchema, type CandidateProfile } from "../src/shared/schemas";
import { LOGISTICS_FACT_KEYS, PROFILE_FACT_KEYS, type ProfileFactKey } from "../src/shared/profile-answers";
import { candidateProfileRelativePath, readCandidateProfile } from "./candidate-profile";
import { writeJsonAtomic } from "./persistence";

export type FactsInput = {
  email?: string; phone?: string; location?: string; links?: string[];
  workAuthorization?: string; compensation?: string; noticePeriod?: string; workArrangement?: string;
  extra?: Array<{ label: string; value: string }>;
};

const text = (value: unknown, max = 300) => (typeof value === "string" ? value.trim().slice(0, max) : undefined);

export async function saveApplicationFacts(folder: string, input: FactsInput): Promise<CandidateProfile> {
  const current = await readCandidateProfile(folder);
  if (!current) throw new Error("No candidate profile found to update.");
  const orNull = (value: string | undefined, fallback: string | null) => (value === undefined ? fallback : value || null);
  const links = Array.isArray(input.links) ? input.links.map((link) => text(link, 300)).filter((link): link is string => Boolean(link)).slice(0, 8) : current.identity.links;
  const extra = Array.isArray(input.extra) ? applicationFactsSchema.parse({ extra: input.extra.map((fact) => ({ label: text(fact?.label, 80) ?? "", value: text(fact?.value, 500) ?? "" })).filter((fact) => fact.label && fact.value) }).extra : current.preferences.applicationFacts.extra;
  const logistics = { ...current.preferences.interview };
  for (const key of ["workAuthorization", "compensation", "noticePeriod", "workArrangement"] as const) {
    const value = text(input[key]);
    if (value !== undefined) logistics[key] = value;
  }
  const next = candidateProfileSchema.parse({
    ...current,
    identity: { ...current.identity, email: orNull(text(input.email), current.identity.email), phone: orNull(text(input.phone, 60), current.identity.phone), location: orNull(text(input.location, 120), current.identity.location), links },
    preferences: { ...current.preferences, interview: logistics, applicationFacts: { ...current.preferences.applicationFacts, extra } },
    updatedAt: new Date().toISOString(),
  });
  await writeJsonAtomic(join(folder, candidateProfileRelativePath), next);
  return next;
}

/**
 * Saves one application fact from the Questions tab (issue #161) to its owner: interview logistics for the five shared
 * ones, `applicationFacts.answers` for the rest. Every job's form questions then use it.
 */
export async function saveProfileFact(folder: string, key: ProfileFactKey, value: string): Promise<CandidateProfile> {
  if (!(PROFILE_FACT_KEYS as readonly string[]).includes(key)) throw new Error("Unknown profile fact.");
  const current = await readCandidateProfile(folder);
  if (!current) throw new Error("Finish setup first: there's no candidate profile to save this to.");
  const clean = value.trim().slice(0, 300);
  const isLogistics = (LOGISTICS_FACT_KEYS as readonly string[]).includes(key);
  const next = candidateProfileSchema.parse({
    ...current,
    preferences: {
      ...current.preferences,
      interview: isLogistics ? { ...current.preferences.interview, [key]: clean } : current.preferences.interview,
      applicationFacts: isLogistics ? current.preferences.applicationFacts : { ...current.preferences.applicationFacts, answers: { ...current.preferences.applicationFacts.answers, [key]: clean } },
    },
    updatedAt: new Date().toISOString(),
  });
  await writeJsonAtomic(join(folder, candidateProfileRelativePath), next);
  return next;
}
