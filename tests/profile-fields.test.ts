import { describe, expect, it } from "vitest";
import { logisticsUpdate, parseNames, readLogistics, readStoryFields, storyUpdate } from "../src/shared/profile-fields";
import type { CandidateProfile } from "../src/shared/schemas";

const profile = {
  career: { transitionSummary: "From backend code to customer work.", narrativePillars: { turningPoints: "Old turning point", workingStyle: "Old style", personalValues: "" } },
  preferences: { coverLetter: { narrativePillars: { turningPoints: "", workingStyle: "Calm under pressure", personalValues: "Honesty" } }, interview: { location: "Denver", workAuthorization: "", compensation: " $120k ", noticePeriod: "", workArrangement: "" } },
} as unknown as CandidateProfile;

describe("profile fields shared by Settings and Setup", () => {
  it("reads the pillars' owner first and the old field only when the owner's is empty", () => {
    expect(readStoryFields(profile)).toEqual({ transitionSummary: "From backend code to customer work.", turningPoints: "Old turning point", workingStyle: "Calm under pressure", personalValues: "Honesty" });
    expect(readStoryFields(null)).toEqual({ transitionSummary: "", turningPoints: "", workingStyle: "", personalValues: "" });
  });

  it("saves trimmed values to the right owners", () => {
    expect(storyUpdate({ transitionSummary: " a ", turningPoints: " b ", workingStyle: "c ", personalValues: "" })).toEqual({ transitionSummary: "a", narrativePillars: { turningPoints: "b", workingStyle: "c", personalValues: "" } });
    expect(logisticsUpdate(readLogistics(profile))).toEqual({ location: "Denver", workAuthorization: "", compensation: "$120k", noticePeriod: "", workArrangement: "" });
  });

  it("reads names the same way whether typed one per line or with commas", () => {
    expect(parseNames("Northstar Labs, Acme\n Acme \n\nGlobex")).toEqual(["Northstar Labs", "Acme", "Globex"]);
  });
});
