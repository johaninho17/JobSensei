// One confirm dialog for the whole renderer (#26): pages call `askConfirm(...)` and await the answer instead of the
// browser's native window.confirm, which looks out of place and blocks the page. <ConfirmHost /> (mounted once in App)
// draws the dialog in the app's own style; Escape or Cancel answers no, the confirm button yes.
import { useEffect, useRef, useState } from "react";

export type ConfirmRequest = {
  title: string;
  body?: string;
  /** Button text for yes, e.g. "Discard changes" or "Move to Trash". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Marks a destructive choice (red button). */
  danger?: boolean;
};

type Pending = ConfirmRequest & { resolve: (yes: boolean) => void };
let pending: Pending[] = [];
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

/** Shows the dialog and resolves true when the user confirms. Several requests wait in turn. */
export function askConfirm(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => { pending = [...pending, { ...request, resolve }]; notify(); });
}

/** The shared "unsaved changes" question used before leaving an edited document. */
export function confirmDiscard(what = "your unsaved Markdown changes"): Promise<boolean> {
  return askConfirm({ title: `Discard ${what}?`, body: "Your edits since the last save will be lost.", confirmLabel: "Discard changes", danger: true });
}

function answer(yes: boolean): void {
  const [first, ...rest] = pending;
  pending = rest;
  notify();
  first?.resolve(yes);
}

export function ConfirmHost() {
  const [, setTick] = useState(0);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { const listener = () => setTick((tick) => tick + 1); listeners.add(listener); return () => { listeners.delete(listener); }; }, []);
  const request = pending[0];
  useEffect(() => { if (request) confirmRef.current?.focus(); }, [request]);
  if (!request) return null;
  return <div className="search-overlay" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); answer(false); } }} onMouseDown={(event) => { if (event.target === event.currentTarget) answer(false); }}>
    <div className="company-dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby={request.body ? "confirm-dialog-body" : undefined}>
      <h2 id="confirm-dialog-title">{request.title}</h2>
      {request.body && <p id="confirm-dialog-body">{request.body}</p>}
      <div className="company-dialog-actions">
        <button type="button" className="btn-quiet" onClick={() => answer(false)}>{request.cancelLabel ?? "Cancel"}</button>
        <button type="button" ref={confirmRef} className={request.danger ? "btn-primary is-danger" : "btn-primary"} onClick={() => answer(true)}>{request.confirmLabel}</button>
      </div>
    </div>
  </div>;
}

/** For tests: the requests waiting, and a way to answer the first. */
export const confirmQueue = { size: () => pending.length, first: () => pending[0] ?? null, answer };
