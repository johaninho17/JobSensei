// One form per profile field (#22), used by Setup, Settings, and the first-run steps, so each field has one label, one
// instruction, and one way of saving (reading and saving: src/shared/profile-fields.ts).
import type { InterviewLogistics } from "../shared/schemas";
import type { StoryFields } from "../shared/profile-fields";

type Change<T> = (next: T) => void;

export const STORY_INTRO = "Used for cover letters, so they're about you and your path. Your own words; a sentence or two each is enough.";
export const STORY_FIELDS: Array<{ key: keyof StoryFields; label: string; hint: string }> = [
  { key: "transitionSummary", label: "Career direction", hint: "Where your career has been and where you're heading." },
  { key: "turningPoints", label: "Why you made your key moves", hint: "What made you change roles or step outside your comfort zone?" },
  { key: "workingStyle", label: "How you work when things go wrong", hint: "How you handle a stuck customer, a failing project, or friction." },
  { key: "personalValues", label: "Who you are beyond the job", hint: "What you care about, as a person." },
];

export function StoryFieldsForm({ values, onChange }: { values: StoryFields; onChange: Change<StoryFields> }) {
  return <div className="profile-fields">
    <p className="muted">{STORY_INTRO}</p>
    {STORY_FIELDS.map((field) => <label key={field.key} className="setup-field"><span>{field.label}</span>
      <textarea rows={2} value={values[field.key]} placeholder={field.hint} onChange={(event) => onChange({ ...values, [field.key]: event.target.value })} />
    </label>)}
  </div>;
}

export const LOGISTICS_INTRO = "Used word for word in interview prep and application answers. Leave a field empty if you'd rather not say; it's flagged, never guessed.";
export const LOGISTICS_FIELDS: Array<{ key: keyof InterviewLogistics; label: string; hint: string }> = [
  { key: "location", label: "Where you live or will work", hint: "e.g. Denver, CO; open to relocating" },
  { key: "workAuthorization", label: "Work authorization", hint: "e.g. US citizen; no sponsorship needed" },
  { key: "compensation", label: "Pay target", hint: "e.g. $120,000–$140,000 base" },
  { key: "noticePeriod", label: "Start date or notice", hint: "e.g. two weeks' notice" },
  { key: "workArrangement", label: "Work setup you want", hint: "e.g. hybrid or on-site, up to 3 days" },
];

export function LogisticsForm({ values, onChange }: { values: InterviewLogistics; onChange: Change<InterviewLogistics> }) {
  return <div className="profile-fields">
    <p className="muted">{LOGISTICS_INTRO}</p>
    {LOGISTICS_FIELDS.map((field) => <label key={field.key} className="setup-field"><span>{field.label}</span>
      <input value={values[field.key]} placeholder={field.hint} onChange={(event) => onChange({ ...values, [field.key]: event.target.value })} />
    </label>)}
  </div>;
}

export const PRIVATE_NAMES_LABEL = "Names to keep private";
export const PRIVATE_NAMES_HELP = "Clients, partners, or projects that must never appear in a resume or cover letter. One per line (commas work too). Drafts describe them by industry instead (\"a global retail client\").";

export function PrivateNamesField({ value, onChange }: { value: string; onChange: Change<string> }) {
  return <div className="profile-fields">
    <p className="muted">{PRIVATE_NAMES_HELP}</p>
    <label className="setup-field"><span>{PRIVATE_NAMES_LABEL}</span><textarea rows={4} value={value} onChange={(event) => onChange(event.target.value)} placeholder={"Orbit Health\nProject Falcon"} /></label>
  </div>;
}

export const VOICE_HELP = "A few lines about how you sound. Agy reads them before every letter and answer. Edit the starting lines so they sound like you.";

export function VoiceFileField({ path, value, onChange }: { path: string; value: string; onChange: Change<string> }) {
  return <div className="profile-fields">
    <p className="muted">{VOICE_HELP}</p>
    <label className="setup-field"><span>{path}</span><textarea rows={8} value={value} onChange={(event) => onChange(event.target.value)} /></label>
  </div>;
}

export type IdentityValues = { fullName: string; artifactPrefix: string; email: string; phone: string; location: string };
export const IDENTITY_FIELDS: Array<{ key: keyof IdentityValues; label: string; hint: string }> = [
  { key: "fullName", label: "Full name", hint: "As it appears on your resume" },
  { key: "artifactPrefix", label: "File name prefix", hint: "e.g. Alex_Morgan → Alex_Morgan_Northstar_Resume.pdf" },
  { key: "email", label: "Email", hint: "alex@example.com" },
  { key: "phone", label: "Phone", hint: "(555) 010-0000" },
  { key: "location", label: "Location", hint: "Denver, CO" },
];

export function IdentityForm({ values, onChange }: { values: IdentityValues; onChange: Change<IdentityValues> }) {
  return <div className="profile-fields">
    {IDENTITY_FIELDS.map((field) => <label key={field.key} className="setup-field"><span>{field.label}</span>
      <input value={values[field.key]} placeholder={field.hint} onChange={(event) => onChange({ ...values, [field.key]: event.target.value })} />
    </label>)}
  </div>;
}
