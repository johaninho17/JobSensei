// Setup → Your folders: a map of the active layout, items at the top of the workspace that belong elsewhere, and
// the tidy layout (preview, apply, undo). Names and suggestions come from src/shared/workspace-layout.ts; the moves
// from electron/layout-migration.ts.
import { useEffect, useState } from "react";
import type { LayoutPlan } from "../shared/schemas";
import { workspaceMap } from "../shared/workspace-layout";
import { Section } from "./Section";

export function WorkspaceFolders({ onToast, onChanged }: { onToast: (message: string) => void; onChanged: () => void }) {
  const [plan, setPlan] = useState<LayoutPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [confirming, setConfirming] = useState(false);
  const load = () => void window.sensei.layout.plan().then(setPlan).catch((reason) => setProblem(message(reason)));
  useEffect(load, []);

  async function run(action: "apply" | "undo") {
    setBusy(true);
    setProblem("");
    try {
      if (action === "apply") { setPlan(await window.sensei.layout.apply()); onToast("Folders tidied. Agy was closed; open it again to continue."); }
      else {
        const result = await window.sensei.layout.undo();
        onToast(result.skipped.length ? `Put back ${result.restored}; ${result.skipped.length} could not be moved.` : "Folders are back the way they were. Open Agy again to continue.");
        if (result.skipped.length) setProblem(`Not moved back: ${result.skipped.slice(0, 3).join("; ")}${result.skipped.length > 3 ? "…" : ""}`);
        load();
      }
      setConfirming(false);
      onChanged();
    } catch (reason) { setProblem(message(reason)); } finally { setBusy(false); }
  }

  if (!plan) return null;
  const tidy = plan.version === 2;
  const homes = plan.moves.filter((move) => move.kind === "move");
  const archived = plan.moves.filter((move) => move.kind === "archive");
  return <Section id="setup-folders" title="Your folders" count={tidy ? "Tidy" : "Original"} defaultOpen={false}
    note={tidy ? "Your workspace uses the tidy folders. Everything in the app works the same; only the folder names in Finder or Explorer changed." : "Optional. Gives the workspace folder plain names and one home per kind of file. Nothing is deleted, job folders and resumes stay where they are, and you can undo it."}>
    <ul className="folders-list" aria-label="Where each kind of file lives">{workspaceMap(plan.version).map(({ folder, purpose }) => <li key={folder}><code>{folder}/</code><span>{purpose}</span></li>)}</ul>
    {plan.stray.length > 0 && <details className="folders-moves"><summary>{plan.stray.length} item{plan.stray.length === 1 ? "" : "s"} at the top of your workspace</summary>
      <ul className="folders-list">{plan.stray.map((item) => <li key={item.name}><code>{item.name}{item.kind === "dir" ? "/" : ""}</code><span>{item.suggestion}</span></li>)}</ul>
      <button className="btn-link" onClick={() => void window.sensei.files.reveal("").catch((reason) => setProblem(message(reason)))}>Show workspace folder</button></details>}
    {!tidy && <>
      <details className="folders-moves"><summary>{homes.length} move{homes.length === 1 ? "" : "s"} to a new home</summary>
        <ul>{homes.map((move) => <li key={move.from}><code>{move.from}</code> → <code>{move.to}</code></li>)}</ul></details>
      {archived.length > 0 && <details className="folders-moves"><summary>{archived.length} to the archive (copies and files the app no longer uses)</summary>
        <ul>{archived.map((move) => <li key={move.from}><code>{move.from}</code> <span className="muted">· {move.reason}</span></li>)}</ul></details>}
      {plan.notes.length > 0 && <ul className="folders-notes">{plan.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
      {plan.conflicts.length > 0 && <p className="inline-error" role="alert">Can't tidy yet: {plan.conflicts.slice(0, 3).join("; ")}{plan.conflicts.length > 3 ? ` and ${plan.conflicts.length - 3} more` : ""}. Rename or move those, then check again.</p>}
    </>}
    {problem && <p className="inline-error" role="alert">{problem}</p>}
    <div className="folders-actions">
      {!tidy && !confirming && <button className="btn-quiet" disabled={busy || plan.conflicts.length > 0 || plan.moves.length === 0} onClick={() => setConfirming(true)}>Tidy folders…</button>}
      {!tidy && confirming && <><span>Move {plan.moves.length} item{plan.moves.length === 1 ? "" : "s"} now? Agy will be closed; open it again afterwards.</span><button className="btn-primary" disabled={busy} onClick={() => void run("apply")}>{busy ? "Moving…" : "Yes, tidy"}</button><button className="btn-link" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button></>}
      {plan.canUndo && <button className="btn-link" disabled={busy} onClick={() => void run("undo")}>{tidy ? "Undo: put folders back" : "Finish undoing"}</button>}
      {(!tidy || plan.stray.length > 0) && <button className="btn-link" disabled={busy} onClick={load}>Check again</button>}
    </div>
  </Section>;
}

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
