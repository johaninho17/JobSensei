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

Write a concise traditional application letter in a human, conversational voice:

- Prefer 190-230 words; allow 180-260 when the employer connection and career arc are complete; never exceed 300.
- Treat `.sensei/application_context.json.coverLetterBrief` as the run-specific writing brief. Use its single employer focus briefly and obey its required elements and prohibited patterns.
- Candidate-first means the profile's story exists independently of the JD. The JD may select a relevant episode but cannot create interests, passions, career focus, identity, or reasons for applying.
- Candidate-originated motivation must come from the profile, application voice guidance, selected evidence, or user-provided goals. `non-factual` classification never authorizes invented preferences.
- Begin with the profile's authentic career narrative, a documented transition, or work the candidate wants to continue. Do not open with `I am applying`, `I am excited to apply`, `I am interested in`, or an employer description. Derive the opening from routed evidence rather than a reusable sentence.
- Prefer 3-5 body paragraphs without padding to reach a minimum.
- Connect a genuine reason for the move, one or two accurately timed evidence-backed examples, and a truthful career progression. Fit should be demonstrated through concrete evidence, not declared through lists of matching requirements or prose inventories of tools.
- Follow this narrative priority without turning it into boilerplate: who the candidate is; a documented career change; one or two concrete examples; why the opportunity is a reasonable next step; a short natural close.
- Tailor for ATS and human review using the same `supported`, `transferable`, and `unsupported` keyword classes as the resume. Use exact supported JD terminology naturally. Describe transferable experience as a credible bridge without claiming the exact unsupported tool, tier, domain, ownership, or outcome. Mention unsupported terminology only as the employer's need or a learning area, never as candidate history.
- Build progression from eligible evidence and include only stages that explain this move. Education and earlier employers are optional. Preserve chronology and keep at least three quarters of the body on the candidate.
- Use one short career bridge that explains why the documented progression makes this move credible. Vary the narrative angle according to the evidence without forcing the same paragraph order across letters or repeating a fixed education-to-current-role scaffold.
- Use one or two supported JD terms per paragraph only where they clarify the match. Do not use a prose skills inventory, generic enthusiasm, vague culture-fit language, or a JD requirement as if it were candidate history. Use at most one sentence to describe the employer or role and never add a standalone requirements paragraph; the JD supplies context, not the letter's main subject.
- Use present tense and a `current` career stage only when mapped evidence explicitly has `isOngoing: true`. Completed current-year work is recent, not current. Use past tense or bounded language such as “my work has included” when continuity is not documented, and never derive “recently, I have focused” from a broad multi-year range.
- Describe `isOngoing: true` work in present tense. Keep completed projects and earlier-employer history in past tense.
- Name career stages from dated evidence, never from the target JD, and never merge separate projects into a new current function.
- Use secondary-resume `contextText` only to locate relevant historical experience that selected structured evidence or LinkedIn corroborates. Never cite a secondary resume as sole support for a public fact, metric, ownership claim, or career transition.
- Avoid application-announcement openings, generic enthusiasm, vague culture-fit claims, JD repetition, private labels, and unsupported employer claims. Prohibit formulaic phrasing such as `Throughout my work, I have focused...`, `making this position a natural continuation`, `That background allows me to...`, and `I look forward to bringing [requirement list]`.
- Do not reuse stock bridges or closes across jobs. Close simply with the kind of work the candidate wants to continue and why it matters here; do not promise unsupported impact.
- Never begin with an anonymous market statement such as “Engineering teams need...” or spend the opening paragraph explaining what the company does. Vary sentence rhythm and verbs; do not reuse `I enjoy helping...`, `Over time, my work expanded...`, or the same education-to-current-role scaffold as a default.
- Never write or alter the candidate contact block. The canonical finalizer inserts it verbatim from the configured base resume.
- Preserve the canonical letter format and hierarchy. Revise only the permitted recipient, date, salutation, body, and closing fields.
- Apply the configured application voice profile after factual sentences and evidence mappings are complete. Use common spoken words, concrete examples, restrained confidence, and a readable career path. If the candidate would not naturally say a phrase aloud, simplify it.
- Write as a senior engineer speaking directly to a hiring manager: confident, practical, conversational, and specific. Avoid `My background connects...`, `This progression...`, repeated pitch-deck transitions, and paragraph-length technology inventories.
- Do not write `I am drawn to the mission`, `I am passionate about your mission`, `democratizing access`, or another paraphrase of employer marketing. The voice profile is style policy only and cannot support a factual sentence.
- The voice pass may simplify wording but must not change timeline, scope, ownership, tools, metrics, outcomes, or evidence mappings.
- `data/cover-letters/Cover Letter Template.pdf` is layout and storytelling guidance only. Do not read it during a routine run or copy its wording; the approved lessons from it are already encoded in the application voice profile.

For another explicitly requested application response, create only that requested public file and update the hidden evidence map when it contains candidate facts.

Perform one writing pass, run `npm run application:finalize -- <job-id> --review` once, and stop.
