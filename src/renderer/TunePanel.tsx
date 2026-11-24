// Tune review (ledger U76, #118): one area's Tune button, then at most five ranked suggestions with checkboxes. Apply
// the checked ones, decline the ones never to see again; the rest wait for the next Tune. The engine is
// electron/tune-runner.ts; this file only shows it.
import { useEffect, useState } from "react";
import type { JobAction } from "./job-actions";
import type { TuneArea, TuneSuggestion } from "../shared/tune-schemas";

type Status = Awaited<ReturnType<typeof window.sensei.tune.status>>[number];
const OPERATION: Record<TuneSuggestion["operation"], string> = { add: "Add", enrich: "Add detail", replace: "Replace", archive: "Archive" };
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const messageOf = (caught: unknown, fallback: string) => caught instanceof Error && caught.message ? caught.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : fallback;
const snippet = (text: string) => text.replace(/^#+\s*|^\s*[-*]\s+|^\|\s*|\s*\|$/gm, "").replace(/\s*\|\s*/g, " · ").replace(/\s+/g, " ").trim().slice(0, 220);
const fileName = (path: string) => path.split("/").pop() ?? path;

export function TunePanel({ area, title, what, onSendPrompt, onOpenFile, onApplied }: {
  area: TuneArea;
  title: string;
  /** One line: what this area reads and what it may change. */
  what: string;
  onSendPrompt: (action: Pick<JobAction, "prompt" | "label">) => void;
  onOpenFile?: (path: string) => void;
  onApplied?: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [shown, setShown] = useState<TuneSuggestion[]>([]);
  const [banked, setBanked] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [canUndo, setCanUndo] = useState(false);

  async function load() {
    const next = (await window.sensei.tune.status()).find((entry) => entry.area === area) ?? null;
    setStatus(next);
    if (next?.waitingForAgy && next.suggestionsReady) {
      // Agy finished: check and bank its suggestions, then show the top five.
      const collected = await window.sensei.tune.collect(area);
      setShown(collected.shown); setBanked(collected.banked);
      setMessage([collected.added ? `Agy suggested ${plural(collected.added, "new change")}.` : "Agy had nothing new to suggest.", ...collected.problems].join(" "));
      setStatus((await window.sensei.tune.status()).find((entry) => entry.area === area) ?? null);
      return;
    }
    const view = await window.sensei.tune.view(area);
    setShown(view.shown); setBanked(view.banked);
  }
  useEffect(() => { void load().catch((caught) => setMessage(messageOf(caught, "Couldn't read Tune."))); }, [area]);
  // While Agy works, look for its suggestions every 5 seconds.
  useEffect(() => {
    if (!status?.waitingForAgy) return;
    const timer = window.setInterval(() => { void load().catch(() => undefined); }, 5000);
    return () => window.clearInterval(timer);
  }, [status?.waitingForAgy, area]);

  async function run(task: () => Promise<void>, failure: string) {
    setBusy(true); setMessage("");
    try { await task(); } catch (caught) { setMessage(messageOf(caught, failure)); } finally { setBusy(false); await load().catch(() => undefined); }
  }
  const start = () => run(async () => { const prompt = await window.sensei.tune.start(area); onSendPrompt({ prompt, label: `Tune: ${title}` }); }, "Couldn't start Tune.");
  const cancel = () => run(() => window.sensei.tune.cancel(area), "Couldn't stop Tune.");
  const apply = () => run(async () => {
    const outcome = await window.sensei.tune.apply(area, [...checked], []);
    setChecked(new Set());
    setCanUndo(outcome.applied.length > 0);
    setMessage([outcome.applied.length ? `Applied ${plural(outcome.applied.length, "change")}.` : "", ...outcome.skipped.map((entry) => `Left out one: ${entry.reason}`)].filter(Boolean).join(" "));
    if (outcome.applied.length) onApplied?.();
  }, "Couldn't apply the changes.");
  const decline = (id: string) => run(async () => { await window.sensei.tune.apply(area, [], [id]); setChecked((current) => { const next = new Set(current); next.delete(id); return next; }); setMessage("Declined; it won't be suggested again."); }, "Couldn't decline it.");
  const undo = () => run(async () => { await window.sensei.tune.undo(); setCanUndo(false); setMessage("Undone; your files are back as they were."); onApplied?.(); }, "Couldn't undo.");
  const toggle = (id: string, on: boolean) => setChecked((current) => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });

  const changed = status?.changed ?? 0;
  return <section className="iv-section tune-panel" aria-label={`Tune: ${title}`}>
    <h3>{title}</h3>
    <p className="learn-note">{what}</p>
    {status?.waitingForAgy ? <div className="onboarding-result" role="status">
      <strong>Agy is reading what's new</strong>
      <p>Its suggestions show up here when it's done. Nothing changes in your files until you apply them.</p>
      <div className="onboarding-actions"><button className="btn-quiet" disabled={busy} onClick={() => void cancel()}>Stop this Tune</button></div>
    </div> : <div className="onboarding-actions">
      <button className="btn-primary" disabled={busy || !changed} onClick={() => void start()}>{changed ? `Tune from ${plural(changed, "new file")}` : "Nothing new to tune"}</button>
      {canUndo && <button className="btn-quiet" disabled={busy} onClick={() => void undo()}>Undo the last Tune</button>}
    </div>}
    {shown.length > 0 && <>
      <ul className="tune-list">{shown.map((item) => <li key={item.id}>
        <label className="tune-pick">
          <input type="checkbox" checked={checked.has(item.id)} disabled={busy} onChange={(event) => toggle(item.id, event.target.checked)} />
          <span>
            <span className="setup-state">{OPERATION[item.operation]}</span>{" "}
            <strong>{item.text ? snippet(item.text) : snippet(item.target ?? "")}</strong>
            <small>{item.operation !== "add" && item.target && item.text ? `Changes "${snippet(item.target)}". ` : ""}{item.reason} · {fileName(item.file)}, from {fileName(item.source)}</small>
          </span>
        </label>
        {onOpenFile && <button className="btn-link" onClick={() => onOpenFile(item.file)}>Open</button>}
        <button className="btn-link" disabled={busy} onClick={() => void decline(item.id)}>Never suggest</button>
      </li>)}</ul>
      <div className="onboarding-actions">
        <button className="btn-primary" disabled={busy || !checked.size} onClick={() => void apply()}>{checked.size ? `Apply ${plural(checked.size, "change")}` : "Check the ones to apply"}</button>
        {banked > 0 && <span className="muted">{plural(banked, "more suggestion")} saved for later</span>}
      </div>
    </>}
    {message && <p role="status" className="export-note">{message}</p>}
  </section>;
}
