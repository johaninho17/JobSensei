import { useEffect, useRef, useState } from "react";
import { LogisticsForm, PrivateNamesField, StoryFieldsForm, VoiceFileField } from "./ProfileFields";
import { type CandidateProfile, type WorkspaceSummary, type InterviewLogistics } from "../shared/schemas";
import { type Readiness, type ReadinessItem } from "../shared/readiness";
import { SubTabPanel, SubTabs } from "./SubTabs";
import { PrivacyDialog } from "./Privacy";
import { Section } from "./Section";
import { WorkspaceFolders } from "./WorkspaceFolders";
import { logisticsUpdate, parseNames, readLogistics, readStoryFields, storyUpdate, type StoryFields } from "../shared/profile-fields";
import { messageOf } from "./app-shared";
import { DocInline } from "./JobWorkspace";
import { PageHead } from "./BentoPrimitives";

type OnboardingStep = "profile" | "resume" | "agy" | "better";
const ONBOARDING_STEPS: Array<{ id: OnboardingStep; label: string }> = [
  { id: "profile", label: "Your name" },
  { id: "resume", label: "Base resume" },
  { id: "agy", label: "Agy" },
  { id: "better", label: "Make it better" },
];

/**
 * First run: the required steps one at a time, each done inside the app (name, base resume, Agy), then the
 * recommended steps with Skip, ending on adding the first job. Readiness (electron/setup-readiness.ts) decides
 * when each step is done; this screen never keeps its own copy of those rules.
 */
