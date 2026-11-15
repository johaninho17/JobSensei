// Agy page → Memory (#41): what Agy remembers between conversations. The items are Agy's own binary files, so the
// page shows when each was saved and its size, and deletes chosen items or all of them (electron/agy-memory.ts).
import { useEffect, useState } from "react";
import { askConfirm } from "./confirm";

type Item = { id: string; bytes: number; updatedAt: string };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const size = (bytes: number) => bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024)} KB`;

export function AgyMemory() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { void window.sensei.terminal.memory().then(setItems, (error: unknown) => setProblem(String(error))); }, []);
  const remove = async (ids: string[] | "all") => {
    const what = ids === "all" ? "everything Agy remembers" : ids.length === 1 ? "this memory item" : `these ${ids.length} items`;
    if (!await askConfirm({ title: `Delete ${what}?`, body: "Agy restarts, and it can't be brought back.", confirmLabel: "Delete", danger: true })) return;
    setBusy(true);
    setProblem(null);
    try { setItems(await window.sensei.terminal.deleteMemory(ids)); } catch (error) { setProblem(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  };
  return <div className="agy-memory">
    <p>Agy keeps a few notes from past conversations to work faster next time. They are saved in Agy's own format, so this page shows when each one was saved, not what it says. Agy can't save rules or memories on purpose here; your standing instructions belong in Settings.</p>
    <div className="agy-conversations-bar">
      <p className="muted">{items === null ? "Loading…" : items.length ? `${items.length} memory item${items.length === 1 ? "" : "s"}.` : "Agy remembers nothing yet."}</p>
      {items && items.length > 0 && <button className="btn-quiet" disabled={busy} onClick={() => void remove("all")}>Delete all</button>}
    </div>
    {busy && <p role="status" className="agy-busy">Stopping Agy and deleting…</p>}
    {problem && <p role="alert" className="form-error">{problem}</p>}
    {items && items.length > 0 && <ul className="agy-actions">{items.map((item) => <li key={item.id}>
      <div><strong>Saved {when(item.updatedAt)}</strong><p className="muted">{size(item.bytes)}</p></div>
      <span />
      <button className="btn-quiet" disabled={busy} onClick={() => void remove([item.id])}>Delete</button>
    </li>)}</ul>}
  </div>;
}
