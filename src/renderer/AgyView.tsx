// The Agy page: what Agy can do for you, as buttons, and how it uses your data. `src/shared/agy-actions.ts` owns the
// list of actions; the text of "How it works" is docs/app/how-agy-uses-it.md (the same owner the Docs page reads).
import { useEffect, useState, type ReactNode } from "react";
import howAgy from "../../docs/app/how-agy-uses-it.md?raw";
import { AGY_ACTION_GROUPS, buildAgyActions, type AgyAction, type AgyActionContext } from "../shared/agy-actions";
import { CONNECTED, DEFAULT_AGY_BEHAVIOR, FRAMING_LABELS, SETTINGS_BANDS, agyBehaviorSchema, bandFor, effectiveBehavior, settingScore, type AgyBehavior, type BehaviorSetting } from "../shared/agy-behavior";
import { AgyMemory } from "./AgyMemory";
import { AgyConversations } from "./AgyConversations";
import { markdownHtml } from "./markdown";
import { Section } from "./Section";
import { SubTabs, SubTabPanel } from "./SubTabs";

type AgyTab = "actions" | "behavior" | "conversations" | "memory" | "how";
const TABS: Array<{ id: AgyTab; label: string }> = [{ id: "actions", label: "Actions" }, { id: "behavior", label: "Behavior" }, { id: "conversations", label: "Conversations" }, { id: "memory", label: "Memory" }, { id: "how", label: "How it works" }];

const SETTING_ROWS: Array<{ id: BehaviorSetting; title: string; value: (behavior: AgyBehavior) => string; help: string }> = [
  { id: "framing", title: "How far wording may reach", value: (behavior) => FRAMING_LABELS[behavior.framing], help: "Real work worded at its strongest; never an event, number, tool, or ownership that didn't happen." },
  { id: "fit-credit", title: "Credit for partial matches", value: (behavior) => `strong ${behavior.fit.strong}, adjacent ${behavior.fit.adjacent}, unclear ${behavior.fit.unclear} (a direct match is 1)`, help: "How much a transferable or unclear match counts toward the fit score." },
  { id: "fit-gate", title: "Fit needed to apply", value: (behavior) => `${behavior.fit.gate} of 5`, help: "Jobs at or above this fit are marked worth applying to." },
  { id: "lines-reworked", title: "Resume lines reworked", value: (behavior) => behavior.linesReworked === 4 ? "3–4 of the current role's lines" : behavior.linesReworked === 0 ? "None: bullets stay as written, skills lines are tailored" : `Up to ${behavior.linesReworked} of the current role's lines`, help: "How many of the current role's base-resume bullets are rewritten for a job; the rest stay as written." },
];

/** A number box for one fit setting; out-of-range values are clamped on save by the schema. */
function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="behavior-field"><span>{label}</span><input type="number" inputMode="decimal" min={min} max={max} step={step} value={value} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next))); }} /></label>;
}

