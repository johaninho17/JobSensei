// Agy page → Conversations (#34): this workspace's past Agy conversations. Resume one in the Agy panel, start a new
// one, or delete one or many. The main process stops Agy before any of these (electron/agy-conversations.ts).
import { useEffect, useState } from "react";
import type { AgyConversationSummary } from "../shared/schemas";
import { askConfirm } from "./confirm";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function AgyConversations({ onOpened }: { /** Show the Agy panel after a resume or a new conversation. */ onOpened: () => void }) {
  const [list, setList] = useState<AgyConversationSummary[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = () => window.sensei.terminal.conversations().then(setList, (error: unknown) => setProblem(error instanceof Error ? error.message : String(error)));
  useEffect(() => { void load(); }, []);

  const act = async (label: string, work: () => Promise<unknown>) => {
    setBusy(label);
    setProblem(null);
    try { await work(); } catch (error) { setProblem(error instanceof Error ? error.message : String(error)); } finally { setBusy(null); }
  };
  const open = (id: string | null) => act(id ? "Opening the conversation…" : "Starting a new conversation…", async () => { await window.sensei.terminal.openConversation(id); onOpened(); });
  const remove = async (ids: string[]) => {
    if (!ids.length) return;
    const what = ids.length === 1 ? "this conversation" : `these ${ids.length} conversations`;
    if (!await askConfirm({ title: `Delete ${what}?`, body: "Agy restarts, and they can't be brought back.", confirmLabel: "Delete", danger: true })) return;
    void act("Deleting…", async () => { setList(await window.sensei.terminal.deleteConversations(ids)); setChosen(new Set()); });
  };
  const toggle = (id: string) => setChosen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <div className="agy-conversations">
    <div className="agy-conversations-bar">
      <p className="muted">{list === null ? "Loading…" : list.length ? `${list.length} conversation${list.length === 1 ? "" : "s"} in this workspace, newest first.` : "No conversations in this workspace yet."}</p>
      <div className="row-actions">
        {chosen.size > 0 && <button className="btn-quiet" disabled={Boolean(busy)} onClick={() => void remove([...chosen])}>Delete {chosen.size}</button>}
        <button className="btn-quiet" disabled={Boolean(busy)} onClick={() => void open(null)}>New conversation</button>
      </div>
    </div>
    {busy && <p role="status" className="agy-busy">{busy}</p>}
    {problem && <p role="alert" className="form-error">{problem}</p>}
    {list && list.length > 0 && <ul className="agy-actions">{list.map((entry) => <li key={entry.id}>
      <label className="agy-conversation">
        <input type="checkbox" checked={chosen.has(entry.id)} onChange={() => toggle(entry.id)} aria-label={`Choose: ${entry.prompt}`} />
        <span><strong>{entry.prompt}</strong><span className="muted">{when(entry.lastUsedAt)}{entry.jobId ? ` · job ${entry.jobId}` : ""}{entry.background ? " · background run" : ""}</span></span>
      </label>
      <button className="btn-quiet" disabled={Boolean(busy)} onClick={() => void open(entry.id)}>Resume</button>
      <button className="btn-quiet" disabled={Boolean(busy)} onClick={() => void remove([entry.id])}>Delete</button>
    </li>)}</ul>}
  </div>;
}
