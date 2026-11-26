// Issue #171: job links are read with Node's fetch, and asked again through Chromium when a site refuses Node.
import { afterEach, describe, expect, it, vi } from "vitest";
import { appFetch, useChromiumFallback } from "../electron/app-fetch";

const reply = (status: number, body = "") => new Response(body, { status });

afterEach(() => { useChromiumFallback(null); vi.unstubAllGlobals(); });

describe("the app's fetcher", () => {
  it("keeps Node's answer when the site serves it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, "node")));
    const chromium = vi.fn(async () => reply(200, "chromium"));
    useChromiumFallback(chromium);
    expect(await (await appFetch("https://jobs.example.com/1")).text()).toBe("node");
    expect(chromium).not.toHaveBeenCalled();
  });

  it("asks Chromium when the site refuses Node or drops the connection", async () => {
    const chromium = vi.fn(async () => reply(200, "chromium"));
    useChromiumFallback(chromium);
    for (const status of [403, 429, 503]) {
      vi.stubGlobal("fetch", vi.fn(async () => reply(status)));
      expect(await (await appFetch("https://jobs.example.com/1", { headers: { Accept: "application/json" } })).text()).toBe("chromium");
    }
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect((await appFetch("https://jobs.example.com/1")).status).toBe(200);
    expect(chromium).toHaveBeenLastCalledWith("https://jobs.example.com/1", undefined);
  });

  it("keeps Node's refusal when Chromium fails too, or when there is no fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(429)));
    expect((await appFetch("https://jobs.example.com/1")).status).toBe(429);
    useChromiumFallback(async () => { throw new Error("offline"); });
    expect((await appFetch("https://jobs.example.com/1")).status).toBe(429);
  });

  it("never sends manual-redirect requests to Chromium, which cancels them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(403)));
    const chromium = vi.fn(async () => reply(200));
    useChromiumFallback(chromium);
    expect((await appFetch("https://redirect.example.com/x", { redirect: "manual" })).status).toBe(403);
    expect(chromium).not.toHaveBeenCalled();
  });
});
