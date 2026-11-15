// The Agy page: what Agy can do for you, as buttons, and how it uses your data. `src/shared/agy-actions.ts` owns the
// list of actions; the text of "How it works" is docs/app/how-agy-uses-it.md (the same owner the Docs page reads).
import { useEffect, useState, type ReactNode } from "react";
import type { AgyActivity } from "../shared/schemas";
import howAgy from "../../docs/app/how-agy-uses-it.md?raw";
import { AGY_ACTION_GROUPS, buildAgyActions, type AgyAction, type AgyActionContext } from "../shared/agy-actions";
import { AGY_EFFORTS, CONNECTED, DEFAULT_AGY_BEHAVIOR, type AgyModelChoice, FRAMING_FLOOR, FRAMING_LABELS, FRAMING_STOPS, type FramingStop, SETTINGS_BANDS, agyBehaviorSchema, bandFor, effectiveBehavior, settingScore, type AgyBehavior, type BehaviorSetting } from "../shared/agy-behavior";
import { AgyMemory } from "./AgyMemory";
import { AgyConversations } from "./AgyConversations";
import { markdownHtml } from "./markdown";
import { Section } from "./Section";
import { SubTabs, SubTabPanel } from "./SubTabs";

type AgyTab = "actions" | "activity" | "behavior" | "conversations" | "memory" | "how";
const TABS: Array<{ id: AgyTab; label: string }> = [{ id: "actions", label: "Actions" }, { id: "activity", label: "Activity" }, { id: "behavior", label: "Behavior" }, { id: "conversations", label: "Conversations" }, { id: "memory", label: "Memory" }, { id: "how", label: "How it works" }];