export function Onboarding({ workspace, profile, readiness, onProfileCreated, onProfileSaved, onChooseBase, onOpenAgy, onRefresh, onAction, onFinish }: { workspace: WorkspaceSummary; profile: CandidateProfile | null; readiness: Readiness | null; onProfileCreated: (profile: CandidateProfile) => Promise<void>; onProfileSaved: (profile: CandidateProfile | null) => void; onChooseBase: () => Promise<void>; onOpenAgy: () => void; onRefresh: () => void; onAction: (action: ReadinessItem["action"]) => void; onFinish: (destination: "jobs" | "context") => void }) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [editing, setEditing] = useState<ReadinessItem["action"] | null>(null);
  const item = (id: string) => readiness?.items.find((entry) => entry.id === id) ?? null;
  const resume = item("resume");
  const agy = item("agy");
  const [step, setStep] = useState<OnboardingStep>("profile");
  // The starting step is chosen once the profile and readiness have loaded: the first one not done yet.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !readiness) return;
    started.current = true;
    setStep(!profile ? "profile" : resume?.state !== "done" ? "resume" : "agy");
  }, [readiness, profile]);
  const [fullName, setFullName] = useState("");
  const [artifactPrefix, setArtifactPrefix] = useState("");
  const [state, setState] = useState<"idle" | "saving">("idle");
  const [message, setMessage] = useState("");
  // On the Agy step, check every 3 seconds so the step turns green soon after sign-in.
  useEffect(() => {
    if (step !== "agy" || agy?.state === "done") return;
    const timer = window.setInterval(onRefresh, 3000);
    return () => window.clearInterval(timer);
  }, [step, agy?.state]);
  // Move back to an earlier step if its requirement stops being met (for example, the resume file was removed).
  useEffect(() => { if (started.current && !profile && step !== "profile") setStep("profile"); }, [profile, step]);
  function updateName(value: string) {
    setFullName(value);
    if (!artifactPrefix) setArtifactPrefix(value.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
  }
  async function createProfile() {
    if (!fullName.trim() || !artifactPrefix.trim()) return;
    setState("saving");
    setMessage("");
    try {
      await onProfileCreated(await window.sensei.profile.create({ fullName, artifactPrefix }));
      setStep("resume");
    } catch (caught) {
      setMessage(messageOf(caught, "Unable to save your name."));
    } finally { setState("idle"); }
  }
  async function chooseResume() {
    setState("saving");
    try { await onChooseBase(); } finally { setState("idle"); }
  }
  const current = ONBOARDING_STEPS.findIndex((entry) => entry.id === step);
  const recommended = (readiness?.items ?? []).filter((entry) => entry.level === "recommended" && entry.state !== "later");
  return <section className="get-started onboarding" aria-labelledby="onboarding-title">
    <div className="get-started-copy">
      <h1 id="onboarding-title">Get JobSensei ready</h1>
      <p>A few steps, all inside the app. Your files stay on this computer, in your workspace folder; nothing is uploaded except what Agy reads to draft for you. <button className="btn-link" onClick={() => setPrivacyOpen(true)}>Privacy and terms</button></p>
      {privacyOpen && <PrivacyDialog onClose={() => setPrivacyOpen(false)} />}
    </div>
    <ol className="onboarding-steps" aria-label="Setup steps">{ONBOARDING_STEPS.map((entry, index) => <li key={entry.id} className={index < current ? "is-complete" : index === current ? "is-current" : ""} aria-current={index === current ? "step" : undefined}><span>{index < current ? "✓" : index + 1}</span>{entry.label}</li>)}</ol>
    <div className="setup-card onboarding-card">
      {step === "profile" && profile && <>
        <h2>Your name</h2>
        <p>Saved as <strong>{profile.identity.fullName}</strong>; your files start with <code>{profile.identity.artifactPrefix}</code>. You can change it later in Settings.</p>
        <div className="onboarding-actions"><button className="btn-primary" onClick={() => setStep(resume?.state === "done" ? "agy" : "resume")}>Continue</button></div>
      </>}
      {step === "profile" && !profile && <>
        <h2>Your name</h2>
        <p>It goes on every resume and cover letter. The file prefix names your files, like <code>{artifactPrefix || "Alex_Morgan"}_Resume.md</code>.</p>
        <label>Full name<input autoFocus value={fullName} onChange={(event) => updateName(event.target.value)} placeholder="Alex Morgan" /></label>
        <label>File prefix<input value={artifactPrefix} onChange={(event) => setArtifactPrefix(event.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} placeholder="Alex_Morgan" /></label>
        <div className="onboarding-actions"><button className="btn-primary" disabled={!fullName.trim() || !artifactPrefix.trim() || state === "saving"} onClick={() => void createProfile()}>{state === "saving" ? "Saving…" : "Continue"}</button></div>
      </>}
      {step === "resume" && <>
        <h2>Your base resume</h2>
        <p>Choose your best resume as a Word (.docx) or Markdown (.md) file. Every tailored resume keeps its layout, order, and dates. A PDF works only when its Word or Markdown version is in the same folder.</p>
        {resume && resume.state !== "missing" && <div className={`onboarding-result is-${resume.state}`} role="status">
          <strong>{resume.state === "done" ? "Here is what JobSensei read" : "This resume can't be used yet"}</strong>
          <p>{resume.detail}</p>
          {resume.lines.length > 0 && <ul>{resume.lines.map((line) => <li key={line}>{line}</li>)}</ul>}
        </div>}
        <div className="onboarding-actions">
          {resume?.state === "done" && <button className="btn-primary" onClick={() => setStep("agy")}>Looks right</button>}
          <button className={resume?.state === "done" ? "btn-quiet" : "btn-primary"} disabled={state === "saving"} onClick={() => void chooseResume()}>{resume?.state === "missing" || !resume ? "Choose your resume" : "Choose another"}</button>
        </div>
      </>}
      {step === "agy" && <>
        <h2>Sign in to Agy</h2>
        <p>Agy writes your drafts and interview prep. JobSensei gives Agy its own private home, so you sign in once here, even if you use Agy elsewhere.</p>
        <div className={`onboarding-result is-${agy?.state === "done" ? "done" : agy?.state === "problem" ? "problem" : "missing"}`} role="status">
          <strong>{agy?.state === "done" ? "Agy is signed in" : agy?.state === "problem" ? "Agy is waiting for you" : "Not signed in yet"}</strong>
          <p>{agy?.state === "done" ? "You're ready to add jobs." : agy?.detail ?? "Checking…"}</p>
        </div>
        <div className="onboarding-actions">
          {agy?.state === "done" ? <button className="btn-primary" onClick={() => setStep("better")}>Continue</button> : <>
            <button className="btn-primary" disabled={!workspace.agyAvailable} onClick={onOpenAgy}>Open Agy and sign in</button>
            <button className="btn-link" onClick={() => setStep("better")}>Do this later</button>
          </>}
        </div>
        {agy?.state !== "done" && <p className="muted onboarding-note">This page checks again every few seconds. Jobs you add before signing in wait in the queue.</p>}
      </>}
      {step === "better" && <>
        <h2>Make your drafts better</h2>
        <p>None of these are required. Each one makes resumes, letters, or interview prep more yours. You can do them any time from Setup in the sidebar.</p>
        <ul className="onboarding-better">{recommended.map((entry) => <li key={entry.id} className={`is-${entry.state}`}>
          <span className="setup-state">{entry.state === "done" ? "Done" : "To do"}</span>
          <div><strong>{entry.title}</strong><small>{entry.improves}</small></div>
          {entry.state !== "done" && entry.action !== "none" && editing !== entry.action && <button className="btn-quiet" onClick={() => INLINE_SETUP.has(entry.action) ? setEditing(entry.action) : entry.action === "context" ? onFinish("context") : onAction(entry.action)}>{INLINE_SETUP.has(entry.action) ? "Fill in" : entry.action === "context" ? "Add files" : ACTION_LABEL[entry.action] ?? "Open"}</button>}
          {editing === entry.action && <div className="setup-row-editor"><SetupEditor action={entry.action} profile={profile} onSaved={(next) => { onProfileSaved(next); onRefresh(); }} onClose={() => setEditing(null)} /></div>}
        </li>)}</ul>
        <div className="onboarding-actions"><button className="btn-primary" onClick={() => onFinish("jobs")}>Add your first job</button></div>
      </>}
      {message && <p className="inline-error" role="alert">{message}</p>}
    </div>
    {current > 0 && <button className="btn-link onboarding-back" onClick={() => setStep(ONBOARDING_STEPS[current - 1]!.id)}>Back</button>}
  </section>;
}

/** Setup items that are filled in right in the row instead of in Settings. */
const INLINE_SETUP: ReadonlySet<ReadinessItem["action"]> = new Set(["story", "logistics", "private-names", "voice", "targets", "cover-letter", "facts"]);
const VOICE_TEMPLATE = [
  "# Application voice profile",
  "- Plain words and short sentences; no buzzwords.",
  "- Sound like a person explaining their own work to a colleague.",
  "- Lead with what you did, then why it mattered.",
  "- Warm and direct: confident, without overselling.",
  "",
].join("\n");

/**
 * A small editor for one Setup item, saved straight to the profile (or the voice file). Each field says where it is
 * used, so nothing is filled in without the user knowing why.
 */
function SetupEditor({ action, profile, onSaved, onClose }: { action: ReadinessItem["action"]; profile: CandidateProfile | null; onSaved: (profile: CandidateProfile | null) => void; onClose: () => void }) {
  // The same reading and saving as Settings (src/shared/profile-fields.ts owns both).
  const logistics = readLogistics(profile);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...readStoryFields(profile),
    ...logistics,
    names: (profile?.truth.confidentialNames ?? []).join("\n"),
    voice: "",
    roles: (profile?.preferences.targets.roles ?? []).join("\n"),
    locations: (profile?.preferences.targets.locations ?? []).join("\n"),
    level: profile?.preferences.targets.level ?? "",
    salaryFloor: profile?.preferences.targets.salaryFloor ? String(profile.preferences.targets.salaryFloor) : "",
    skip: (profile?.preferences.targets.skipCompanies ?? []).join("\n"),
    weeklyTarget: profile?.preferences.targets.weeklyTarget ? String(profile.preferences.targets.weeklyTarget) : "",
    email: profile?.identity.email ?? "", phone: profile?.identity.phone ?? "", links: (profile?.identity.links ?? []).join("\n"),
    factLocation: profile?.identity.location ?? profile?.preferences.interview.location ?? "",
    extra: (profile?.preferences.applicationFacts.extra ?? []).map((fact) => `${fact.label}: ${fact.value}`).join("\n"),
  }));
  const [modes, setModes] = useState<string[]>(() => profile?.preferences.targets.workModes ?? []);
  const [sponsorship, setSponsorship] = useState(() => profile?.preferences.targets.needsSponsorship ?? false);
  const [approval, setApproval] = useState(() => profile?.preferences.targets.approval ?? false);
  const [lettersOn, setLettersOn] = useState(() => profile?.preferences.coverLetter.enabled ?? !FEATURES.coverLetterOptIn);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const voicePath = profile?.sources.applicationVoicePath ?? "context/application_voice_profile.md";
  useEffect(() => {
    if (action !== "voice") return;
    void window.sensei.files.preview(voicePath).then((preview) => setValues((current) => ({ ...current, voice: preview.content?.trim() ? preview.content : VOICE_TEMPLATE }))).catch(() => setValues((current) => ({ ...current, voice: VOICE_TEMPLATE })));
  }, [action, voicePath]);
  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((current) => ({ ...current, [key]: event.target.value }));
  async function save() {
    if (!profile && action !== "voice") return;
    setSaving(true);
    setProblem("");
    try {
      let next: CandidateProfile | null = profile;
      if (action === "story") {
        const story = storyUpdate(values as unknown as StoryFields);
        next = await window.sensei.profile.updateDetails({ transitionSummary: story.transitionSummary });
        next = await window.sensei.profile.updatePreferences({ ...next.preferences, coverLetter: { ...next.preferences.coverLetter, narrativePillars: story.narrativePillars } });
      } else if (action === "logistics") {
        next = await window.sensei.profile.updateDetails({ interviewLogistics: logisticsUpdate(values as unknown as InterviewLogistics) });
      } else if (action === "private-names") {
        next = await window.sensei.profile.updateDetails({ confidentialNames: parseNames(values.names!) });
      } else if (action === "voice") {
        await window.sensei.profile.saveVoice(values.voice!);
      } else if (action === "facts" && profile) {
        next = await window.sensei.candidates.saveFacts({
          email: values.email, phone: values.phone, location: values.factLocation,
          links: values.links!.split("\n").map((line) => line.trim()).filter(Boolean),
          workAuthorization: values.workAuthorization, compensation: values.compensation, noticePeriod: values.noticePeriod, workArrangement: values.workArrangement,
          extra: values.extra!.split("\n").map((line) => { const at = line.indexOf(":"); return at > 0 ? { label: line.slice(0, at).trim(), value: line.slice(at + 1).trim() } : null; }).filter((fact): fact is { label: string; value: string } => Boolean(fact?.label && fact.value)),
        });
      } else if (action === "cover-letter" && profile) {
        next = await window.sensei.profile.updatePreferences({ ...profile.preferences, coverLetter: { ...profile.preferences.coverLetter, enabled: lettersOn } });
      } else if (action === "targets" && profile) {
        const lines = (value: string) => [...new Set(value.split(/\n|,/).map((line) => line.trim()).filter(Boolean))].slice(0, 12);
        const floor = Number(values.salaryFloor!.replace(/[^0-9.]/g, ""));
        next = await window.sensei.profile.updatePreferences({ ...profile.preferences, targets: { roles: lines(values.roles!), locations: lines(values.locations!), workModes: modes as CandidateProfile["preferences"]["targets"]["workModes"], level: (values.level || null) as CandidateProfile["preferences"]["targets"]["level"], salaryFloor: values.salaryFloor!.trim() && floor > 0 ? Math.round(floor) : null, needsSponsorship: sponsorship, skipCompanies: lines(values.skip!).slice(0, 40), weeklyTarget: Number(values.weeklyTarget) >= 1 ? Math.min(500, Math.round(Number(values.weeklyTarget))) : null, approval } });
      }
      onSaved(next);
      onClose();
    } catch (caught) {
      setProblem(messageOf(caught, "Couldn't save that."));
    } finally { setSaving(false); }
  }
  const field = (key: string, label: string, hint: string, multiline = false) => <label key={key} className="setup-field"><span>{label}</span>
    {multiline ? <textarea rows={2} value={values[key]} onChange={set(key)} placeholder={hint} /> : <input value={values[key]} onChange={set(key)} placeholder={hint} />}
  </label>;
  return <div className="setup-editor">
    {action === "story" && <StoryFieldsForm values={values as unknown as StoryFields} onChange={(next) => setValues((current) => ({ ...current, ...next }))} />}
    {action === "logistics" && <LogisticsForm values={values as unknown as InterviewLogistics} onChange={(next) => setValues((current) => ({ ...current, ...next }))} />}
    {action === "private-names" && <PrivateNamesField value={values.names!} onChange={(names) => setValues((current) => ({ ...current, names }))} />}
    {action === "voice" && <VoiceFileField path={voicePath} value={values.voice!} onChange={(voice) => setValues((current) => ({ ...current, voice }))} />}
    {action === "facts" && <>
      <p className="muted">What employer forms ask for. Each job shows these with copy buttons while you fill in its form. They are never sent to Agy and never guessed; leave anything blank you don't have.</p>
      {field("email", "Email", "alex@example.com")}
      {field("phone", "Phone", "(555) 010-0000")}
      {field("factLocation", "Location", "Denver, CO")}
      <label className="setup-field"><span>Links (one per line)</span><textarea rows={2} value={values.links} onChange={set("links")} placeholder={"https://linkedin.com/in/…\nhttps://portfolio.example.com"} /></label>
      {field("workAuthorization", "Work authorization", "US citizen; no sponsorship needed")}
      {field("compensation", "Pay expectation", "$90,000–$105,000 base")}
      {field("noticePeriod", "Start date or notice", "Two weeks' notice")}
      {field("workArrangement", "Work setup", "Hybrid or remote")}
      <label className="setup-field"><span>Other answers (one per line, "Question: answer")</span><textarea rows={3} value={values.extra} onChange={set("extra")} placeholder={"Willing to relocate: No\nHow did you hear about us: Recruiter"} /></label>
    </>}
    {action === "cover-letter" && <>
      <p className="muted">When on, each application also gets a cover letter about {profile?.identity.fullName ?? "the candidate"}: their career story, how they work, in their voice. A letter is written only when there is enough real material: the career story (direction plus two of the three questions), a writing voice, and at least two checked career files besides the base resume. Otherwise the job page says what's missing.</p>
      <label className="setup-check"><input type="checkbox" checked={lettersOn} onChange={(event) => setLettersOn(event.target.checked)} /> Write cover letters</label>
    </>}
    {action === "targets" && <>
      <p className="muted">Used by "Who is this for?" to suggest this candidate for a posting, with the reasons shown. Leave anything empty that doesn't matter; empty fields never count against a posting.</p>
      <label className="setup-field"><span>Roles they want (one per line)</span><textarea rows={3} value={values.roles} onChange={set("roles")} placeholder={"Support Engineer\nCustomer Success Manager"} /></label>
      <fieldset className="setup-field setup-choices"><legend>Work setup they'd take</legend>{(["remote", "hybrid", "onsite"] as const).map((mode) => <label key={mode}><input type="checkbox" checked={modes.includes(mode)} onChange={() => setModes((current) => current.includes(mode) ? current.filter((value) => value !== mode) : [...current, mode])} /> {mode === "onsite" ? "On-site" : mode[0]!.toUpperCase() + mode.slice(1)}</label>)}</fieldset>
      <label className="setup-field"><span>Places they can work (one per line; ignored for remote jobs)</span><textarea rows={2} value={values.locations} onChange={set("locations")} placeholder={"Denver\nColorado"} /></label>
      <label className="setup-field"><span>Level</span><select value={values.level} onChange={(event) => setValues((current) => ({ ...current, level: event.target.value }))}><option value="">Any</option>{["intern", "junior", "mid", "senior", "staff", "lead", "manager", "director", "executive"].map((level) => <option key={level} value={level}>{level[0]!.toUpperCase() + level.slice(1)}</option>)}</select></label>
      {field("salaryFloor", "Lowest yearly pay (US dollars)", "e.g. 90000")}
      <label className="setup-check"><input type="checkbox" checked={sponsorship} onChange={(event) => setSponsorship(event.target.checked)} /> Needs visa sponsorship</label>
      {field("weeklyTarget", "Applications per week (their package; optional)", "e.g. 10")}
      <label className="setup-check"><input type="checkbox" checked={approval} onChange={(event) => setApproval(event.target.checked)} /> The candidate approves each job before it is tailored</label>
      <label className="setup-field"><span>Companies to skip (one per line; the current employer on the resume is always skipped)</span><textarea rows={2} value={values.skip} onChange={set("skip")} placeholder={"A former employer\nA company they've already applied to"} /></label>
    </>}
    {problem && <p className="inline-error" role="alert">{problem}</p>}
    <div className="onboarding-actions"><button className="btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button><button className="btn-quiet" onClick={onClose}>Cancel</button></div>
  </div>;
}

