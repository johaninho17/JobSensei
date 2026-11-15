// The Agy page: what Agy can do for you, as buttons, and how it uses your data. `src/shared/agy-actions.ts` owns the
// list of actions; the text of "How it works" is docs/app/how-agy-uses-it.md (the same owner the Docs page reads).
import { useState } from "react";
import howAgy from "../../docs/app/how-agy-uses-it.md?raw";
import { AGY_ACTION_GROUPS, buildAgyActions, type AgyAction, type AgyActionContext } from "../shared/agy-actions";
import { CONNECTED, FRAMING_LABELS, SETTINGS_BANDS, bandFor, settingScore, type AgyBehavior, type BehaviorSetting } from "../shared/agy-behavior";
import { markdownHtml } from "./markdown";
import { Section } from "./Section";
import { SubTabs, SubTabPanel } from "./SubTabs";

type AgyTab = "actions" | "behavior" | "how";
const TABS: Array<{ id: AgyTab; label: string }> = [{ id: "actions", label: "Actions" }, { id: "behavior", label: "Behavior" }, { id: "how", label: "How it works" }];

const SETTING_ROWS: Array<{ id: BehaviorSetting; title: string; value: (behavior: AgyBehavior) => string; help: string }> = [
  { id: "framing", title: "How far wording may reach", value: (behavior) => FRAMING_LABELS[behavior.framing], help: "Real work worded at its strongest; never an event, number, tool, or ownership that didn't happen." },
  { id: "fit-credit", title: "Credit for partial matches", value: (behavior) => `strong ${behavior.fit.strong}, adjacent ${behavior.fit.adjacent}, unclear ${behavior.fit.unclear} (a direct match is 1)`, help: "How much a transferable or unclear match counts toward the fit score." },
  { id: "fit-gate", title: "Fit needed to apply", value: (behavior) => `${behavior.fit.gate} of 5`, help: "Jobs at or above this fit are marked worth applying to." },
  { id: "lines-reworked", title: "Resume lines reworked", value: (behavior) => behavior.linesReworked >= 4 ? "3–4 of the current role's lines" : `up to ${behavior.linesReworked}`, help: "How many of the current role's base-resume bullets are rewritten for a job; the rest stay as written." },
];

function BehaviorTab({ behavior }: { behavior: AgyBehavior }) {
  const score = settingScore(behavior);
  const band = bandFor(score.score);
  return <>
    <p className={`settings-score-big is-${score.band}`}><strong className="tabular">{score.score}</strong> of 100 · {band.label}</p>
    <p className="muted">One number for how lenient Agy's settings are: {SETTINGS_BANDS.map((item) => `${item.label} from ${item.min}`).join(", ")}. Every job shows the score its drafts were made under, so you can compare how jobs did at different settings.</p>
    <ul className="agy-actions">{SETTING_ROWS.map((row) => <li key={row.id}>
      <div><strong>{row.title}</strong><p>{row.value(behavior)}. {row.help}</p></div>
      <span className="agy-where">{score.parts[row.id]} of 10</span>
      <span className="agy-where">{CONNECTED.has(row.id) ? "Your setting" : "App rule"}</span>
    </li>)}</ul>
    {SETTING_ROWS.some((row) => !CONNECTED.has(row.id)) && <p className="muted">These are the rules JobSensei follows today. Each becomes adjustable here once it is connected to Agy, so a change here always changes what Agy does.</p>}
  </>;
}
const remembered = (): AgyTab => {
  try { const value = window.localStorage.getItem("sensei-agy-tab"); return TABS.some((tab) => tab.id === value) ? value as AgyTab : "actions"; } catch { return "actions"; }
};

export function AgyView({ context, behavior, busyLabel, onRun }: { context: AgyActionContext; /** What Agy does now (`effectiveBehavior`). */ behavior: AgyBehavior; /** The job Agy is working on now, if any. */ busyLabel: string | null; onRun: (action: AgyAction) => void }) {
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
      {tab === "behavior" && <BehaviorTab behavior={behavior} />}
      {tab === "how" && <article className="docs-page iv-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(howAgy, [], { readable: true }) }} />}
    </SubTabPanel>
  </section>;
}
