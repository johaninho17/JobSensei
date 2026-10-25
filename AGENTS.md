# JobSensei workspace rules

JobSensei is a local-first career workspace. Candidate identity, chronology, preferences, source paths, and truth boundaries come from `data/profile/candidate.json` and the active context manifest. Never assume a particular person, employer, school, location, or filename.

## Core rules

- Never invent candidate experience, tools, dates, metrics, ownership, credentials, projects, or outcomes. Frame real work confidently, but every claim must be defensible in an interview.
- Treat selected structured career evidence as factual authority. Broad context clarifies; LinkedIn and secondary resumes corroborate history; the base resume protects identity, chronology, structure, and presentation.
- Unchanged base-resume bullets are the candidate's own approved claims and may appear word for word, but they earn no fit-score credit, and any rewritten or new claim must trace to evidence in the current `application_context.json`. Conversation memory, prior jobs, and old applications are never evidence.
- Always enforce the candidate's denylist. Never upgrade configuration, testing, integration, support, or enablement into architecture, sole ownership, production scope, or performance claims.
- Classify important JD language as supported, transferable, or unsupported. State only supported capabilities directly, and never copy JD terminology into candidate history.
- When AI is central to the JD and the evidence supports AI, agent, or model work, show that work in experience bullets, not only in Skills.
- Apply the candidate's voice profile (`styleRules`) last, for wording only; it cannot create or strengthen a claim.
- Never modify source resumes or career-context documents.
- Never read sibling jobs, prior tailored applications, or unselected context unless the user explicitly selects or names them.
- A prompt ending in `(job: <job-id>)` names exactly one job: use `jobs/<job-id>/` and nothing else. Without a job ID, match company **and** title; if more than one job still matches, list them and ask. Never pick a job by company alone.
- Enforce the Universal Surgical Diffing Standard: Never rewrite historical or earlier career experience unless explicitly relevant. Keep foundational past roles frozen verbatim from the base resume, focusing tailoring strictly on the top skills categories and the 3–4 target bullets at the current/most recent employer.
- Keep evidence IDs, warnings, hashes, and provenance out of employer-facing files.
- Never name clients or partners in a resume or cover letter (see the profile's `truth.confidentialNames`); describe them by industry instead.
- The cover-letter specification lives only in the generated `coverLetterBrief`; skills point to it.
- Keep candidate-specific guidance in the local ignored profile or context, not in public skills or repository rules.

## New job flow

Use `$jobsensei-application-pipeline` as the sole orchestrator for a pasted JD or job URL. It owns the steps: `jd:fetch` for a URL or a JD pasted in the app, one snapshot (which prints the context), one `.sensei/application_bundle.json` write, one finalize, then stop. Target: under 60 seconds.

Do not inspect implementation code, validators, schemas, package metadata, or other skills during a routine application. Do not use subagents, scratch scripts, manual word-count commands, converter searches, or repair loops. A finalization warning means the drafts are ready for human review.

Default application output is limited to `original_jd.md`, `evaluation.md`, the tailored resume, `cover_letter.md`, `pdfs/`, and hidden `.sensei/` state. Do not create README, checklist, match, change-plan, or separate audit files.

## Interview flow

Use `$jobsensei-interview-pipeline` only after the user explicitly asks to prepare an existing job for an interview. Use `$jobsensei-technical-challenge` only for an explicitly requested challenge or test. A pasted JD never creates interview content.

Interview preparation follows `$jobsensei-interview-pipeline` (One-Pass flow with `interview:context` and `interview:check`). It owns every interview rule: framing (strong but never invented), the knowability test (no company-internal or impossible questions), the question card (short cues, no scripts), gap questions, and no overlap between rounds. Logistics come only from the candidate's Settings. The candidate's own work stories from interviews become career evidence only after the user confirms them into `context/structured/interview-stories.md`.

## Engineering work

Inspect the current implementation before editing, preserve unrelated changes and private data, keep Electron/renderer interfaces narrow, and run proportionate tests. Do not publish or deploy without explicit user authorization.

See `PRODUCT_FLOWS.md` for the user-facing workflow map and safe skill-customization guidance.
