// Computes setup readiness (src/shared/readiness.ts): the single owner of what JobSensei needs before it runs and
// what improves its drafts. Read by Get Started, the Setup page, the job queue, and the evidence snapshot.
import { countCareerFiles, coverLetterPlanFor } from "../src/shared/cover-letter-policy";
import { readdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { readinessSchema, RESUME_FORMAT_HELP, RESUME_PDF_ONLY, type Readiness, type ReadinessItem } from "../src/shared/readiness";
import type { CandidateProfile, ContextManifest, Settings } from "../src/shared/schemas";
import { loadCanonicalResumeBaseline } from "./canonical-resume";
import { featuresFor, type Features } from "../src/shared/edition";
import { currentEdition } from "./edition";

export type ReadinessInput = {
  workspacePath: string;
  profile: CandidateProfile | null;
  settings: Settings | null;
  manifest: ContextManifest | null;
  contextFileCount: number;
  agy: { installed: boolean; signedIn: boolean | null };
  /** Defaults to this build's edition; items for left-out features are not listed. */
  features?: Features;
};

type ResumeCheck = { ok: true; employers: number; lines: string[] } | { ok: false; message: string };
const resumeCache = new Map<string, { key: string; check: ResumeCheck }>();

/** Whether the base resume's structure can be read, cached by path and modification time. */
export async function checkBaseResume(workspacePath: string, relativePath: string): Promise<ResumeCheck> {
  const absolute = resolve(workspacePath, relativePath);
  if (absolute !== resolve(workspacePath) && !absolute.startsWith(`${resolve(workspacePath)}${sep}`)) return { ok: false, message: "The base resume must be inside the workspace's resumes folder. Choose it again in Setup." };
  const info = await stat(absolute).catch(() => null);
  if (!info?.isFile()) return { ok: false, message: `The base resume file is missing (${relativePath}). Choose it again in Setup.` };
  // A PDF's structure comes from the .docx/.md beside it, so those files are part of the cache key.
  const companions = extname(absolute).toLowerCase() === ".pdf"
    ? await Promise.all((await readdir(dirname(absolute)).catch(() => [] as string[])).filter((name) => /\.(?:md|docx)$/i.test(name)).sort().map(async (name) => `${name}@${(await stat(join(dirname(absolute), name)).catch(() => null))?.mtimeMs ?? 0}`))
    : [];
  const key = `${info.mtimeMs}:${info.size}:${companions.join("|")}`;
  const cached = resumeCache.get(absolute);
  if (cached?.key === key) return cached.check;
  let check: ResumeCheck;
  try {
    const baseline = await loadCanonicalResumeBaseline(workspacePath, relativePath);
    // What the app read, so the user can confirm it before any job runs.
    const lines = [
      ...baseline.employers.map((employer) => [employer.name, employer.title, employer.dateRange].filter(Boolean).join(" · ") + ` (${employer.originalBulletCount} bullet${employer.originalBulletCount === 1 ? "" : "s"})`),
      `Skills: ${baseline.originalSkillsLines.length} line${baseline.originalSkillsLines.length === 1 ? "" : "s"} · Education: ${baseline.educationLines.length} line${baseline.educationLines.length === 1 ? "" : "s"}${baseline.originalSummaryLines?.length ? " · Summary" : ""}`,
      ...baseline.warnings.filter((warning) => !/^Linked PDF baseline/.test(warning)).slice(0, 3).map((warning) => `Note: ${warning}`),
    ];
    check = { ok: true, employers: baseline.employers.length, lines };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    check = extname(relativePath).toLowerCase() === ".pdf"
      ? { ok: false, message: RESUME_PDF_ONLY }
      : { ok: false, message: `JobSensei couldn't read your base resume's sections (${reason}). It needs a header, a skills section, an experience section with at least one job, and an education section. ${RESUME_FORMAT_HELP}` };
  }
  resumeCache.set(absolute, { key, check });
  return check;
}

const filled = (value: string | null | undefined) => Boolean(value && value.trim());
const exists = (path: string) => stat(path).then((info) => info.isFile() && info.size > 0, () => false);

export async function computeReadiness(input: ReadinessInput): Promise<Readiness> {
  const { profile, settings, manifest } = input;
  const features = input.features ?? featuresFor(currentEdition());
  const root = resolve(input.workspacePath);
  const items: ReadinessItem[] = [];
  const add = (item: Omit<ReadinessItem, "lines"> & { lines?: string[] }) => items.push({ lines: [], ...item });

  // Required -----------------------------------------------------------------------------------------------
  add({
    id: "profile", level: "required", state: profile ? "done" : "missing", action: "profile", path: "profile",
    title: "Your name and file prefix",
    detail: profile ? `${profile.identity.fullName} · files start with ${profile.identity.artifactPrefix}` : "Not set yet.",
    improves: "Your name on every resume and letter, and how the files are named.",
  });

  const resumePath = profile?.sources.baseResumePath ?? settings?.baseResumePath ?? null;
  const resume = resumePath ? await checkBaseResume(root, resumePath) : null;
  add({
    id: "resume", level: "required", state: !resumePath ? "missing" : resume?.ok ? "done" : "problem", action: "resume", path: resumePath ?? "resumes",
    title: "Base resume (Word or Markdown)",
    detail: !resumePath ? `Not chosen yet. ${RESUME_FORMAT_HELP}` : resume?.ok ? `${resumePath.split("/").pop()}: read ${resume.employers} job${resume.employers === 1 ? "" : "s"}, skills, and education.` : (resume as { message: string }).message,
    improves: "Every tailored resume keeps its layout, section order, dates, and length (its number of pages).",
    lines: resume?.ok ? resume.lines : [],
  });

  add({
    id: "agy", level: "required", state: !input.agy.installed ? "missing" : input.agy.signedIn === true ? "done" : input.agy.signedIn === false ? "problem" : "missing", action: "agy", path: null,
    title: "Agy signed in",
    detail: !input.agy.installed ? "Agy isn't installed. Reinstall JobSensei, or install Agy and add it to PATH."
      : input.agy.signedIn === true ? "Agy is ready."
      : input.agy.signedIn === false ? "Agy is waiting for you: open the Agy panel and finish signing in."
      : "Installed. Open the Agy panel once and sign in (JobSensei gives Agy its own home, so this happens once).",
    improves: "Agy writes the drafts and interview prep.",
  });

  // Recommended --------------------------------------------------------------------------------------------
  const careerPaths = (manifest?.selectedCareerPaths ?? []).filter((path) => path.startsWith("context/") && !/README\.md$/i.test(path));
  add({
    id: "context", level: "recommended", state: careerPaths.length ? "done" : "missing", action: "context", path: "context",
    title: "Career evidence, checked for Agy",
    detail: careerPaths.length ? `${careerPaths.length} file${careerPaths.length === 1 ? "" : "s"} checked for Agy${input.contextFileCount > careerPaths.length ? ` (${input.contextFileCount - careerPaths.length} more not checked)` : ""}.`
      : input.contextFileCount ? `${input.contextFileCount} file${input.contextFileCount === 1 ? "" : "s"} in the context folder, none checked for Agy. Tick them in Career context → Sources.`
      : "None yet. In Career context → Sources, press Add files (or drop files) to add work records: projects, results, performance reviews.",
    improves: "What Agy is allowed to claim. Without it, drafts can only reuse your base resume's wording.",
  });

  const pillars = [profile?.career.narrativePillars, profile?.preferences.coverLetter.narrativePillars].flatMap((value) => value ? Object.values(value) : []);
  const hasStory = filled(profile?.career.transitionSummary) || pillars.some(filled);
  add({
    id: "story", level: "recommended", state: hasStory ? "done" : "missing", action: "story", path: null,
    title: "Career story (3 short questions)",
    detail: hasStory ? "Filled in." : "Not filled in yet.",
    improves: "Cover letters about you and your path, not a summary of the job posting.",
  });

  if (features.interviews) {
    const logistics = profile?.preferences.interview;
    const blanks = logistics ? Object.entries({ location: logistics.location, "work authorization": logistics.workAuthorization, "pay target": logistics.compensation, "notice period": logistics.noticePeriod, "work setup": logistics.workArrangement }).filter(([, value]) => !filled(value)).map(([label]) => label) : ["all"];
    add({
      id: "logistics", level: "recommended", state: blanks.length ? "missing" : "done", action: "logistics", path: null,
      title: "Interview logistics",
      detail: blanks.length ? `Missing: ${blanks.join(", ")}.` : "All filled in.",
      improves: "Interview prep and application answers use your words for pay, location, and start date; blanks are flagged, never guessed.",
    });
  }

  if (features.candidates) {
    const targets = profile?.preferences.targets;
    const set = targets ? [targets.roles.length && "roles", targets.workModes.length && "work setup", targets.locations.length && "locations", targets.level && "level", targets.salaryFloor && "pay floor", targets.skipCompanies.length && "companies to skip"].filter(Boolean) as string[] : [];
    add({
      id: "targets", level: "recommended", state: set.length ? "done" : "missing", action: "targets", path: null,
      title: "Brief",
      detail: set.length ? `Set: ${set.join(", ")}.` : "Not set yet: roles, work setup, locations, level, pay floor, companies to skip.",
      improves: "\"Who is this for?\" suggests this candidate for postings that fit, says why, and warns about companies to skip.",
    });
    const identity = profile?.identity;
    const logistics = profile?.preferences.interview;
    const facts = [identity?.email, identity?.phone, identity?.location || logistics?.location, logistics?.workAuthorization, logistics?.compensation, logistics?.noticePeriod].filter((value) => value && value.trim()).length;
    add({
      id: "facts", level: "recommended", state: facts >= 4 ? "done" : "missing", action: "facts", path: null,
      title: "Application facts",
      detail: facts ? `${facts} of 6 common form answers filled in.` : "Not filled in yet: email, phone, location, work authorization, pay expectation, start date.",
      improves: "The details every employer form asks for, with copy buttons on each job. Never sent to Agy.",
    });
  }

  const names = profile?.truth.confidentialNames ?? [];
  add({
    id: "private-names", level: "recommended", state: names.length ? "done" : "missing", action: "private-names", path: null,
    title: "Names to keep private",
    detail: names.length ? `${names.length} name${names.length === 1 ? "" : "s"} kept out of resumes and letters.` : "None listed yet. Add client, partner, or project names that must not appear in public documents.",
    improves: "Keeps confidential clients out of resumes and cover letters.",
  });

  const voicePath = profile?.sources.applicationVoicePath ?? "context/application_voice_profile.md";
  const hasVoice = await exists(join(root, voicePath));
  add({
    id: "voice", level: "recommended", state: hasVoice ? "done" : "missing", action: "voice", path: voicePath,
    title: "Your writing voice",
    detail: hasVoice ? `${voicePath} is set.` : "No voice profile yet. Write a few lines about how you sound (a starting template is provided).",
    improves: "Letters and answers sound like you.",
  });

  const others = (profile?.sources.secondaryResumePaths ?? settings?.secondaryResumePaths ?? []).length + Number(Boolean(profile?.sources.linkedinProfilePath ?? settings?.linkedinProfilePath));
  add({
    id: "other-resumes", level: "recommended", state: others ? "done" : "missing", action: "other-resumes", path: "resumes",
    title: "LinkedIn export or other resumes",
    detail: others ? `${others} added.` : "None added yet.",
    improves: "Cross-checks your dates, titles, and wording.",
  });

  // Recruiter plan R7: cover letters are off until turned on, and need enough real material (one owner: the policy).
  if (features.coverLetterOptIn) {
    const secondary = (profile?.sources.secondaryResumePaths ?? settings?.secondaryResumePaths ?? []).length;
    const linkedin = Boolean(profile?.sources.linkedinProfilePath ?? settings?.linkedinProfilePath);
    const plan = coverLetterPlanFor(profile, { hasVoice, careerFiles: countCareerFiles(manifest?.selectedCareerPaths ?? [], secondary, linkedin), optIn: true });
    add({
      id: "cover-letter", level: "recommended", state: plan.write || plan.off ? "done" : "problem", action: "cover-letter", path: null,
      title: "Cover letters",
      detail: plan.off ? "Off: applications get a tailored resume only." : plan.write ? "On: each application also gets a cover letter." : plan.reason ?? "",
      improves: "Letters are written only with enough real material about the person; never a thin, generic letter.",
    });
  }

  if (features.interviewProfile) {
    const hasStoryBank = await exists(join(root, "profile", "story_bank.md"));
    add({
      id: "story-bank", level: "recommended", state: hasStoryBank ? "done" : "later", action: "none", path: "profile/story_bank.md",
      title: "Story bank",
      detail: hasStoryBank ? "Ready." : "Made automatically on your first interview prep.",
      improves: "Interview answers use your best real examples, without repeats.",
    });
  }

  // Recruiter Edition (plan R8): candidates are records the recruiter fills in, not users describing themselves.
  // The name comes from adding the candidate, Agy is signed in once for the app, and the career story and voice are
  // asked for only by the Cover letters row when letters are turned on.
  if (features.candidates) {
    const lettersOn = profile?.preferences.coverLetter.enabled === true;
    const leftOut = new Set(["profile", "other-resumes", ...(lettersOn ? [] : ["story", "voice"])]);
    for (let index = items.length - 1; index >= 0; index -= 1) if (leftOut.has(items[index]!.id)) items.splice(index, 1);
    const reword = (id: string, change: Partial<ReadinessItem>) => { const item = items.find((entry) => entry.id === id); if (item) Object.assign(item, change); };
    reword("resume", { title: "Base resume", improves: "Every tailored resume keeps this resume's layout, section order, dates, and length." });
    reword("agy", { title: "Agy signed in (once for all candidates)", improves: "Agy writes the tailored drafts." });
    reword("story", { title: "Career story (for cover letters)", improves: "Cover letters about the candidate's path, in their words." });
    reword("voice", { title: "Writing voice (for cover letters)", improves: "Letters sound like the candidate." });
    const context = items.find((entry) => entry.id === "context");
    if (context) Object.assign(context, {
      title: "Candidate files and notes",
      detail: careerPaths.length ? `${careerPaths.length} file${careerPaths.length === 1 ? "" : "s"} used for tailoring.` : "None yet. Add older resumes, a LinkedIn export, notes, or recruiter notes in Career context.",
      improves: "Everything here counts as the candidate's evidence; with only a resume, drafts reword the resume's own lines.",
    });
  }

  const required = items.filter((item) => item.level === "required");
  // Jobs may be added once Agy is installed: the queue itself waits until Agy is signed in and idle.
  const firstMissing = required.find((item) => item.state !== "done" && !(item.id === "agy" && input.agy.installed));
  return readinessSchema.parse({
    items,
    ready: !firstMissing,
    blocker: firstMissing ? `Finish setup first: ${firstMissing.title.charAt(0).toLowerCase()}${firstMissing.title.slice(1)}. ${firstMissing.detail}` : null,
    done: items.filter((item) => item.state === "done").length,
    total: items.length,
  });
}
