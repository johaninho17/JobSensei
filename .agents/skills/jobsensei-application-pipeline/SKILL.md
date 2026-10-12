---
name: jobsensei-application-pipeline
description: Screen a supplied JD once and, when accepted, create a lean JobSensei workspace with an evaluation, tailored resume, and cover letter.
---

# JobSensei Application Pipeline

Use this skill automatically for a pasted JD or direct job-posting URL. The candidate profile at `data/profile/candidate.json` supplies identity, chronology, preferences, and filenames through the generated application context. Never assume a person, employer, school, or resume filename.

## Hard Boundary

For a normal run, read only this skill, the supplied JD, and the new job's `.sensei/application_context.json`. Do not read `data/.sensei/active-context.json` or `.sensei/application_run.json` (the snapshot command reads active-context and outputs run metadata directly). Do not open source code, schemas, validators, other skills, raw context, the full snapshot, the base resume, or any existing job. Do not use subagents, scratch scripts, directory exploration, broad search, or prior application artifacts.

For a URL, fetch that exact posting once and draft directly from the returned content. Do not inspect raw fetched HTML files or browse linked pages. If it cannot be fetched, ask the user to paste the JD and stop.

## One-Pass Flow

1. Extract the company, role, location, source URL, and clean JD. Screen it once.
2. Score exactly six distinct capabilities: `core` 40%, `technical` 25%, `scope` 15%, `outcomes` 10%, `domain` 5%, and `learning` 5%. Use `direct` 1.00, `strong_transferable` 0.80, `adjacent_transferable` 0.65, `unclear` 0.25, and `gap` 0. Do not score personality, logistics, or ordinary learnable tools as standalone requirements. Only a genuine hard blocker prevents applying.
3. Derive `<job-id>` directly as lowercase kebab-case `<company>-<role-title>` (e.g., `gitlab-solutions-architect-public-sector-west`). Never run `ls` or directory checks. Below `3.5/5`, save only the screened result and stop. At or above the gate, write ONLY `data/jobs/<job-id>/original_jd.md`. Never create `pdfs/`, `.gitkeep`, `.sensei/job.json`, or `.sensei/status.json` manually (the snapshot and finalizer commands automatically generate all metadata and folder scaffolding).
4. Run `npm run context:snapshot -- <job-id>` exactly once. Note `snapshotId` and `runId` from the command's stdout.
5. Read `.sensei/application_context.json` once in a single turn. The compact context fits completely in one view and contains every routed claim, resume footprint, and template needed for the run.
6. In one file-writing turn, create only `.sensei/application_bundle.json` using the contract below. To avoid latency, keep `evaluationMarkdown` focused strictly on the 6-row table, adapt pre-verified phrasing from `resumeTemplate.originalBullets` / Bullet Bank for foundational bullets while substantively reframing the 4-5 target bullets, and draft the 3-act cover letter (220-300 words).
7. Run `npm run application:finalize -- <job-id>` exactly once. Report its `fitScore`, `fitConfidence`, `gateStatus`, and warnings, then stop. Never inspect code, patch output, or retry after finalization.

For an explicit regeneration, the saved JD is the only job-specific input. Existing generated files are stale outputs, not references. Never read them before replacement.

## Drafting Rules

- Candidate facts come only from `evidenceRows`. The JD identifies what to prioritize; it never proves that the candidate performed it.
- Respect every row's employer, timeline, scope, eligibility, `maximumClassification`, and source authority. Every public claim must cite an `eligible` evidence row. Never cite a single `corroboration-required` row alone. Never invent an evidence ID.
- Follow `resumePlan`, `resumeTemplate`, `footprint`, `denylistRules`, and the local candidate preferences. The finalizer restores protected identity, contact details, chronology, titles, dates, locations, education, and layout.
- Use `resumeTemplate.originalBullets` and `originalSkillsLines` as the presentation baseline and wording reference; they cannot independently prove a claim, metric, tool, or outcome.
- Omit any resume summary section by default unless `preferences.resume.includeSummary` is explicitly enabled in the candidate profile.
- Consult the candidate's Reusable Bullet Bank (`data/profile/bullet_bank.json`) when available. Where the candidate has pre-verified, high-impact bullets matching the role's themes, prioritize reusing or adapting those bullets to preserve proven wording, save compute, and maintain consistency.
- Curate `skillsLines` categories specifically for the target job's domain using eligible evidence (e.g. adapting headings from generic baselines to job-relevant categories such as "Partner Solutions & Enablement", "Cloud & Data Systems", "Operational Frameworks", etc.). Do not leave skills categories statically frozen across distinct job domains.
- Substantively reframe at least 4-5 experience bullets to align directly with the target role's core responsibilities and priorities using routed eligible evidence. Merely copying baseline bullets verbatim triggers `RESUME_TAILORING_TOO_SIMILAR`.
- Strictly adhere to the experience word count budget (`footprint.targetExperienceWordMin` to `footprint.targetExperienceWordMax`). Do not exceed `targetExperienceWordMax` (triggers `RESUME_EXPERIENCE_DENSITY_HIGH`).
- Align bullet emphasis with the core discipline of the target role (e.g., leadership, operations, commercial, technical, or people enablement) based on the candidate's supported background without exaggerating scope or ownership.
- Use direct, natural professional language appropriate to the candidate's field. Strictly adhere to `$jobsensei-anti-slop` standards: eliminate machine clichés (delve, leverage, utilize, navigate, empower, enhance, showcase, facilitate, unlock, propel, pivotal, robust, tapestry, realm, intersection, synergy, beacon, rule-of-three corporate lists). Prefer an accurate action, concrete method or tool, and supported purpose or result.
- Keep the cover letter candidate-first and follow the 3-Act Narrative Architecture (target 220-300 words):
  - **Act 1 (The Human Connection & Shared Problem):** In paragraph 1, introduce the candidate ('I' / 'my') with a direct, polite statement of application connecting to the company and role, followed immediately by the ground-level operational or technical problem at the boundary of the work. **CRITICAL:** Do NOT lecture the employer on what their industry requires or make grand corporate CEO keynote declarations (e.g., "Delivering seamless digital payment experiences requires both deep API fluency..."). Do NOT parrot the JD qualifications back to the hiring team.
  - **Act 2 (The Career Journey & Human Motivation):** Explain the authentic career evolution from earlier foundational roles toward current specialization, grounded in the profile's documented transition. Never write a mini-resume list of tools or recite the JD.
  - **Act 3 (The Standout Proof Point & Forward Vision):** Highlight concrete evidence-backed achievements that demonstrate problem-solving capability, closing with authentic forward alignment with the team's mission.
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

Use at most 5 bounded operations: write `original_jd.md`, run `npm run context:snapshot`, read `.sensei/application_context.json`, write `.sensei/application_bundle.json`, and run `npm run application:finalize`. Never run exploratory directory listings (`ls`), never create empty `.gitkeep` files, and never read `active-context.json` or `application_run.json`. Target execution time is 30–45 seconds. A warning is a completed run, not permission to investigate or repair.
