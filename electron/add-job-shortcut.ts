// The system-wide "add the copied job link" shortcut (issue #168). The main process only reads the clipboard and hands
// the link to the window; the renderer adds it through the same queueJob path as the Add jobs box (one owner for adding
// jobs: setup check, app fetch, duplicate check, queue). On by default; the window says per computer whether it's on.

/** Three modifiers, so it never takes a combo browsers or the OS use (Cmd+Opt+J is Chrome's console). */
export const ADD_JOB_ACCELERATOR = "CommandOrControl+Alt+Shift+J";

/** What the window is told after a press: the link to add, or that the clipboard held none. */
export type ShortcutPress = { url: string } | { url: null };

/** Whether the shortcut is on, and whether the OS gave it to us (another app may hold the combo). */
export type ShortcutState = { enabled: boolean; registered: boolean; accelerator: string };

/** The first http(s) link in copied text (a bare link, or a link inside a sentence); null when there is none. */
export function linkFromClipboard(text: string): string | null {
  const match = /https?:\/\/[^\s<>"'`]+/i.exec(text.slice(0, 5_000));
  if (!match) return null;
  const link = match[0].replace(/[),.;:!?\]]+$/, "");
  if (link.length > 2_000) return null;
  try {
    const url = new URL(link);
    return url.hostname.includes(".") || url.hostname === "localhost" ? url.toString() : null;
  } catch {
    return null;
  }
}

type GlobalShortcuts = { register(accelerator: string, callback: () => void): boolean; unregister(accelerator: string): void; isRegistered(accelerator: string): boolean };

/**
 * Turns the shortcut on or off. On: registers it (false when the OS refuses, e.g. another app holds it) and calls
 * `onPress` with the clipboard's link on each press. Off: unregisters it.
 */
export function setAddJobShortcut(shortcuts: GlobalShortcuts, enabled: boolean, readClipboard: () => string, onPress: (press: ShortcutPress) => void): ShortcutState {
  if (shortcuts.isRegistered(ADD_JOB_ACCELERATOR)) shortcuts.unregister(ADD_JOB_ACCELERATOR);
  if (!enabled) return { enabled, registered: false, accelerator: ADD_JOB_ACCELERATOR };
  let registered = false;
  try {
    registered = shortcuts.register(ADD_JOB_ACCELERATOR, () => onPress({ url: linkFromClipboard(readClipboard()) }));
  } catch {
    registered = false;
  }
  return { enabled, registered, accelerator: ADD_JOB_ACCELERATOR };
}
