import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stagePastedJobDescription } from "../electron/jd-fetch";
import { MIN_PASTED_POSTING_CHARS, looksLikePastedPosting } from "../src/shared/paste-limits";

// A short but real posting (fictional): about 300 characters.
const SHORT_POSTING = "Solutions Engineer at Northstar Labs\nRemote, US\n\nYou will onboard new customers, run technical discovery calls, and turn what you learn into setup guides. You know REST APIs and SQL, and you explain technical ideas in plain words. Two years in a customer-facing technical role.";

describe("one limit for pasted postings (#27)", () => {
  it("the Add jobs box, the chat, and the saver agree on the same length", async () => {
    expect(SHORT_POSTING.length).toBeGreaterThanOrEqual(MIN_PASTED_POSTING_CHARS);
    expect(SHORT_POSTING.length).toBeLessThan(400);
    expect(looksLikePastedPosting(SHORT_POSTING)).toBe(true);
    const root = await mkdtemp(join(tmpdir(), "sensei-paste-"));
    await expect(stagePastedJobDescription(root, SHORT_POSTING, "paste-short1")).resolves.toMatchObject({ title: expect.any(String) });
  });
  it("still refuses a note too short to be a posting", async () => {
    const note = "Customer success role, remote, apply soon.";
    expect(looksLikePastedPosting(note)).toBe(false);
    await expect(stagePastedJobDescription(await mkdtemp(join(tmpdir(), "sensei-paste-")), note, "paste-short2")).rejects.toThrow(/too short/);
  });
});
