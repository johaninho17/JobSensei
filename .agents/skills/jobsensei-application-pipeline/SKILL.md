---
name: jobsensei-application-pipeline
description: Screen a supplied JD once and, when accepted, create a lean JobSensei workspace with an evaluation, tailored resume, and cover letter.
---

# JobSensei Application Pipeline

Use this skill automatically for a pasted JD or direct job-posting URL. The candidate profile at `data/profile/candidate.json` supplies identity, chronology, preferences, and filenames through the generated application context. Never assume a person, employer, school, or resume filename.

## Hard Boundary

For a normal run, read only this skill, the supplied JD, and the job's `.sensei/application_context.json` (once, the whole file). Do not read anything else.

**Commands:** your terminal starts in the workspace. Run every pipeline command exactly as `sensei <command> <args>` (the app puts `sensei` on your PATH). Never `cd`, `pwd`, or `ls` to find the app. Do not open source code, schemas, validators, other skills, raw context, the full snapshot, the base resume, or any existing job. Do not use subagents, scratch scripts, directory exploration, broad search, or prior application artifacts. Never edit `.sensei/` files other than the bundle, and never rename generated files: if a command fails, report its message and stop.

For a URL: run the `jd:fetch` script exactly once with the URL. It prints the clean JD (the app has already removed the application form and page buttons) plus the company, title, and a suggested job ID, and stages it for the snapshot. Never use curl, inline scripts (`node -e`, `python -c`), or a second fetch, except one rerun with `BypassSandbox` when the command says there is no network. If it prints "Stop here", tell the user the page couldn't be read, ask them to paste the job description in the app, and end the run. Never look for the posting another way (other URLs, APIs, web search).

For a JD pasted in the app ("Evaluate the job description I pasted (paste ID <id>…)"): the app saved it under that ID. Run `sensei jd:fetch --staged <id>` once with that exact ID; it prints the JD, company, title, and suggested job ID exactly like a URL fetch. Then follow the URL path. The app sends one job at a time, so finish this one before anything else.

## One-Pass Flow

1. Get the JD: for a URL, run `sensei jd:fetch "<url>"`; for a JD pasted in the app, run `sensei jd:fetch --staged <paste-id>`. If the user pastes a JD straight into this terminal, ask them to paste it in the app's Add jobs box instead and stop (the app cleans it and asks for a missing company). Screen it once.
2. Screen once: stop only for a blocker you can see in the posting (legal, credential, clearance, location) or a role far outside the candidate's field. The app scores the fit from the Evaluation Table and reports it against `fitGate` in the context.
3. Use the `suggestedJobId` from `jd:fetch`. Never run `ls` or create folders, `pdfs/`, or metadata files yourself.
4. Run the snapshot exactly once, then read `jobs/<job-id>/.sensei/application_context.json` once in a single full read:
   `sensei context:snapshot <job-id> --from-fetched` (it creates the job folder and `original_jd.md` from the staged posting). If `jd:fetch` printed `"company": null`, add `--company "<employer>"` only when the JD names the hiring employer itself, and start the job ID with that name in kebab-case. A business unit, team, division, brand line, or recruiting agency is never the company; if the JD names no employer, ask the user for the company and stop.
5. In one file-writing turn, create only `.sensei/application_bundle.json` (contract below). Keep it short; the finalizer fills in everything unchanged:
   - Leave out earlier employers entirely. They are kept exactly as in the base resume.
   - For the current employer, write the 3–4 reworked bullets as text, and keep each remaining bullet as `{ "baseline": N }` (N = its position in `baselineBullets`, starting at 1), in the order you want.
   - Skills lines: start from `resumeTemplate.editableSkillCategories` and follow the snapshot `instructions` (keep the base resume's items).
   - `evaluationMarkdown`: the scoring table, the must-have table, and at most three one-line bullets (top strength, main gap, apply recommendation).
   - Draft the cover letter exactly as `coverLetterBrief` specifies. If the application context has no `coverLetterBrief`, its instructions say why: leave `coverLetter` out of the bundle.
6. Run `sensei application:finalize <job-id>` exactly once. Report its `fitScore`, `fitConfidence`, `gateStatus`, `durationSeconds`, and warnings, then stop. Never inspect code, patch output, or retry after finalization.

For an explicit regeneration, the saved JD is the only job-specific input. Existing generated files are stale outputs, not references. Never read them before replacement.

## Drafting Rules

- Candidate facts come only from `evidenceRows`. The JD identifies what to prioritize; it never proves that the candidate performed it.
- Respect every row's employer, timeline, scope, eligibility, `maximumClassification`, and source authority. Every public claim must cite an `eligible` evidence row. Never cite a single `corroboration-required` row alone. Never invent an evidence ID.
- Follow `resumePlan`, `resumeTemplate`, `footprint`, `denylistRules`, and the local candidate preferences. The finalizer restores protected identity, contact details, chronology, titles, dates, locations, education, and layout.
- Unchanged base-resume bullets are the candidate's own approved claims: copy them word for word. A *rewritten* bullet must trace every claim to `evidenceRows` (the base resume's own lines count as evidence (`base:` rows; the snapshot instructions own this rule)); the baseline wording shows the confidence level to match, not new facts to add.
- Resume summary: only if `resumeTemplate.summary.editable` is true, add `"summary": { "text": ..., "evidenceIds": [...] }` to `resume` in the bundle (at most 3 lines, same truth rules as bullets). Otherwise leave it out; the base resume's own summary, if any, stays verbatim.
- Surgical tailoring (principle owned by `AGENTS.md`): earlier roles stay out of the bundle unless evidence makes them directly relevant; skills and length follow the snapshot `instructions`; rework only 3–4 current-role bullets toward the JD's core work; keep bullets about 16–20 words. Within ±15% of the footprint needs no manual counting.
- Align bullet emphasis with the core discipline of the target role (e.g., leadership, operations, commercial, technical, or people enablement) based on the candidate's supported background without exaggerating scope or ownership.
- Plain professional language for the candidate's field (`$jobsensei-anti-slop`): an accurate action, a concrete method or tool, and a supported purpose or result.
- Keep the cover letter candidate-first. `coverLetterBrief` in the application context is the only cover-letter specification (structure, opening, word range, banned phrases); follow it and nothing else.
- Client names, `styleRules`, and evidence IDs in public files follow the `AGENTS.md` core rules.

