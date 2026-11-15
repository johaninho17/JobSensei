/** The Agy chat's entries and how they are kept across reloads and workspace switches (one history per workspace). */

export type PastedBlock = {
  id: string;
  lineCount: number;
  byteCount: number;
  content: string;
  preview: string;
};

export type ChatEntry = {
  id: string;
  sender: "user" | "assistant" | "system";
  title?: string;
  content: string;
  pastedBlock?: PastedBlock;
  steps?: string[];
  rawOutput?: string[];
  status?: "pending" | "running" | "success" | "error";
  startTime?: number;
  durationMs?: number;
  timestamp: string;
};

export const CHAT_HISTORY_LIMIT = 40;
const RAW_LINES_KEPT = 20;
const KEY_PREFIX = "sensei-chat-history:";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function chatHistoryKey(workspace: string): string { return `${KEY_PREFIX}${workspace}`; }

/** What is written: the newest entries, without pasted text (only its preview) and with a short output tail. */
export function trimForStorage(entries: ChatEntry[]): ChatEntry[] {
  return entries.filter((entry) => !entry.id.startsWith("welcome")).slice(-CHAT_HISTORY_LIMIT).map((entry) => ({
    ...entry,
    rawOutput: entry.rawOutput?.slice(-RAW_LINES_KEPT),
    pastedBlock: entry.pastedBlock ? { ...entry.pastedBlock, content: "" } : undefined,
  }));
}

export function saveChatHistory(store: Store, workspace: string, entries: ChatEntry[]): void {
  if (!workspace) return;
  try {
    const kept = trimForStorage(entries);
    if (kept.length) store.setItem(chatHistoryKey(workspace), JSON.stringify(kept));
    else store.removeItem(chatHistoryKey(workspace));
  } catch { /* storage full or unavailable: the chat still works, it just isn't kept */ }
}

const isEntry = (value: unknown): value is ChatEntry => {
  const entry = value as Partial<ChatEntry> | null;
  return Boolean(entry) && typeof entry!.id === "string" && typeof entry!.content === "string" && typeof entry!.timestamp === "string" && ["user", "assistant", "system"].includes(entry!.sender as string);
};

/** Earlier entries for this workspace. A run that was still going when the app reloaded is shown as interrupted, never as done. */
export function loadChatHistory(store: Store, workspace: string): ChatEntry[] {
  if (!workspace) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(chatHistoryKey(workspace)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(-CHAT_HISTORY_LIMIT).map((entry) => entry.status === "running" || entry.status === "pending"
      ? { ...entry, status: undefined, steps: [...(entry.steps ?? []), "The app reloaded while this was running. Its result is in the Console and on the job."] }
      : entry);
  } catch { return []; }
}

export function clearChatHistory(store: Store, workspace: string): void {
  try { store.removeItem(chatHistoryKey(workspace)); } catch { /* nothing to clear */ }
}
