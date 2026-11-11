// Recruiter Edition (plan Q2): the recruiter's own settings: name and agency (for reports), the defaults every
// candidate inherits unless their Profile → Settings says otherwise, and privacy. Opened from the sidebar, ⌘, and
// the Candidates page. Only rendered when FEATURES.candidates is on.
import { useEffect, useState } from "react";
import { APP_RECRUITER_DEFAULTS, type RecruiterDefaults } from "../shared/candidates";
import type { PdfTextSize } from "../shared/schemas";
import { PrivacyAndTerms } from "./Privacy";

export const PDF_SIZE_LABEL: Record<PdfTextSize, string> = { auto: "Auto fit", large: "5% larger", largest: "10% larger" };
const message = (caught: unknown) => (caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "Something went wrong.");

export function RecruiterSettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [name, setName] = useState("");
  const [agency, setAgency] = useState("");
  const [defaults, setDefaults] = useState<RecruiterDefaults>(APP_RECRUITER_DEFAULTS);
  const [tab, setTab] = useState<"recruiter" | "privacy">("recruiter");
  const [state, setState] = useState<"loading" | "ready" | "saving" | "saved">("loading");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void window.sensei.candidates.recruiterSettings().then((settings) => {
      setName(settings.recruiterName ?? ""); setAgency(settings.agency ?? ""); setDefaults(settings.defaults); setState("ready");
    }, (caught) => { setError(message(caught)); setState("ready"); });
  }, []);
  async function save() {
    setState("saving"); setError(null);
    try { await window.sensei.candidates.saveRecruiterSettings({ recruiterName: name.trim() || null, agency: agency.trim() || null, defaults }); setState("saved"); onSaved?.(); }
    catch (caught) { setError(message(caught)); setState("ready"); }
  }
  const set = (patch: Partial<RecruiterDefaults>) => { setDefaults((current) => ({ ...current, ...patch })); setState("ready"); };
  return <div className="search-overlay" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <div className="company-dialog recruiter-settings" role="dialog" aria-modal="true" aria-labelledby="recruiter-settings-title">
      <h2 id="recruiter-settings-title">Settings</h2>
      <nav className="candidates-nav recruiter-settings-tabs" aria-label="Settings sections">
        <button aria-current={tab === "recruiter" ? "page" : undefined} onClick={() => setTab("recruiter")}>You and your defaults</button>
        <button aria-current={tab === "privacy" ? "page" : undefined} onClick={() => setTab("privacy")}>Privacy and data</button>
      </nav>
      {tab === "recruiter" && <div className="recruiter-settings-body">
        <section>
          <h3>You</h3>
          <label><span>Your name <small>shown on reports and client updates</small></span><input value={name} maxLength={120} onChange={(event) => { setName(event.target.value); setState("ready"); }} /></label>
          <label><span>Agency <small>optional</small></span><input value={agency} maxLength={120} onChange={(event) => { setAgency(event.target.value); setState("ready"); }} /></label>
        </section>
        <section>
          <h3>Defaults for every candidate</h3>
          <p className="muted">A candidate follows these unless their Profile → Settings says otherwise.</p>
          <label className="settings-toggle-row"><input type="checkbox" checked={defaults.coverLetters} onChange={(event) => set({ coverLetters: event.target.checked })} /><span><strong>Write cover letters</strong><small>Only when the candidate has a career story, a writing voice, and two or more files besides the resume.</small></span></label>
          <label className="settings-toggle-row"><input type="checkbox" checked={defaults.tailorSummary} onChange={(event) => set({ tailorSummary: event.target.checked })} /><span><strong>Tailor the resume summary</strong><small>Only for resumes that already have a summary; otherwise it stays as written.</small></span></label>
          <label><span>PDF text size</span><select value={defaults.pdfTextSize} onChange={(event) => set({ pdfTextSize: event.target.value as PdfTextSize })}>{(Object.keys(PDF_SIZE_LABEL) as PdfTextSize[]).map((size) => <option key={size} value={size}>{PDF_SIZE_LABEL[size]}</option>)}</select></label>
        </section>
      </div>}
      {tab === "privacy" && <div className="recruiter-settings-body"><PrivacyAndTerms /></div>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="onboarding-actions">
        {tab === "recruiter" && <button className="btn-primary" disabled={state === "loading" || state === "saving"} onClick={() => void save()}>{state === "saving" ? "Saving…" : "Save"}</button>}
        <button className="btn-quiet" onClick={onClose}>Close</button>
        {state === "saved" && <span className="muted" role="status">Saved</span>}
      </div>
    </div>
  </div>;
}
