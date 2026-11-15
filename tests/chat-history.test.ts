import { describe, expect, it } from "vitest";
import { CHAT_HISTORY_LIMIT, chatHistoryKey, clearChatHistory, loadChatHistory, saveChatHistory, type ChatEntry } from "../src/renderer/chat-history";

function memoryStore() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
const entry = (id: string, patch: Partial<ChatEntry> = {}): ChatEntry => ({ id, sender: "user", content: `message ${id}`, timestamp: "10:00", ...patch });

describe("Agy chat history", () => {
  it("keeps one history per workspace and brings it back", () => {
    const store = memoryStore();
    saveChatHistory(store, "/work/alex", [entry("welcome", { sender: "system" }), entry("user-1"), entry("asst-1", { sender: "assistant", status: "success", durationMs: 4000 })]);
    saveChatHistory(store, "/work/other", [entry("user-9")]);
    expect(loadChatHistory(store, "/work/alex").map((item) => item.id)).toEqual(["user-1", "asst-1"]);
    expect(loadChatHistory(store, "/work/other").map((item) => item.id)).toEqual(["user-9"]);
    expect(loadChatHistory(store, "/work/none")).toEqual([]);
    clearChatHistory(store, "/work/alex");
    expect(loadChatHistory(store, "/work/alex")).toEqual([]);
    expect(store.data.has(chatHistoryKey("/work/other"))).toBe(true);
  });

  it("stores the newest entries without pasted text and with a short output tail", () => {
    const store = memoryStore();
    const many = Array.from({ length: CHAT_HISTORY_LIMIT + 15 }, (_, index) => entry(`user-${index}`));
    many.push(entry("asst-last", { sender: "assistant", rawOutput: Array.from({ length: 60 }, (_, line) => `line ${line}`), pastedBlock: { id: "p", lineCount: 80, byteCount: 9000, content: "the whole pasted posting", preview: "Support Analyst…" } }));
    saveChatHistory(store, "/work/alex", many);
    const loaded = loadChatHistory(store, "/work/alex");
    expect(loaded).toHaveLength(CHAT_HISTORY_LIMIT);
    const last = loaded.at(-1)!;
    expect(last.rawOutput).toHaveLength(20);
    expect(last.pastedBlock).toMatchObject({ content: "", preview: "Support Analyst…", lineCount: 80 });
    expect(store.data.get(chatHistoryKey("/work/alex"))).not.toContain("the whole pasted posting");
  });

  it("shows a run that was going at reload as interrupted, and ignores damaged data", () => {
    const store = memoryStore();
    saveChatHistory(store, "/work/alex", [entry("asst-1", { sender: "assistant", status: "running", startTime: 1, steps: ["Starting: Northstar Labs…"] })]);
    const [loaded] = loadChatHistory(store, "/work/alex");
    expect(loaded!.status).toBeUndefined();
    expect(loaded!.steps!.at(-1)).toContain("reloaded while this was running");
    store.setItem(chatHistoryKey("/work/bad"), "{not json");
    expect(loadChatHistory(store, "/work/bad")).toEqual([]);
    store.setItem(chatHistoryKey("/work/odd"), JSON.stringify([{ id: 3 }, entry("user-2"), "x"]));
    expect(loadChatHistory(store, "/work/odd").map((item) => item.id)).toEqual(["user-2"]);
  });
});
