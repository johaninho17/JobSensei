import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Edit details (#203)", () => {
  it("opens with the job's details and saves a correction only for fields the user changed", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    const form = page.slice(page.indexOf("function EditJobDetails"), page.indexOf("function FramingLines"));
    expect(form).toContain("company: saved.company ?? job.company ?? \"\"");
    expect(form).toContain("company: changed(\"company\") ? form.company : start.saved.company ?? \"\"");
    expect(form).toContain("pay: !payChanged ? start.saved.pay");
    expect(form).not.toContain("Leave a field blank");
  });
});