const READINESS_STATE: Record<ReadinessItem["state"], string> = { done: "Done", missing: "To do", problem: "Needs a fix", later: "Comes later" };
const ACTION_LABEL: Partial<Record<ReadinessItem["action"], string>> = { profile: "Open Settings", resume: "Choose resume", agy: "Open Agy", context: "Open Career context", story: "Open Settings", logistics: "Open Settings", "private-names": "Open Settings", "other-resumes": "Add a resume", voice: "Open Settings" };

/** Setup: what JobSensei needs (required) and what makes it better (recommended), each with how to do it in the app. */
export function SetupHome({ readiness, profile, onProfileSaved, onRefresh, onAction, onReveal, onAddLinkedin, onToast, embedded = false }: { onToast: (message: string) => void; /** Shown as a tab of the Profile page (U78): no page title of its own. */ embedded?: boolean; readiness: Readiness | null; profile: CandidateProfile | null; onProfileSaved: (profile: CandidateProfile | null) => void; onRefresh: () => void; onAction: (action: ReadinessItem["action"]) => void; onReveal: (path: string) => void; onAddLinkedin: () => void }) {
  useEffect(() => { onRefresh(); }, []);
  const [editing, setEditing] = useState<ReadinessItem["action"] | null>(null);
  if (!readiness) return <section className="setup-home"><p className="muted">Checking your setup…</p></section>;
  const row = (item: ReadinessItem) => <li key={item.id} className={`setup-row is-${item.state}`}>
    <span className="setup-state">{READINESS_STATE[item.state]}</span>
    <div className="setup-text"><strong>{item.title}</strong><p>{item.detail}</p>{item.lines.length > 0 && <ul className="setup-lines">{item.lines.map((line) => <li key={line}>{line}</li>)}</ul>}<small>{item.improves}</small></div>
    <span className="setup-actions">
      {INLINE_SETUP.has(item.action) ? editing !== item.action && <button className={item.state === "done" ? "btn-link" : "btn-quiet"} onClick={() => setEditing(item.action)}>{item.state === "done" ? "Edit" : "Fill in"}</button>
        : item.state !== "done" && item.action !== "none" && ACTION_LABEL[item.action] && <button className={item.level === "required" ? "btn-primary" : "btn-quiet"} onClick={() => onAction(item.action)}>{ACTION_LABEL[item.action]}</button>}
      {item.action === "other-resumes" && <button className="btn-quiet" onClick={onAddLinkedin}>Add LinkedIn export</button>}
      {item.path && <button className="btn-link" onClick={() => onReveal(item.path!)}>Show in {navigator.platform.startsWith("Win") ? "Explorer" : "Finder"}</button>}
    </span>
    {editing === item.action && <div className="setup-row-editor"><SetupEditor action={item.action} profile={profile} onSaved={(next) => { onProfileSaved(next); onRefresh(); }} onClose={() => setEditing(null)} /></div>}
  </li>;
  return <section className="setup-home">
    {/* Embedded in Profile this is a one-line status, not a second page header (U82). */}
    {(() => { const status = <>{FEATURES.candidates ? (readiness.ready ? "Ready for jobs." : "Add the base resume to start tailoring.") : readiness.ready ? "Ready. The recommended steps make drafts and prep better." : "Finish the required steps so JobSensei can send jobs to Agy."} <button className="btn-link" onClick={onRefresh}>Check again</button> · <button className="btn-link" onClick={() => onReveal("")}>Open folder</button></>;
      return embedded || FEATURES.candidates ? <p className="setup-status">{status}</p> : <PageHead title="Setup" status={status} />; })()}
    {(["required", "recommended"] as const).map((level) => { const items = readiness.items.filter((item) => item.level === level); const done = items.filter((item) => item.state === "done").length; return <Section key={level} id={`setup-${level}`} title={level === "required" ? "Required" : "Recommended"} count={`${done} of ${items.length}`} defaultOpen={level === "recommended" || done < items.length}>
      <ol className="setup-list">{items.map(row)}</ol>
    </Section>; })}
    <WorkspaceFolders onToast={onToast} onChanged={onRefresh} />
  </section>;
}

