// Settings → Privacy and data → "Open links in": the browser web links open in on this computer (saved at once, not
// with the rest of Settings, because it belongs to the computer, not the profile). Owner: electron/browser-choice.ts.
import { useEffect, useState } from "react";
import { toast } from "./app-shared";

export function BrowserSetting() {
  const [state, setState] = useState<{ choice: string; options: Array<{ id: string; name: string }> } | null>(null);
  useEffect(() => { void window.sensei.app.browser().then(setState).catch(() => setState(null)); }, []);
  if (!state) return null;
  async function choose(choice: string) {
    const next = await window.sensei.app.setBrowser(choice);
    setState((current) => current && { ...current, choice: next });
    toast("Saved.");
  }
  return <div className="settings-group">
    <h3 className="settings-group-title" id="settings-open-links-in">Open links in</h3>
    <p className="settings-group-desc">Job postings, research sources, and other web links open in this browser on this computer. If it can't start, the default browser is used.</p>
    <select className="settings-browser" value={state.choice} aria-labelledby="settings-open-links-in" onChange={(event) => void choose(event.target.value)}>
      {state.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
  </div>;
}
