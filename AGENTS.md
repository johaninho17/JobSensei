# JobSensei workspace rules

JobSensei is a local-first career workspace. Candidate identity, chronology, preferences, source paths, and truth boundaries come from `data/profile/candidate.json` and the active context manifest. Never assume a particular person, employer, school, location, or filename.

## Core rules

- Never invent candidate experience, tools, dates, metrics, ownership, credentials, projects, or outcomes.
- Treat selected structured career evidence as factual authority. Broad context clarifies; LinkedIn and secondary resumes corroborate history; the base resume protects identity, chronology, structure, and presentation.
- Never modify source resumes or career-context documents.
- Never read sibling jobs, prior tailored applications, or unselected context unless the user explicitly selects or names them.
- Keep evidence IDs, warnings, hashes, and provenance out of employer-facing files.
- Keep candidate-specific guidance in the local ignored profile or context, not in public skills or repository rules.

## New job flow

Use `$jobsensei-application-pipeline` as the sole orchestrator for a pasted JD or job URL. Follow its bounded read list and command budget exactly:

1. Screen once.
2. For accepted jobs, batch intake files.
3. Run `npm run context:snapshot -- <job-id>` once.
4. Read the compact application context once.
5. Write one `.sensei/application_bundle.json` with evidence IDs inline.
6. Run `npm run application:finalize -- <job-id>` once and stop.

Do not inspect implementation code, validators, schemas, package metadata, or other skills during a routine application. Do not use subagents, scratch scripts, manual word-count commands, converter searches, or repair loops. A finalization warning means the drafts are ready for human review.

Default application output is limited to `original_jd.md`, `evaluation.md`, the tailored resume, `cover_letter.md`, `pdfs/`, and hidden `.sensei/` state. Do not create README, checklist, match, change-plan, or separate audit files.

## Interview flow

Use `$jobsensei-interview-pipeline` only after the user explicitly asks to prepare an existing job for an interview. Use `$jobsensei-technical-challenge` only for an explicitly requested challenge or test. A pasted JD never creates interview content.

Interview research may use current public sources when requested, but external information cannot become candidate career evidence. Transcripts are performance records, not factual career sources.

## Engineering work

Inspect the current implementation before editing, preserve unrelated changes and private data, keep Electron/renderer interfaces narrow, and run proportionate tests. Do not publish or deploy without explicit user authorization.

See `PRODUCT_FLOWS.md` for the user-facing workflow map and safe skill-customization guidance.
