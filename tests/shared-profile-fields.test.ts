// #22: Setup and Settings edit the same profile fields through one component each, with one wording.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateCandidateProfileDetails } from "../electron/candidate-profile";

const setup = readFileSync("src/renderer/SetupAndContext.tsx", "utf8");
const settings = readFileSync("src/renderer/SettingsModal.tsx", "utf8");

describe("one form per profile field (#22)", () => {
  it("Setup and Settings both use the shared story, logistics, private-names, and voice fields", () => {
    for (const component of ["<StoryFieldsForm", "<LogisticsForm", "<PrivateNamesField", "<VoiceFileField"]) {
      expect(setup, `Setup ${component}`).toContain(component);
      expect(settings, `Settings ${component}`).toContain(component);
    }
    expect(settings).toContain("<IdentityForm");
  });
  it("no page keeps its own copy of the field wording", () => {
    for (const old of ["Separate names with commas", "1. Career transitions and turning points", "const LOGISTICS_FIELDS", "Names to keep private</span>", "Why you made your key moves"]) {
      expect(setup + settings, old).not.toContain(old);
    }
  });
  it("Settings saves identity: name and prefix keep their value when blank, other fields clear", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-identity-"));
    await mkdir(join(root, "profile"), { recursive: true });
    await writeFile(join(root, "profile", "candidate.json"), JSON.stringify({ schemaVersion: 1, identity: { fullName: "Alex Morgan", artifactPrefix: "Alex_Morgan", email: "alex@example.com" }, sources: { baseResumePath: null }, career: {}, preferences: { resume: {}, coverLetter: {} }, truth: {}, updatedAt: "2026-11-10T00:00:00.000Z" }));
    const next = await updateCandidateProfileDetails(root, { identity: { fullName: "Alex R. Morgan", artifactPrefix: "", email: "", phone: "(555) 010-0000", location: "Denver, CO" } });
    expect(next.identity).toMatchObject({ fullName: "Alex R. Morgan", artifactPrefix: "Alex_Morgan", email: null, phone: "(555) 010-0000", location: "Denver, CO" });
    await expect(updateCandidateProfileDetails(root, { identity: { artifactPrefix: "bad prefix!" } })).rejects.toThrow();
  });
});
