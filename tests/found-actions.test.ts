import { describe, expect, it } from "vitest";
import { draftFound, foundError, foundRowId, saveFound } from "../src/renderer/found-actions";

describe("Job Search matches act the same on Today and Job Search", () => {
  it("saves each match and says how many", async () => {
    const saved: string[] = [];
    expect(await saveFound(["a", "b"], { saveJob: async (id) => { saved.push(id); } })).toBe("Saved 2 jobs to Jobs.");
    expect(saved).toEqual(["a", "b"]);
    expect(await saveFound(["c"], { saveJob: async () => undefined })).toBe("Saved 1 job to Jobs.");
  });
  it("sends each match for drafts and says how many are ahead", async () => {
    const sent: string[] = [];
    expect(await draftFound(["a"], async (id) => { sent.push(id); return 2; })).toBe("Sent 1 job for drafts (2 ahead in the queue).");
    expect(await draftFound(["b", "c"], async () => 0)).toBe("Sent 2 jobs for drafts.");
    expect(sent).toEqual(["a"]);
  });
  it("shows a queue refusal in plain words", () => {
    expect(foundError(new Error("Error invoking remote method 'search:stage': Error: Finish setup first."))).toBe("Finish setup first.");
  });
  it("gives each match row an id another page can open", () => {
    expect(foundRowId("x1")).toBe("found-x1");
  });
});