type ContextView = "setup" | "sources" | "notes" | "resumes" | "jobs" | "stories" | "voice" | "tune";

/** Career context: subtabs for sources, resumes, job files, and the profile's story bank and interview voice. */
/**
 * Add career files from the app: pick a kind, then Add files or drop files here. Copies go to context/structured
 * (work records: projects, results, reviews) or context/broad (notes, old letters, anything else) and are checked for Agy.
 */
export function ContextAdder({ onAdd, onReveal }: { onAdd: (kind: "structured" | "broad", paths?: string[]) => void; onReveal: () => void }) {
  const [kind, setKind] = useState<"structured" | "broad">("structured");
  const [over, setOver] = useState(false);
  const help = { structured: "Work records: projects, results, performance reviews, a list of what you did at each job. The strongest evidence.", broad: "Notes and other documents: old cover letters, LinkedIn posts, project write-ups. Used for background and voice." } as const;
  return <div className={`context-add${over ? " is-over" : ""}`}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setOver(true); } }}
    onDragLeave={() => setOver(false)}
    onDrop={(event) => {
      event.preventDefault();
      setOver(false);
      const paths = [...event.dataTransfer.files].map((file) => window.sensei.files.pathForFile(file)).filter(Boolean);
      if (paths.length) onAdd(kind, paths);
    }}>
    {/* The Recruiter Edition has one kind of candidate file: every file counts as evidence (recruiter plan R4). */}
    {!FEATURES.candidates && <div className="segmented" role="group" aria-label="Kind of file">
      <button aria-pressed={kind === "structured"} onClick={() => setKind("structured")}>Work records</button>
      <button aria-pressed={kind === "broad"} onClick={() => setKind("broad")}>Notes and documents</button>
    </div>}
    <p>{FEATURES.candidates ? "Older resumes, a LinkedIn export, notes, work samples: anything the candidate gave you. Every file counts as their evidence." : help[kind]}</p>
    <div className="context-add-actions">
      <button className="btn-primary" onClick={() => onAdd(kind)}>Add files</button>
      <span className="muted">or drop files here (Word, PDF, Markdown, text). Copies are added and checked for Agy; your originals stay where they are.</span>
      <button className="btn-link" onClick={onReveal}>Show the context folder</button>
    </div>
  </div>;
}