const SETTING_ROWS: Array<{ id: BehaviorSetting; title: string; value: (behavior: AgyBehavior) => string; help: string }> = [
  { id: "framing", title: "How far wording may reach", value: (behavior) => FRAMING_LABELS[behavior.framing], help: `Lines that reach further than this are flagged after each run. No setting ever invents ${FRAMING_FLOOR}; at "beyond", every line past its evidence is listed so you can keep or reword it.` },
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
  const parsedDraft = agyBehaviorSchema.safeParse(draft);
  const valid = parsedDraft.success;
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const weightTotal = Object.values(draft.fit.weights).reduce((sum, value) => sum + value, 0);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => { void window.sensei.terminal.models?.().then(setModels, () => setModels([])); }, []);
  const setModel = (kind: "panel" | "background", patch: Partial<AgyModelChoice>) => { setDraft((current) => ({ ...current, models: { ...current.models, [kind]: { ...current.models[kind], ...patch } } })); setState("idle"); };
  const setWeight = (key: keyof AgyBehavior["fit"]["weights"], value: number) => { setDraft((current) => ({ ...current, fit: { ...current.fit, weights: { ...current.fit.weights, [key]: Math.round(value) } } })); setState("idle"); };
  const setFit = (key: keyof AgyBehavior["fit"], value: number) => { setDraft((current) => ({ ...current, fit: { ...current.fit, [key]: value } })); setState("idle"); };
  const save = async (next: AgyBehavior) => {
    setState("saving");
    try { await onSave(agyBehaviorSchema.parse(next)); setState("saved"); } catch { setState("error"); }
  };
  const editors: Partial<Record<BehaviorSetting, ReactNode>> = {
    framing: <div className="behavior-fields"><label className="behavior-field"><span>Setting</span><select value={draft.framing} onChange={(event) => { setDraft((current) => ({ ...current, framing: event.target.value as FramingStop })); setState("idle"); }}>{FRAMING_STOPS.map((stop) => <option key={stop} value={stop}>{FRAMING_LABELS[stop]}</option>)}</select></label></div>,
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
    <section className="behavior-weights" aria-labelledby="behavior-weights-title">
      <h2 id="behavior-weights-title">Fit score weights</h2>
      <p className="muted">How much each kind of requirement counts toward a job's fit score. They add up to 100; a category the posting doesn't list is left out and the rest are scaled up. Weights don't change the settings score.</p>
      <div className="behavior-fields">
        <NumberField label="Core work" value={draft.fit.weights.core} min={1} max={100} step={1} onChange={(value) => setWeight("core", value)} />
        <NumberField label="Technical" value={draft.fit.weights.technical} min={0} max={100} step={1} onChange={(value) => setWeight("technical", value)} />
        <NumberField label="Scope" value={draft.fit.weights.scope} min={0} max={100} step={1} onChange={(value) => setWeight("scope", value)} />
        <NumberField label="Outcomes" value={draft.fit.weights.outcomes} min={0} max={100} step={1} onChange={(value) => setWeight("outcomes", value)} />
        <NumberField label="Domain" value={draft.fit.weights.domain} min={0} max={100} step={1} onChange={(value) => setWeight("domain", value)} />
        <NumberField label="Learning" value={draft.fit.weights.learning} min={0} max={100} step={1} onChange={(value) => setWeight("learning", value)} />
      </div>
      <p className={weightTotal === 100 ? "muted" : "behavior-error"} role="status">Total {weightTotal} of 100{weightTotal === 100 ? "" : `: ${weightTotal > 100 ? "take away" : "add"} ${Math.abs(100 - weightTotal)} before saving`}.</p>
    </section>
    {FEATURES.jobSearch && <section className="behavior-ranking" aria-labelledby="behavior-ranking-title">
      <h2 id="behavior-ranking-title">How Job Search ranks matches</h2>
      <p className="muted">Each slider is worth up to that many fit points in the order of Job Search matches; the fit shown on a match never changes. Not part of the settings score: it changes the order, not what Agy writes.</p>
      {RANKING_SLIDERS.map((slider) => <label key={slider.key} className="behavior-slider"><span>{slider.label} <strong className="tabular">{draft.search[slider.key].toFixed(2).replace(/0$/, "")}</strong></span>
        <input type="range" min={0} max={slider.max} step={0.05} value={draft.search[slider.key]} aria-describedby={`rank-${slider.key}`} onChange={(event) => { const value = Number(event.target.value); setDraft((current) => ({ ...current, search: { ...current.search, [slider.key]: value } })); setState("idle"); }} />
        <small id={`rank-${slider.key}`} className="muted">{slider.help}</small>
      </label>)}
    </section>}
    <section className="behavior-weights" aria-labelledby="behavior-models-title">
      <h2 id="behavior-models-title">Model and effort</h2>
      <p className="muted">Which model Agy uses and how hard it thinks. Higher effort is more careful and uses more quota. The panel's choice applies the next time Agy starts (Restart in the Agy panel); background runs use theirs from the next run.</p>
      {(["panel", "background"] as const).map((kind) => <div key={kind} className="behavior-fields">
        <label className="behavior-field"><span>{kind === "panel" ? "Agy panel: applications, interview prep" : "Background: job search, ratings, written answers"}</span>
          <select value={draft.models[kind].model ?? ""} onChange={(event) => setModel(kind, { model: event.target.value || null })}>
            <option value="">Agy's default model</option>
            {[...new Set([...(draft.models[kind].model ? [draft.models[kind].model!] : []), ...models.map((model) => model.id)])].map((id) => <option key={id} value={id}>{models.find((model) => model.id === id)?.name ?? id}</option>)}
          </select>
        </label>
        <label className="behavior-field"><span>Effort</span>
          <select value={draft.models[kind].effort ?? ""} onChange={(event) => setModel(kind, { effort: (event.target.value || null) as AgyModelChoice["effort"] })}>
            <option value="">Default</option>
            {AGY_EFFORTS.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
          </select>
        </label>
      </div>)}
      {!models.length && <p className="muted">Agy's model list isn't available right now, so only "Agy's default" and a model you already chose are shown.</p>}
    </section>
    <div className="behavior-actions">
      <button className="btn-primary" disabled={!changed || !valid || state === "saving"} onClick={() => void save(draft)}>{state === "saving" ? "Saving…" : "Save settings"}</button>
      <button className="btn-quiet" disabled={state === "saving" || JSON.stringify(draft) === JSON.stringify(DEFAULT_AGY_BEHAVIOR)} onClick={() => { setDraft(DEFAULT_AGY_BEHAVIOR); void save(DEFAULT_AGY_BEHAVIOR); }}>Back to the app's defaults</button>
      <span className="muted" role="status">{state === "saved" ? "Saved. Jobs drafted from now on use these settings." : state === "error" ? "Couldn't save. Try again." : changed ? "Not saved yet." : ""}</span>
    </div>
    {SETTING_ROWS.some((row) => !CONNECTED.has(row.id)) && <p className="muted">Settings marked "App rule" become adjustable here once they are connected to Agy, so a change here always changes what Agy does.</p>}
  </>;
}
const remembered = (): AgyTab => {
  try { const value = window.localStorage.getItem("sensei-agy-tab"); return TABS.some((tab) => tab.id === value) ? value as AgyTab : "actions"; } catch { return "actions"; }
};

export function AgyView({ context, saved, onSaveBehavior, busyLabel, onRun, onShowAgy, onOpenActivity }: { /** Opens what an activity row is about (a job tab or a page). */ onOpenActivity?: (open: AgyActivity["open"]) => void; context: AgyActionContext; /** The settings in the profile (`preferences.agy`). */ saved: AgyBehavior; onSaveBehavior: (next: AgyBehavior) => Promise<void>; /** The job Agy is working on now, if any. */ busyLabel: string | null; onRun: (action: AgyAction) => void; /** Opens the Agy panel. */ onShowAgy: () => void }) {
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
      {tab === "activity" && <ActivityTab onOpen={onOpenActivity} />}
      {tab === "behavior" && <BehaviorTab saved={saved} onSave={onSaveBehavior} />}
      {tab === "memory" && <AgyMemory />}
      {tab === "conversations" && <AgyConversations onOpened={onShowAgy} />}
      {tab === "how" && <article className="docs-page iv-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(howAgy, [], { readable: true }) }} />}
    </SubTabPanel>
  </section>;
}

const RESULT_LABEL: Record<AgyActivity["result"], string> = { running: "Running", passed: "Done", warnings: "Done, with things to check", failed: "Failed" };
const duration = (value: number | null) => value === null ? "" : value < 60 ? `${value}s` : `${Math.floor(value / 60)}m ${value % 60}s`;

/** Everything Agy did, in the panel and in the background, in one list (#33; data: electron/agy-activity.ts). */
function ActivityTab({ onOpen }: { onOpen?: (open: AgyActivity["open"]) => void }) {
  const [entries, setEntries] = useState<AgyActivity[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => void window.sensei.app.agyActivity().then(setEntries).catch(() => setFailed(true));
  useEffect(() => { load(); const timer = window.setInterval(load, 15_000); return () => window.clearInterval(timer); }, []);
  if (failed) return <p className="inline-error" role="alert">Couldn't read Agy's activity.</p>;
  if (!entries) return <p className="muted">Reading Agy's activity…</p>;
  if (!entries.length) return <p className="muted">Nothing yet. Runs from the Agy panel and the background (job search, written answers, filing your Today answers) show here.</p>;
  return <ul className="agy-activity">{entries.map((entry) => <li key={entry.id} className={`is-${entry.result}`}>
    <span className="agy-activity-when"><time dateTime={entry.at}>{new Date(entry.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time><small>{entry.where === "panel" ? "Agy panel" : "Background"}</small></span>
    <span className="agy-activity-what"><strong>{entry.label}</strong><small>{[RESULT_LABEL[entry.result], duration(entry.durationSeconds), entry.detail].filter(Boolean).join(" · ")}</small></span>
    {onOpen && <button className="btn-link" onClick={() => onOpen(entry.open)}>Open</button>}
  </li>)}</ul>;
}

/** Behavior → How Job Search ranks matches (#39); weights in fit points (src/shared/job-search.ts `rankParts`). */
const RANKING_SLIDERS: Array<{ key: keyof AgyBehavior["search"]; label: string; max: number; help: string }> = [
  { key: "fit", label: "Fit", max: 2, help: "How much the fit score counts (1 = as rated, 0 = ignore it)." },
  { key: "freshness", label: "Newly posted", max: 1, help: "Points for a posting from today, falling to none at 30 days." },
  { key: "pay", label: "Pay", max: 1, help: "Points for pay: all of them at $250K a year or more, in proportion below; none when the posting has no pay." },
  { key: "likeInterviewed", label: "Like a job where you got an interview", max: 1, help: "Points for a job similar to one that got you a real interview (0.25 before this setting existed)." },
];
