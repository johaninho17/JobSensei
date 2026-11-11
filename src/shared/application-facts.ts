// The application facts sheet (Recruiter Edition, plan R8 P3): the details every employer form asks for, read from
// where the profile already keeps them (contact details, logistics) plus the recruiter's extra answers. One owner of
// the labels; shown with copy buttons on each job. Never invented, never sent to Agy.
import type { CandidateProfile } from "./schemas";

export type ApplicationFact = { label: string; value: string };

export function applicationFacts(profile: CandidateProfile | null): ApplicationFact[] {
  if (!profile) return [];
  const { identity } = profile;
  const logistics = profile.preferences.interview;
  return [
    { label: "Full name", value: identity.fullName },
    { label: "Email", value: identity.email ?? "" },
    { label: "Phone", value: identity.phone ?? "" },
    { label: "Location", value: identity.location ?? logistics.location },
    ...identity.links.map((link, index) => ({ label: index === 0 ? "Links" : "", value: link })),
    { label: "Work authorization", value: logistics.workAuthorization },
    { label: "Pay expectation", value: logistics.compensation },
    { label: "Start date or notice", value: logistics.noticePeriod },
    { label: "Work setup", value: logistics.workArrangement },
    ...profile.preferences.applicationFacts.extra,
  ].filter((fact) => fact.value.trim());
}