export function ContextHome({ notice, setup, sources, notes, resumes, jobFiles, tune, startView, onOpen }: { notice: React.ReactNode; /** Setup as the Profile page's first tab (U78: Setup and Career context are one page). */ setup?: React.ReactNode; tune?: React.ReactNode; /** A tab to switch to when another page asks (Setup in the sidebar, Today's Tune tile). */ startView?: "setup" | "tune" | null; sources: React.ReactNode; notes: React.ReactNode; resumes: React.ReactNode; jobFiles: React.ReactNode; onOpen: (path: string) => void }) {
  const [view, setView] = useState<ContextView>(startView === "setup" && setup ? "setup" : "sources");
  useEffect(() => { if ((startView === "tune" && tune) || (startView === "setup" && setup)) setView(startView); }, [startView, tune !== undefined, setup !== undefined]);
  return <section className="jobs-home context-home">
    <PageHead title={setup ? "Profile" : "Career context"} tip={FEATURES.candidates ? "The candidate's resume, files, and your notes: what Agy may use when tailoring. Files are only read, never changed." : setup ? "Your setup and the sources Agy treats as facts about you. Source files are only read, never changed." : "The sources Agy treats as facts about you. Source files are only read, never changed."} />
    {notice}
    <SubTabs<ContextView>
      idPrefix="ctx"
      label="Career context sections"
      value={view}
      onChange={setView}
      tabs={[...(setup ? [{ id: "setup" as const, label: "Setup" }] : []), { id: "sources", label: "Sources" }, ...(notes ? [{ id: "notes" as const, label: "Recruiter notes" }] : []), { id: "resumes", label: "Resumes" }, { id: "jobs", label: "Job files" }, ...(tune ? [{ id: "tune" as const, label: "Tune" }] : []), ...(FEATURES.interviewProfile ? [{ id: "stories" as const, label: "Story bank" }, { id: "voice" as const, label: "Interview voice" }] : [])]}
    />
    <SubTabPanel idPrefix="ctx" value={view}>
      {view === "setup" && setup}
      {view === "sources" && sources}
      {view === "notes" && notes}
      {view === "resumes" && resumes}
      {view === "jobs" && jobFiles}
      {view === "tune" && tune}
      {FEATURES.interviewProfile && view === "stories" && <DocInline path="profile/story_bank.md" label="story bank (it is made on your first interview prep)" />}
      {FEATURES.interviewProfile && view === "voice" && <DocInline path="profile/interview_voice.md" label="interview voice (it is made when you import an interview)" />}
    </SubTabPanel>
  </section>;
}
