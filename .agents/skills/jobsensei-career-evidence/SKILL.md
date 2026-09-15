---
name: jobsensei-career-evidence
description: Build, inspect, and audit truthful career evidence from the user's local JobSensei data. Use when a resume, job match, application answer, or interview story needs factual support, provenance, gap handling, or a truthfulness review.
---

# JobSensei Career Evidence

Use `data/profile/candidate.json` for identity, source roots, employer chronology, and preferences. Never assume a particular candidate or employer.

Build a reusable evidence map from user-owned files without inventing or upgrading claims. This skill is the grounding layer for every downstream job workflow.

Read [context-first-contract.md](references/context-first-contract.md) before collecting evidence. This pass is mandatory for structured job work.

Read [the workflow contract](../jobsensei-application-pipeline/references/workflow-contract.md) for scope enforcement. Evidence collection must not inspect unselected sibling job folders, follow links found inside source files, or perform external research unless the user explicitly requests it.

## Source Roles

1. Treat eligible rows from selected `data/context/structured/` files as the exclusive factual authority for capabilities, projects, responsibilities, tools, outcomes, ownership, and metrics.
2. Treat selected `data/context/structured/company/` and `data/context/broad/company/` files as `employer-context`. They describe a company's public products, market, scale, and operating environment; they are never candidate evidence. Use selected current-employer context only to calibrate organizational wording.
3. Treat selected `data/context/broad/` files as raw supporting context only. Never read unselected broad or structured files, and never count a broad file and its structured derivative as independent evidence.
4. Use the app-configured base resume only as the canonical presentation, identity, chronology, title, date, and section baseline. Its bullets, skills, metrics, ownership, and outcomes are untrusted until eligible selected context independently supports them.
5. Use the configured LinkedIn profile for education, credentials, skills, career history, and corroboration. LinkedIn-only current-employer evidence cannot independently support a public claim or direct score credit when selected project evidence is available.
6. Treat secondary-resume snapshot text as a lower-weight historical index. It may identify an older role, tool, or date worth checking in selected structured evidence or LinkedIn, but it is never an eligible evidence row, cannot earn score credit, and cannot independently support a public claim.
6. Treat configured secondary resumes as lower-weight historical support. They may recover older experience but cannot silently override stronger selected context, LinkedIn, or the base resume.
7. Treat normalized `boudica_client_work` evidence like every other selected context source. There is no special platform-reference root.
8. Treat existing files under `data/jobs/<job-id>/` as job-specific context, not global proof, unless the user explicitly promotes a claim.
9. Preserve the source-relative path, source family, source role, and a locator or excerpt for every factual claim.
10. When a file declares a `source_family`, deduplicate related raw and normalized derivatives. Use the richest selected representation for retrieval, but preserve the original source path for provenance.
11. Preserve normalized start/end years, ongoing status, and recency band in the snapshot. Recency is a ranking signal only after a claim is relevant and eligible; it never upgrades confidence, directness, ownership, or truthfulness.
12. Treat `data/context/application_voice_profile.md` as always-on style policy. It has no factual authority and cannot create an evidence row, score credit, chronology, metric, ownership, or outcome.

Use old cover letters only as voice, tone, and phrasing references. They are not factual evidence and cannot establish career chronology, employer motivation, resume content, or an application claim.

## Workflow

1. Reread `data/.sensei/active-context.json`; do not use a manifest remembered earlier in the conversation.
2. For an accepted job, create the full evidence snapshot and read its derived `application_context.json` exactly as required by [the evidence snapshot contract](../jobsensei-application-pipeline/references/evidence-snapshot-contract.md). Application matching and drafting may use only routed rows from that compact context; the full snapshot remains verification state.
3. Enforce `data/context/denylist.md` even when it is unchecked. Ignore `context/structured/README.md` as evidence.
4. Read eligible non-LinkedIn structured rows first, especially detailed current-employer project sources. Use selected broad text for clarification, then use LinkedIn for corroboration, education, chronology, and older roles. Use the base resume for identity, chronology, and presentation.
5. Normalize each claim without strengthening its wording. Keep uncertainty and ownership limitations.
6. Preserve the snapshot evidence ID, source path, family, locator, hash, confidence, classification, eligibility, employer, timeline, routing ceiling, and scope.
7. Deduplicate related source families and keep conflicts visible.
8. Before handoff, reject denylisted claims, unsupported metrics, ownership upgrades, resume-only claims, and remembered claims that lack a current eligible evidence row.

## Claim Rules

- `verified`: directly supported by a source.
- `supported inference`: reasonable interpretation that must be labeled as inference.
- `gap`: requested fact has no reliable source.
- `contradiction`: sources disagree; do not choose silently.

Never turn exposure into ownership, collaboration into leadership, familiarity into expertise, or a broad domain reference into a specific achievement. Preserve source verbs such as "worked with," "participated," "contributed," and "supported" unless a stronger responsibility is directly documented. Ask for confirmation only when the missing fact changes the application materially; otherwise mark the gap and proceed conservatively.

For ATS tailoring, classify each important JD term before drafting:

- `supported`: eligible evidence substantively supports the same capability; exact wording may be used even when the source uses a truthful synonym.
- `transferable`: evidence supports an adjacent capability but not the named tool, tier, domain, ownership, or outcome; preserve that distinction in public wording.
- `unsupported`: no eligible evidence supports a candidate claim; retain it only as a gap or employer requirement.

Never infer a named platform from a generic workflow or treat JD terminology as evidence. Evidence that supports API troubleshooting may support the truthful keywords `API`, `troubleshooting`, and `technical support`; it does not by itself support `Tier 3`, `JIRA`, `Salesforce`, `SLA ownership`, or a production-scale outcome.

## Outputs

For a reusable evidence map, write a human-readable `career_evidence.md` only when the user requests a saved artifact. For job work, place job-specific evidence in `data/jobs/<job-id>/` and reference source IDs rather than copying unsupported claims. Include an audit section listing gaps, contradictions, and claims intentionally excluded.

Read [grounding-rules.md](references/grounding-rules.md) when evaluating ambiguous claims or reviewing generated application material.

## Routing Examples

- Application-only: intake -> career evidence -> job match -> approved resume/application materials; no interview outputs.
- Cover-letter-only: career evidence -> requested cover letter; do not create interview artifacts.
- Resume-tailoring-only: career evidence -> resume tailoring; preserve the canonical resume.
- Evaluation report: career evidence -> supported/partial/gap/unclear report with provenance.
- Mock interview: require confirmed interview stage, then use career evidence and prior job artifacts.
- Full pipeline: intake -> evidence -> match -> application -> user review/submission -> confirmed interview preparation.
