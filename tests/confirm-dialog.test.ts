import { describe, expect, it } from "vitest";
import { askConfirm, confirmDiscard, confirmQueue } from "../src/renderer/confirm";
import { readdirSync, readFileSync } from "node:fs";

describe("one confirm dialog (#26)", () => {
  it("answers in turn: yes, then no", async () => {
    const first = askConfirm({ title: "Move file to Trash?", confirmLabel: "Move to Trash", danger: true });
    const second = confirmDiscard();
    expect(confirmQueue.size()).toBe(2);
    expect(confirmQueue.first()?.title).toBe("Move file to Trash?");
    confirmQueue.answer(true);
    expect(confirmQueue.first()?.confirmLabel).toBe("Discard changes");
    confirmQueue.answer(false);
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(confirmQueue.size()).toBe(0);
  });
  it("no page uses the browser's native confirm (the Agy panel's own is left to #11)", () => {
    const files = readdirSync("src/renderer").filter((name) => name.endsWith(".tsx") && name !== "TerminalPanel.tsx");
    expect(files.filter((name) => /window\.confirm\(/.test(readFileSync(`src/renderer/${name}`, "utf8")))).toEqual([]);
  });
});
