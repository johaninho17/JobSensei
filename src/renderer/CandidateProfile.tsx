// Recruiter Edition (plan Q1): one place for everything about the open candidate. Overview (what's ready and what
// helps), their base resume as written, the files Agy may use, other resumes, and the recruiter's notes. Replaces the
// separate Candidate and Career context pages of the regular app. Only rendered when FEATURES.candidates is on.
import { useState, type ReactNode } from "react";
import { SubTabPanel, SubTabs } from "./SubTabs";

export type ProfileTab = "overview" | "resume" | "files" | "resumes" | "notes";

export function ProfilePage({ name, initial, overview, resume, files, resumes, notes }: {
  name: string;
  initial: ProfileTab;
  overview: ReactNode;
  resume: ReactNode;
  files: ReactNode;
  resumes: ReactNode;
  notes: ReactNode;
}) {
  const [tab, setTab] = useState<ProfileTab>(initial);
  return <section className="jobs-home candidate-profile">
    <header className="page-head"><div><h1>{name}</h1><p>Their resume, files, and your notes: what Agy may use when tailoring for them. Files are only read, never changed.</p></div></header>
    <SubTabs<ProfileTab>
      idPrefix="profile"
      label="Candidate profile sections"
      value={tab}
      onChange={setTab}
      tabs={[{ id: "overview", label: "Overview" }, { id: "resume", label: "Resume" }, { id: "files", label: "Files" }, { id: "resumes", label: "Other resumes" }, { id: "notes", label: "Notes" }]}
    />
    <SubTabPanel idPrefix="profile" value={tab}>
      {tab === "overview" && overview}
      {tab === "resume" && resume}
      {tab === "files" && files}
      {tab === "resumes" && resumes}
      {tab === "notes" && notes}
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
      {read.length > 0 && <details className="base-resume-read"><summary>What JobSensei read</summary><ul>{read.map((line) => <li key={line}>{line}</li>)}</ul></details>}
      {viewer}
    </> : <p className="muted">No base resume yet. Choose a Word or Markdown resume to start tailoring.</p>}
  </section>;
}
