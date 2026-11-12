---
name: jobsensei-application-writer
description: Revise an existing JobSensei cover letter or create an explicitly requested short application response without generating audits or checklists.
---

# Lean JobSensei Application Writer

Load candidate profile identity, transition, and voice preferences from `application_context.json.candidate`. Never assume a particular person, employer, school, or career direction.

Use this skill only for an explicit writing request on an existing canonical job. New JD runs are owned by `$jobsensei-application-pipeline`.

For a cover letter, read `.sensei/application_run.json`, `.sensei/application_context.json`, `original_jd.md` (fall back to `original_jd.txt` for legacy workspaces), `evaluation.md`, and the current letter when revising it. Facts must come from the bounded evidence rows in the pinned application context, never the tailored resume, old letters, sibling jobs, the full snapshot, or conversation memory.

Revise only the cover-letter section of `.sensei/application_bundle.json`, keeping exact routed evidence IDs beside every factual sentence. Finalization derives the legacy draft and evidence map.

Do not create `cover_letter_audit.json`, `cover_letter_audit.md`, `submission_checklist.md`, README, provenance, or a separate career-arc file.

Write the letter exactly as `.sensei/application_context.json.coverLetterBrief` specifies. The brief is the only cover-letter specification: structure, opening, word range, and banned phrases live there. Do not use any other structure. Beyond the brief:

- Candidate-first means the candidate's story exists independently of the JD. The JD picks which real episodes to tell; it never creates interests, passions, identity, or reasons for applying. Never invent motivation: `non-factual` sentences must come from the candidate profile, voice guidance, or the user's own words.
- Never explain the employer's business, market, or the role's responsibilities back to them.
- Frame real work with confidence, but every factual sentence must trace to the evidence rows and be defensible in an interview. Never add an event, metric, tool, or ownership that did not happen.
- Never name clients or partners; describe them by industry instead (naming the industry is fine).
- Tense and order follow the timing rule in the career-evidence skill (owner): present tense only for the current phase.
- Apply `styleRules` (the candidate's voice) after the facts are settled. The voice pass may simplify wording but never changes facts, scope, ownership, timeline, tools, metrics, or evidence mappings.
- Never write or alter the contact block or signature; finalization inserts them.

For another explicitly requested application response, create only that requested public file and update the hidden evidence map when it contains candidate facts.

Perform one writing pass, run `sensei application:finalize <job-id> --review` once, and stop.
