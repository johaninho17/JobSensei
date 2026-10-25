---
name: jobsensei-application-pipeline
description: Screen a supplied JD once and, when accepted, create a lean JobSensei workspace with an evaluation, tailored resume, and cover letter.
---

# JobSensei Application Pipeline

Use this skill automatically for a pasted JD or direct job-posting URL. The candidate profile at `data/profile/candidate.json` supplies identity, chronology, preferences, and filenames through the generated application context. Never assume a person, employer, school, or resume filename.

## Hard Boundary

For a normal run, read only this skill, the supplied JD, and the job's `.sensei/application_context.json` (once, the whole file). Do not read anything else.

**Commands:** your terminal starts in the workspace. Run every npm command exactly as `npm --prefix "$JOBSENSEI_APP_ROOT" run <script> -- <args>`. Never `cd`, `pwd`, or `ls` to find the app. Do not open source code, schemas, validators, other skills, raw context, the full snapshot, the base resume, or any existing job. Do not use subagents, scratch scripts, directory exploration, broad search, or prior application artifacts.

For a URL: run the `jd:fetch` script exactly once with the URL. It prints the clean JD plus the company, title, and a suggested job ID, and stages it for the snapshot. Never use curl, inline scripts (`node -e`, `python -c`), or a second fetch. If the command says it couldn't read the page, ask the user to paste the JD and stop.

For a JD pasted in the app ("Evaluate the job description I pasted…"): the app already saved it. Run `jd:fetch -- --staged` once; it prints the JD, company, title, and suggested job ID exactly like a URL fetch. Then follow the URL path.

## One-Pass Flow

1. Get the JD: for a URL, run `jd:fetch -- "<url>"`; for a JD pasted in the app, run `jd:fetch -- --staged`; for text pasted any other way, use it as given. Screen it once.
2. Score exactly six distinct capabilities: `core` 40%, `technical` 25%, `scope` 15%, `outcomes` 10%, `domain` 5%, and `learning` 5%. Use `direct` 1.00, `strong_transferable` 0.80, `adjacent_transferable` 0.65, `unclear` 0.25, and `gap` 0. Do not score personality, logistics, or ordinary learnable tools as standalone requirements; required items go in the Must-Have table below. A learnable must-have never stops a screen; only a blocker does. Below `3.5/5` (before must-have penalties), report the screen and stop.
3. Use the `suggestedJobId` from `jd:fetch` (or derive lowercase kebab-case `<company>-<role-title>` for pasted text). Never run `ls` or create folders, `pdfs/`, or metadata files yourself.
4. Run the snapshot exactly once, then read `jobs/<job-id>/.sensei/application_context.json` once in a single full read:
   - URL or JD pasted in the app: `context:snapshot -- <job-id> --from-fetched` (it creates the job folder and `original_jd.md` from the staged posting).
   - Text pasted outside the app: first write `jobs/<job-id>/original_jd.md`, then `context:snapshot -- <job-id>`.
5. In one file-writing turn, create only `.sensei/application_bundle.json` (contract below). Keep it short; the finalizer fills in everything unchanged:
   - Leave out earlier employers entirely. They are kept exactly as in the base resume.
   - For the current employer, write the 3–4 reworked bullets as text, and keep each remaining bullet as `{ "baseline": N }` (N = its position in `baselineBullets`, starting at 1), in the order you want.
   - Curate the skills lines from `resumeTemplate.editableSkillCategories`.
   - `evaluationMarkdown`: the scoring table, the must-have table, and at most three one-line bullets (top strength, main gap, apply recommendation).
   - Draft the cover letter exactly as `coverLetterBrief` specifies.
6. Run `application:finalize -- <job-id>` exactly once. Report its `fitScore`, `fitConfidence`, `gateStatus`, `durationSeconds`, and warnings, then stop. Never inspect code, patch output, or retry after finalization.

For an explicit regeneration, the saved JD is the only job-specific input. Existing generated files are stale outputs, not references. Never read them before replacement.

## Drafting Rules