## Evaluation Table

Put this table in `evaluationMarkdown`. Rate every item in the context's `requirements` list (the posting's own required items and main responsibilities), one row each, in order, starting the Requirement cell with its ID. The app writes the posting's wording, the weights, the Must-Have table, and the score; a skipped item counts as a gap.

```markdown
### Requirement Scoring
| Requirement | Category | Classification | Evidence | Blocker |
| --- | --- | --- | --- | --- |
| req:1 | technical | direct | context:exact:id | |
| req:2 | core | adjacent_transferable | context:exact:id | |
| req:3 | scope | gap | | |
```

- **Category:** `core` (the central work), `technical` (skills, methods, systems), `scope` (ownership, seniority, stakeholders), `outcomes`, `domain` (industry or employer platform), or `learning`.
- **Classification**, judged against the candidate's evidence rows, never the title or the posting: `direct` (same action, method, scope, and ownership), `strong_transferable` (substantially the same work with a different tool or setting), `adjacent_transferable` (a real foundation, clearly less), `unclear`, `gap`. The app checks each rating against the cited row and the posting's wording.
- **Evidence:** the row that shows it. Never present foundation or coursework as production experience.
- **Blocker:** `yes` only for a legal, credential, clearance, or location requirement the candidate cannot meet.

If `requirements` is empty, use the same five columns and write six rows of your own, one per category, with a short label in the Requirement cell instead of an ID (the app adds the weights and the score), plus a `### Must-Have Requirements` table (`| Requirement | Status | Evidence | Note |`, status `met` / `learnable` / `blocker`) for the posting's hard requirements.

## Single Bundle Contract

Write `.sensei/application_bundle.json` only. Put exact evidence IDs beside each generated claim so the finalizer can derive the legacy draft and evidence map without another model pass.

```json
{
  "schemaVersion": 1,
  "applicationRunId": "<application_run.runId>",
  "evidenceSnapshotId": "<application_context.snapshotId>",
  "canonicalBaselineId": "<application_context.resumeTemplate.baselineId>",
  "evaluationMarkdown": "# Application Evaluation\n\n### Requirement Scoring\n...",
  "resume": {
    "skillsLines": [
      { "text": "**Engineering:** TypeScript, Node.js, REST APIs", "evidenceIds": ["context:exact:id"] }
    ],
    "employers": [
      {
        "name": "<exact resumeTemplate employer name>",
        "bullets": [
          { "text": "Built an evidence-backed integration.", "evidenceIds": ["context:exact:id"] },
          { "baseline": 2 }
        ]
      }
    ]
  },
  "coverLetter": {
    "date": "<current date>",
    "recipientLines": ["Hiring Manager", "<Company>"],
    "salutation": "Dear Hiring Manager,",
    "bodyParagraphs": [
      {
        "sentences": [
          { "text": "I began my career building software systems.", "evidenceIds": ["context:prior:id"] },
          { "text": "My work later expanded into customer-facing technical delivery.", "evidenceIds": ["context:current:id"] }
        ]
      },
      {
        "sentences": [
          { "text": "Thank you for your consideration.", "evidenceIds": [] }
        ]
      }
    ],
    "closing": "Sincerely,"
  },
  "excludedClaims": [],
  "warnings": []
}
```

Every editable skills line, rewritten bullet, and factual cover-letter sentence needs one or more exact routed evidence IDs: cite the row whose text contains the line's terms. Wording may be reframed, but every tool, product, or organization a line names must appear in its cited rows (skills terms: in any eligible row or the base resume). Unchanged baseline bullets are written as `{ "baseline": N }` and need no evidence IDs; never retype them or borrow an unrelated ID. Personal motivation or a closing may use an empty list. Use at least two evidence-backed cover-letter sentences with distinct evidence so the career arc can be derived. Do not include protected resume fields in the bundle.

## Time Budget

Use at most 5 operations: `jd:fetch` (URL or `--staged <paste-id>`), the snapshot, one context read, one bundle write, and the finalize. Never list directories, read files for context, or create scaffolding. Target: under 60 seconds end to end. A warning is a completed run, not permission to investigate or repair.
