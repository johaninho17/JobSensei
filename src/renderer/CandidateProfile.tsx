// Recruiter Edition (plan Q1): one place for everything about the open candidate. Overview (what's ready and what
// helps), their base resume as written, the files Agy may use, other resumes, and the recruiter's notes. Replaces the
// separate Candidate and Career context pages of the regular app. Only rendered when FEATURES.candidates is on.
import { useEffect, useState, type ReactNode } from "react";
import type { RecruiterDefaults } from "../shared/candidates";
import { instructionLines, type CandidateProfile } from "../shared/schemas";
import { instructionProblem } from "./RecruiterSettings";
import { SubTabPanel, SubTabs } from "./SubTabs";

export type ProfileTab = "overview" | "resume" | "files" | "resumes" | "notes" | "settings";

export function ProfilePage({ name, initial, overview, resume, files, resumes, notes, settings }: {
  name: string;
  initial: ProfileTab;
  overview: ReactNode;
  resume: ReactNode;
  files: ReactNode;
  resumes: ReactNode;
  notes: ReactNode;
  settings: ReactNode;
}) {
  const [tab, setTab] = useState<ProfileTab>(initial);
  return <section className="jobs-home candidate-profile">
    <header className="page-head"><div><h1>{name}</h1><p>Their resume, files, and your notes: what Agy may use when tailoring for them. Files are only read, never changed.</p></div></header>
    <SubTabs<ProfileTab>
      idPrefix="profile"
      label="Candidate profile sections"
      value={tab}
      onChange={setTab}
      tabs={[{ id: "overview", label: "Overview" }, { id: "resume", label: "Resume" }, { id: "files", label: "Files" }, { id: "resumes", label: "Other resumes" }, { id: "notes", label: "Notes" }, { id: "settings", label: "Settings" }]}
    />
    <SubTabPanel idPrefix="profile" value={tab}>
      {tab === "overview" && overview}
      {tab === "resume" && resume}
      {tab === "files" && files}
      {tab === "resumes" && resumes}
      {tab === "notes" && notes}
      {tab === "settings" && settings}
    </SubTabPanel>
  </section>;
}

/** The base resume as written, with what JobSensei read from it and a way to replace it. */
export function BaseResumeTab({ path, read, viewer, onReplace }: { path: string | null; read: string[]; viewer: ReactNode; onReplace: () => void }) {
  return <section className="context-block base-resume-tab">
    <div className="base-resume-head">
      <h2>Base resume</h2>
      <button className="btn-quiet" onClick={onReplace}>{path ? "Replace resume" : "Choose resume"}</button>
    </div>
    {path ? <>
      <p className="muted">{path.split("/").pop()}. Every tailored resume keeps this layout and length.</p>
      {read.length > 0 && <details className="base-resume-read" open={read.some((line) => /Read from a PDF/.test(line))}><summary>What JobSensei read</summary><ul>{read.map((line) => <li key={line}>{line}</li>)}</ul></details>}
      {viewer}
    </> : <p className="muted">No base resume yet. Choose a Word or Markdown resume to start tailoring.</p>}
  </section>;
}

type Choice = "default" | "on" | "off";
const choiceOf = (value: boolean | null | undefined): Choice => value === true ? "on" : value === false ? "off" : "default";
const valueOf = (choice: Choice): boolean | null => choice === "on" ? true : choice === "off" ? false : null;

/**
 * This candidate's own settings (plan Q2): where they differ from the recruiter's defaults, and exactly what Agy is
 * given for them. "Your default" follows Settings → Defaults for every candidate.
 */
export function CandidateSettingsTab({ profile, onSaved }: { profile: CandidateProfile | null; onSaved: (profile: CandidateProfile) => void }) {
  const [defaults, setDefaults] = useState<RecruiterDefaults | null>(null);
  const [letters, setLetters] = useState<Choice>(choiceOf(profile?.preferences.coverLetter.enabled));
  const [summary, setSummary] = useState<Choice>(choiceOf(profile?.preferences.resume.includeSummary));
  const [instructions, setInstructions] = useState((profile?.preferences.agyInstructions ?? []).join("\n"));
  const [preview, setPreview] = useState<{ styleRules: string[]; instructions: string[]; baseResumeHasSummary: boolean | null } | null>(null);
  const [state, setState] = useState<"ready" | "saving" | "saved">("ready");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void window.sensei.candidates.recruiterSettings().then((settings) => setDefaults(settings.defaults), () => setDefaults(null));
    void window.sensei.profile.preview().then(setPreview, () => setPreview(null));
  }, []);
  if (!profile) return <p className="muted">Reading the candidate's settings…</p>;
  const onOff = (value: boolean | undefined) => value === undefined ? "" : value ? " (on)" : " (off)";
  async function save() {
    if (!profile) return;
    const lines = instructionLines(instructions);
    const problem = instructionProblem(lines);
    if (problem) { setError(problem); return; }
    setState("saving"); setError(null);
    try {
      const next = await window.sensei.profile.updatePreferences({ ...profile.preferences, coverLetter: { ...profile.preferences.coverLetter, enabled: valueOf(letters) }, resume: { ...profile.preferences.resume, includeSummary: valueOf(summary) }, agyInstructions: lines });
      onSaved(next);
      setPreview(await window.sensei.profile.preview().catch(() => null));
      setState("saved");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't save."); setState("ready"); }
  }
  return <section className="context-block candidate-settings">
    <h2>For {profile.identity.fullName || "this candidate"}</h2>
    <p className="muted">Anything left on "Your default" follows Settings → Defaults for every candidate.</p>
    <label><span>Cover letters</span><select value={letters} onChange={(event) => { setLetters(event.target.value as Choice); setState("ready"); }}>
      <option value="default">Your default{onOff(defaults?.coverLetters)}</option><option value="on">On</option><option value="off">Off</option>
    </select></label>
    <label><span>Tailor the resume summary {preview?.baseResumeHasSummary === false && <small>(their base resume has no summary, so this has no effect)</small>}</span><select value={summary} onChange={(event) => { setSummary(event.target.value as Choice); setState("ready"); }}>
      <option value="default">Your default{onOff(defaults?.tailorSummary)}</option><option value="on">On</option><option value="off">Off</option>
    </select></label>
    <label><span>Instructions for Agy <small>one per line; for this candidate only. They win over your instructions for every candidate, and can't override the truth rules.</small></span><textarea rows={4} value={instructions} placeholder={"Lead with their B2B SaaS work.\nKeep the 2019–2020 career break out of bullets."} onChange={(event) => { setInstructions(event.target.value); setState("ready"); }} /></label>
    <div className="onboarding-actions">
      <button className="btn-primary" disabled={state === "saving"} onClick={() => void save()}>{state === "saving" ? "Saving…" : "Save"}</button>
      {state === "saved" && <span className="muted" role="status">Saved</span>}
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <h2>What Agy sees for them</h2>
    {preview ? <>
      {preview.styleRules.length > 0 && <><h3>Voice and story</h3><ul className="settings-preview-list">{preview.styleRules.map((rule) => <li key={rule}>{rule}</li>)}</ul></>}
      <h3>Rules for every application</h3>
      <ul className="settings-preview-list">{preview.instructions.map((rule) => <li key={rule}>{rule}</li>)}</ul>
    </> : <p className="muted">Preview unavailable.</p>}
  </section>;
}