- Candidate facts come only from `evidenceRows`. The JD identifies what to prioritize; it never proves that the candidate performed it.
- Respect every row's employer, timeline, scope, eligibility, `maximumClassification`, and source authority. Every public claim must cite an `eligible` evidence row. Never cite a single `corroboration-required` row alone. Never invent an evidence ID.
- Follow `resumePlan`, `resumeTemplate`, `footprint`, `denylistRules`, and the local candidate preferences. The finalizer restores protected identity, contact details, chronology, titles, dates, locations, education, and layout.
- Unchanged base-resume bullets are the candidate's own approved claims: copy them word for word. A *rewritten* bullet must trace every claim to `evidenceRows`; the baseline wording shows the confidence level to match, not new facts to add.
- Resume summary: only if `resumeTemplate.summary.editable` is true, add `"summary": { "text": ..., "evidenceIds": [...] }` to `resume` in the bundle (at most 3 lines, same truth rules as bullets). Otherwise leave it out; the base resume's own summary, if any, stays verbatim.
- Surgical tailoring (principle owned by `AGENTS.md`): earlier roles stay out of the bundle unless evidence makes them directly relevant; curate skills categories for the target domain; rework only 3–4 current-role bullets toward the JD's core work; keep bullets about 16–20 words. Within ±15% of the footprint needs no manual counting.
- Align bullet emphasis with the core discipline of the target role (e.g., leadership, operations, commercial, technical, or people enablement) based on the candidate's supported background without exaggerating scope or ownership.
- Plain professional language for the candidate's field (`$jobsensei-anti-slop`): an accurate action, a concrete method or tool, and a supported purpose or result.
- Keep the cover letter candidate-first. `coverLetterBrief` in the application context is the only cover-letter specification (structure, opening, word range, banned phrases); follow it and nothing else.
- Client names, `styleRules`, and evidence IDs in public files follow the `AGENTS.md` core rules.

## Evaluation Table

Put this table in `evaluationMarkdown`; the finalizer calculates the authoritative total:

```markdown
### Requirement Scoring
| Requirement | Category | Weight | Material | Classification | Evidence |
| --- | --- | ---: | --- | --- | --- |
| Primary role capability | core | 40% | yes | strong_transferable | context:exact:id |
| Required technical capability | technical | 25% | yes | direct | context:exact:id |
| Expected ownership and scope | scope | 15% | yes | adjacent_transferable | context:exact:id |
| Expected delivery outcome | outcomes | 10% | yes | strong_transferable | context:exact:id |
| Specialized product knowledge | domain | 5% | no | unclear | context:exact:id |
| Learnable ramp-up requirement | learning | 5% | no | strong_transferable | context:exact:id |
```

Then rate every item in the context's `mustHaves` list, one row each, in order, starting the Requirement cell with its ID. If `mustHaves` is empty, list the posting's hard requirements yourself.

```markdown
### Must-Have Requirements
| Requirement | Status | Evidence | Note |
| --- | --- | --- | --- |
| must:1 Proficiency in Java or Kotlin | learnable | context:exact:id | Foundation in related languages; no production use |
| must:2 Fluency in SQL | met | context:exact:id | |
```

The finalizer checks this table: an item you skip counts as learnable, and `met` needs an evidence ID whose claim actually shows the requirement (otherwise it becomes learnable). Don't add rows the posting doesn't require.

- `met`: the cited evidence row shows it.
- `learnable`: no production evidence, but it can be learned on the job (languages, frameworks, tools, methods). Cite foundation evidence (coursework, a related language) when it exists. Each learnable must-have lowers the visible score slightly; it never turns a YES into a NO.
- `blocker`: only legal, credential, clearance, or location requirements the candidate cannot meet.

Never hide a must-have inside a broader category row. Never present foundation or coursework as production experience.

Functional equivalence may earn transferable credit even when tools differ. Direct credit still requires matching action, method, scope, and ownership. Exact tools, production scope, specialized domains, metrics, and outcomes stay strict.

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

Every editable skills line, rewritten bullet, and factual cover-letter sentence needs one or more exact routed evidence IDs. Unchanged baseline bullets are written as `{ "baseline": N }` and need no evidence IDs; never retype them or borrow an unrelated ID. Personal motivation or a closing may use an empty list. Use at least two evidence-backed cover-letter sentences with distinct evidence so the career arc can be derived. Do not include protected resume fields in the bundle.

## Time Budget

Use at most 5 operations: `jd:fetch` (URL or `--staged`; write `original_jd.md` only for text pasted outside the app), the snapshot, one context read, one bundle write, and the finalize. Never list directories, read files for context, or create scaffolding. Target: under 60 seconds end to end. A warning is a completed run, not permission to investigate or repair.
