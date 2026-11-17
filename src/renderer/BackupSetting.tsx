// Settings → Privacy and data → "Back up your workspace" (regular app, #127): the whole workspace as one .zip, saved
// where the user picks. Caches and copies the app rebuilds are left out (`skipInBackup` in electron/pdf-file-actions.ts).
// The Recruiter Edition exports one candidate at a time from the candidate menu instead.
import { useState } from "react";
import { messageOf } from "./app-shared";

export function BackupSetting() {
  const [state, setState] = useState<{ kind: "idle" | "working" | "done" | "error"; text: string }>({ kind: "idle", text: "" });
  async function exportBackup() {
    setState({ kind: "working", text: "Making the backup…" });
    try {
      const result = await window.sensei.files.exportBackup();
      setState(result ? { kind: "done", text: `Saved ${result.files.toLocaleString()} files to ${result.path}.` } : { kind: "idle", text: "" });
    } catch (caught) {
      setState({ kind: "error", text: messageOf(caught, "The backup couldn't be made.") });
    }
  }
  return <div className="settings-group">
    <h3 className="settings-group-title">Back up your workspace</h3>
    <p className="settings-group-desc">One .zip of your jobs, resumes, career files, interview prep, and settings, saved where you choose. Keep it somewhere safe: it holds your personal details.</p>
    <button className="btn-quiet" disabled={state.kind === "working"} onClick={() => void exportBackup()}>{state.kind === "working" ? "Making the backup…" : "Export backup (.zip)"}</button>
    {state.text && state.kind !== "working" && <p className={`settings-group-desc ${state.kind === "error" ? "is-error" : ""}`} role="status">{state.text}</p>}
  </div>;
}