function BehaviorTab({ saved, onSave }: { saved: AgyBehavior; onSave: (next: AgyBehavior) => Promise<void> }) {
  const [draft, setDraft] = useState<AgyBehavior>(saved);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => { setDraft(saved); }, [JSON.stringify(saved)]);
  // What Agy would do with this draft: connected settings from the draft, the app's rule for the rest.
  const behavior = effectiveBehavior(draft);
  const score = settingScore(behavior);
  const band = bandFor(score.score);
  const changed = JSON.stringify(agyBehaviorSchema.parse(draft)) !== JSON.stringify(agyBehaviorSchema.parse(saved));
  const setFit = (key: keyof AgyBehavior["fit"], value: number) => { setDraft((current) => ({ ...current, fit: { ...current.fit, [key]: value } })); setState("idle"); };
  const save = async (next: AgyBehavior) => {
    setState("saving");
    try { await onSave(agyBehaviorSchema.parse(next)); setState("saved"); } catch { setState("error"); }
  };
  const editors: Partial<Record<BehaviorSetting, ReactNode>> = {
    "fit-credit": <div className="behavior-fields">
      <NumberField label="Strong match" value={draft.fit.strong} min={0} max={1} step={0.05} onChange={(value) => setFit("strong", value)} />
      <NumberField label="Adjacent match" value={draft.fit.adjacent} min={0} max={1} step={0.05} onChange={(value) => setFit("adjacent", value)} />
      <NumberField label="Unclear" value={draft.fit.unclear} min={0} max={1} step={0.05} onChange={(value) => setFit("unclear", value)} />
    </div>,
    "fit-gate": <div className="behavior-fields"><NumberField label="Fit needed (of 5)" value={draft.fit.gate} min={1} max={5} step={0.1} onChange={(value) => setFit("gate", value)} /></div>,
    "lines-reworked": <div className="behavior-fields"><NumberField label="Lines (4 = today's 3–4)" value={draft.linesReworked} min={0} max={12} step={1} onChange={(value) => { setDraft((current) => ({ ...current, linesReworked: Math.round(value) })); setState("idle"); }} /></div>,
  };
  return <>
    <p className={`settings-score-big is-${score.band}`}><strong className="tabular">{score.score}</strong> of 100 · {band.label}</p>
    <p className="muted">One number for how lenient Agy's settings are: {SETTINGS_BANDS.map((item) => `${item.label} from ${item.min}`).join(", ")}. Each job keeps the settings it was made under, so changes here apply to jobs drafted from now on.</p>
    <ul className="agy-actions">{SETTING_ROWS.map((row) => <li key={row.id}>
      <div><strong>{row.title}</strong><p>{row.value(behavior)}. {row.help}</p>{CONNECTED.has(row.id) && editors[row.id]}</div>
      <span className="agy-where">{score.parts[row.id]} of 10</span>
      <span className="agy-where">{CONNECTED.has(row.id) ? "Your setting" : "App rule"}</span>
    </li>)}</ul>
    <div className="behavior-actions">
      <button className="btn-primary" disabled={!changed || state === "saving"} onClick={() => void save(draft)}>{state === "saving" ? "Saving…" : "Save settings"}</button>
      <button className="btn-quiet" disabled={state === "saving" || JSON.stringify(agyBehaviorSchema.parse(draft)) === JSON.stringify(DEFAULT_AGY_BEHAVIOR)} onClick={() => { setDraft(DEFAULT_AGY_BEHAVIOR); void save(DEFAULT_AGY_BEHAVIOR); }}>Back to the app's defaults</button>
      <span className="muted" role="status">{state === "saved" ? "Saved. Jobs drafted from now on use these settings." : state === "error" ? "Couldn't save. Try again." : changed ? "Not saved yet." : ""}</span>
    </div>
    {SETTING_ROWS.some((row) => !CONNECTED.has(row.id)) && <p className="muted">Settings marked "App rule" become adjustable here once they are connected to Agy, so a change here always changes what Agy does.</p>}
  </>;
}
const remembered = (): AgyTab => {
  try { const value = window.localStorage.getItem("sensei-agy-tab"); return TABS.some((tab) => tab.id === value) ? value as AgyTab : "actions"; } catch { return "actions"; }
};

export function AgyView({ context, saved, onSaveBehavior, busyLabel, onRun, onShowAgy }: { context: AgyActionContext; /** The settings in the profile (`preferences.agy`). */ saved: AgyBehavior; onSaveBehavior: (next: AgyBehavior) => Promise<void>; /** The job Agy is working on now, if any. */ busyLabel: string | null; onRun: (action: AgyAction) => void; /** Opens the Agy panel. */ onShowAgy: () => void }) {
  const [tab, setTab] = useState<AgyTab>(remembered);
  const actions = buildAgyActions(context);
  return <section className="agy-home">
    <header className="page-head"><div><h1>Agy</h1><p>Everything Agy can do for you, in one place.</p></div></header>
    <SubTabs<AgyTab> idPrefix="agy" label="Agy sections" value={tab} tabs={TABS}
      onChange={(next) => { setTab(next); try { window.localStorage.setItem("sensei-agy-tab", next); } catch { /* not remembered */ } }} />
    <SubTabPanel idPrefix="agy" value={tab}>
      {tab === "actions" && <>
        {busyLabel && <p className="agy-busy" role="status">Agy is working on {busyLabel}. A request sent now waits its turn or asks before interrupting.</p>}
        {AGY_ACTION_GROUPS.map((group) => {
          const items = actions.filter((action) => action.group === group);
          if (!items.length) return null;
          return <Section key={group} id={`agy-actions-${group.toLowerCase().replace(/\s+/g, "-")}`} title={group === "This job" && context.job ? `This job: ${context.job.name}` : group} count={items.length}>
            <ul className="agy-actions">{items.map((action) => <li key={action.id}>
              <div><strong>{action.label}</strong><p>{action.unavailable ?? action.what}</p></div>
              <span className="agy-where">{action.where}</span>
              <button className="btn-quiet" disabled={Boolean(action.unavailable)} onClick={() => onRun(action)}>{action.run.kind === "app" && action.run.call.startsWith("open") ? "Open" : "Run"}</button>
            </li>)}</ul>
          </Section>;
        })}
        {!context.job && <p className="muted">Open a job to see its actions here.</p>}
      </>}
      {tab === "behavior" && <BehaviorTab saved={saved} onSave={onSaveBehavior} />}
      {tab === "memory" && <AgyMemory />}
      {tab === "conversations" && <AgyConversations onOpened={onShowAgy} />}
      {tab === "how" && <article className="docs-page iv-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(howAgy, [], { readable: true }) }} />}
    </SubTabPanel>
  </section>;
}
