import { describe, expect, it } from "vitest";
import { AGY_ACTION_GROUPS, buildAgyActions, type AgyActionContext } from "../src/shared/agy-actions";

const context = (patch: Partial<AgyActionContext> = {}): AgyActionContext => ({
  features: { interviews: true, contentRefresh: true, jobSearch: true },
  job: { name: "Northstar Labs, Support Analyst", actions: [{ id: "draft-application", label: "Draft application", prompt: "Draft the application for Northstar Labs Support Analyst (job: northstar-analyst)" }] },
  newRecordings: 0, searchRunning: false, ...patch,
});

describe("Agy page actions", () => {
  it("lists the open job's own actions first, each saying what it sends", () => {
    const [first] = buildAgyActions(context());
    expect(first).toMatchObject({ id: "job:draft-application", group: "This job", where: "Agy panel", run: { kind: "job-action", actionId: "draft-application" } });
    expect(first!.what).toContain("(job: northstar-analyst)");
    expect(buildAgyActions(context({ job: null })).some((action) => action.group === "This job")).toBe(false);
  });

  it("says where each action runs and gives every action a description", () => {
    const actions = buildAgyActions(context({ newRecordings: 3 }));
    expect(new Set(actions.map((action) => action.group))).toEqual(new Set(AGY_ACTION_GROUPS));
    for (const action of actions) { expect(action.what.length).toBeGreaterThan(10); expect(["Agy panel", "Background", "In the app"]).toContain(action.where); }
    expect(actions.find((action) => action.id === "recordings")!.label).toBe("Read 3 new recordings");
    expect(actions.find((action) => action.id === "search-watched")).toMatchObject({ where: "Background", run: { kind: "app", call: "search-watched" } });
    expect(actions.filter((action) => action.group === "Agy").map((action) => action.run)).toEqual(["/model", "/effort", "/usage", "/resume", "/clear"].map((text) => ({ kind: "command", text })));
    expect(new Set(actions.map((action) => action.id)).size).toBe(actions.length);
  });

  it("leaves out what the edition doesn't have and blocks a second search while one runs", () => {
    const recruiterLike = buildAgyActions(context({ features: { interviews: false, contentRefresh: false, jobSearch: false } }));
    expect(recruiterLike.map((action) => action.group)).not.toContain("Interviews");
    expect(recruiterLike.map((action) => action.group)).not.toContain("Job search");
    const running = buildAgyActions(context({ searchRunning: true }));
    expect(running.find((action) => action.id === "search-run")!.unavailable).toBe("A search is already running.");
    expect(running.find((action) => action.id === "search-open")!.unavailable).toBeUndefined();
  });
});
