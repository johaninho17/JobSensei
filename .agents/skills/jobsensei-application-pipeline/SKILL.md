---
name: jobsensei-application-pipeline
description: Screen a supplied JD once and, when accepted, create a lean JobSensei workspace with an evaluation, tailored resume, and cover letter.
---

# JobSensei Application Pipeline

Use this skill automatically for a pasted JD or direct job-posting URL. The candidate profile at `data/profile/candidate.json` supplies identity, chronology, preferences, and filenames through the generated application context. Never assume a person, employer, school, or resume filename.

## Hard Boundary

For a normal run, read only this skill, `data/.sensei/active-context.json`, the supplied JD, and the new job's `.sensei/application_run.json` plus `.sensei/application_context.json`. Do not open source code, schemas, validators, other skills, raw context, the full snapshot, the base resume, or any existing job. Do not use subagents, scratch scripts, converter discovery, broad search, or prior application artifacts.

For a URL, fetch that exact posting once. Do not browse linked pages or retry through alternate tools. If it cannot be fetched, ask the user to paste the JD and stop.

## One-Pass Flow

1. Extract the company, role, location, source URL, and clean JD. Screen it once.
2. Score exactly six distinct capabilities: `core` 40%, `technical` 25%, `scope` 15%, `outcomes` 10%, `domain` 5%, and `learning` 5%. Use `direct` 1.00, `strong_transferable` 0.80, `adjacent_transferable` 0.65, `unclear` 0.25, and `gap` 0. Do not score personality, logistics, or ordinary learnable tools as standalone requirements. Only a genuine hard blocker prevents applying.
3. Below `3.5/5`, save only the screened result and stop. At or above the gate, create `data/jobs/<job-id>/original_jd.md`, `pdfs/`, `.sensei/job.json`, and `.sensei/status.json` in one file-writing turn.
4. Run `npm run context:snapshot -- <job-id>` exactly once.
5. Read `.sensei/application_run.json` and `.sensei/application_context.json` once. The compact context is the complete drafting boundary and retains every routed claim needed for the run.
6. In one file-writing turn, create only `.sensei/application_bundle.json` using the contract below.
7. Run `npm run application:finalize -- <job-id>` exactly once. Report its `fitScore`, `fitConfidence`, `gateStatus`, and warnings, then stop. Never inspect code, patch output, or retry after finalization.

For an explicit regeneration, the saved JD is the only job-specific input. Existing generated files are stale outputs, not references. Never read them before replacement.

## Drafting Rules

- Candidate facts come only from `evidenceRows`. The JD identifies what to prioritize; it never proves that the candidate performed it.
- Respect every row's employer, timeline, scope, eligibility, `maximumClassification`, and source authority. Every public claim must cite an `eligible` evidence row. Never cite a single `corroboration-required` row alone. Never invent an evidence ID.
- Follow `resumePlan`, `resumeTemplate`, `footprint`, `denylistRules`, and the local candidate preferences. The finalizer restores protected identity, contact details, chronology, titles, dates, locations, education, and layout.
- Use `resumeTemplate.originalBullets` and `originalSkillsLines` as the presentation baseline and wording reference; they cannot independently prove a claim, metric, tool, or outcome.
- Substantively reframe at least 4-5 experience bullets to align directly with the target role's core responsibilities and technical priorities using routed eligible evidence. Merely copying baseline bullets verbatim triggers `RESUME_TAILORING_TOO_SIMILAR`.
- Strictly adhere to the experience word count budget (`footprint.targetExperienceWordMin` to `footprint.targetExperienceWordMax`). Do not exceed `targetExperienceWordMax` (triggers `RESUME_EXPERIENCE_DENSITY_HIGH`).
- For customer-facing roles, use the plan's supported customer evidence while retaining technical work. For AI-focused roles, surface supported AI work in experience without upgrading integration, testing, configuration, or enablement into model ownership.
- Use direct, natural engineering language. Prefer an accurate action, concrete method or tool, and supported purpose or result. Avoid noun chains, decorative skill labels, keyword inventories, and denylisted wording.
- Keep the cover letter candidate-first and strictly between 190-230 words. In the opening paragraph, introduce the candidate's background ('I' / 'my') and explicitly connect the trajectory to both the target company and role names (prevents `COVER_LETTER_INTRO_IMPERSONAL`). Do not announce the application with generic clichés, paraphrase the JD, invent passion, or spend a paragraph describing the employer.
- Apply `styleRules` last for wording only. They cannot support facts or alter evidence mappings.
- Employer-facing files must never contain evidence IDs, warnings, hashes, or generation notes.

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
          { "text": "Built an evidence-backed integration.", "evidenceIds": ["context:exact:id"] }
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

Every editable skills line, resume bullet, and factual cover-letter sentence needs one or more exact routed evidence IDs. Personal motivation or a closing may use an empty list. Use at least two evidence-backed cover-letter sentences with distinct evidence so the career arc can be derived. Do not include protected resume fields in the bundle.

## Time Budget

Use one fetch, one batched intake write, one snapshot command, one compact-context read, one bundle write, and one finalization command. The target is 30-60 seconds. A warning is a completed run, not permission to investigate or repair.
