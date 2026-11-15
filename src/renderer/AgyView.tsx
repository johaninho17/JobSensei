// The Agy page: what Agy can do for you, as buttons, and how it uses your data. `src/shared/agy-actions.ts` owns the
// list of actions; the text of "How it works" is docs/app/how-agy-uses-it.md (the same owner the Docs page reads).
import { useState } from "react";
import howAgy from "../../docs/app/how-agy-uses-it.md?raw";
import { AGY_ACTION_GROUPS, buildAgyActions, type AgyAction, type AgyActionContext } from "../shared/agy-actions";
import { markdownHtml } from "./markdown";
import { Section } from "./Section";
import { SubTabs, SubTabPanel } from "./SubTabs";

type AgyTab = "actions" | "how";
const TABS: Array<{ id: AgyTab; label: string }> = [{ id: "actions", label: "Actions" }, { id: "how", label: "How it works" }];
const remembered = (): AgyTab => {
  try { const value = window.localStorage.getItem("sensei-agy-tab"); return TABS.some((tab) => tab.id === value) ? value as AgyTab : "actions"; } catch { return "actions"; }
};

export function AgyView({ context, busyLabel, onRun }: { context: AgyActionContext; /** The job Agy is working on now, if any. */ busyLabel: string | null; onRun: (action: AgyAction) => void }) {
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
      {tab === "how" && <article className="docs-page iv-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(howAgy, [], { readable: true }) }} />}
    </SubTabPanel>
  </section>;
}
