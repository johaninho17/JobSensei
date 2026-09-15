---
name: jobsensei-interview-pipeline
description: Advance an existing JobSensei job into stage-aware interview preparation or analyze a completed interview from a short company-and-stage prompt.
---

# JobSensei Interview Pipeline

This is the sole orchestrator for moving an existing application through interview rounds. Load `data/profile/candidate.json` for identity, career chronology, source roots, and preferences. Delegate text mocks and answer feedback to `$jobsensei-interview-coach`.

Do not activate because a pasted JD contains the word `interview`. Never run from screening, intake, matching, resume tailoring, cover-letter generation, or `$jobsensei-application-pipeline`.

## Resolve The Existing Job

1. Read `data/.sensei/active-context.json` when present. Prefer one selected job whose `.sensei/job.json` company or title matches the prompt.
2. If selection does not resolve the prompt, inspect only `data/jobs/*/.sensei/job.json` metadata. Root-level `job.json` is a legacy fallback only. Do not read sibling application artifacts.
3. Require exactly one existing canonical workspace containing `.sensei/job.json` and `original_jd.md` (fall back to legacy `original_jd.txt`). Accept root-level `job.json` only for legacy workspaces. Never create a new `data/jobs/` workspace from an interview prompt.
4. If no workspace matches, ask the user to select the job or run the JD pipeline. If multiple match, show the choices and wait.
5. Normalize the requested stage to one of:
   - `recruiter_screen`
   - `hiring_manager`
   - `technical`
   - `take_home`
   - `onsite`
   - `executive`
   - `unknown`
6. For interview preparation creation, use the canonical two-round layout for every new job:
   - `01-recruiter-hiring-manager/`: one combined first-round preparation set. Keep recruiter coverage, but weight hiring-manager ownership, judgment, ambiguity, customer depth, and career progression more heavily than logistics-only questions.
   - `02-technical/`: independent technical preparation. Do not create technical-challenge material unless the user explicitly asks for a coding challenge, live exercise, take-home, implementation walkthrough, or similar test.
   The combined first round uses `stage: hiring_manager` for schema compatibility and `label: Recruiter / Hiring Manager`; its content must clearly separate recruiter questions from hiring-manager questions. Explicit prompt details and `reported_by_interviewer` process details outrank official generic guidance, candidate reports, and inference.
7. An unspecified first interview creates or updates only `01-recruiter-hiring-manager`. An explicit technical prompt creates or updates only `02-technical`. An explicit technical-challenge prompt creates only the optional `02-technical/challenge/` artifacts and never a third interview round.

## Round Storage Contract

Use `data/jobs/<job-id>/interviews/interview.json` as the job-level index:

```json
{
  "schemaVersion": 2,
  "jobId": "<job-id>",
  "company": "<display company>",
  "role": "<display role>",
  "currentRoundId": "01-recruiter-hiring-manager",
  "rounds": [],
  "knownProcess": []
}
```

Each round record contains `id`, `sequence`, `stage`, `label`, nullable `interviewer`, `format`, and `scheduledDate`, `status`, `artifactPaths`, `debriefSourcePaths`, and `dashboardBrief`. Allowed statuses are `planned`, `prep_ready`, `completed`, and `debriefed`.

`dashboardBrief` is a source-linked projection of the round files for the Sensei interview dashboard. It must not introduce new claims or replace the source artifacts. Preserve the six legacy category arrays for compatibility and also populate `references` as the complete navigation index:

```json
{
  "priorityQuestions": [{ "title": "<question>", "text": "<complete prepared answer>", "sourcePath": "jobs/<job-id>/interviews/<round-id>/question_bank.md", "anchor": "<exact question heading>", "category": "question", "priority": "primary", "sourceType": "round_artifact" }],
  "quickAnswers": [],
  "companyFacts": [],
  "questionsToAsk": [],
  "cautions": [],
  "technicalTopics": [],
  "references": [{ "title": "<reference title>", "text": "<full useful answer, fact, caution, or cue>", "sourcePath": "jobs/<job-id>/interviews/<round-id>/<source>", "anchor": "<exact Markdown heading or null>", "category": "question|answer|career_story|company_fact|process|technical|challenge|reverse_question|caution|debrief_lesson|source", "priority": "primary|secondary|reference", "sourceType": "round_artifact|official|reported|career_evidence|generated_projection" }],
  "availableArtifactCount": 3,
  "expectedArtifactCount": 3
}
```

Keep each legacy list bounded to the most useful 6-10 items. Put every high-value prepared answer, company fact, process note, technical topic, challenge reference, reverse question, caution, and debrief lesson in `references`; do not truncate a useful answer with ellipses. `sourcePath` must exist, and `anchor` must exactly match a Markdown heading when present. Every item must be copied or faithfully condensed from its named source. When updating a source file, refresh its dashboard entries in the same write stage. Existing rounds without `dashboardBrief` remain valid because the app derives a read-only fallback from their files.

- Store new artifacts under `interviews/<NN>-<stage>/`. For new workspaces use `interviews/01-recruiter-hiring-manager/` and `interviews/02-technical/`.
- Round preparation creates `research.md`, `prep.md`, and `question_bank.md`. Technical challenge artifacts remain opt-in.
- Debrief analysis may add only `debrief_analysis.md` in the completed round.
- Text mock coaching may add numbered mock and feedback files in that round.
- Existing flat `interviews/research.md`, `prep.md`, and `question_bank.md` form a read-only legacy first round. Do not move, overwrite, or silently regenerate them.
- Create exactly one requested round or optional challenge artifact set. A reported future process step belongs in `knownProcess`; it does not authorize creating its folder or artifacts. Existing legacy rounds are read-only until the user explicitly requests migration.
- Do not modify submitted application artifacts, the JD, evaluation, match, or audits.

## Preparation Sources

After resolving one job:

1. Read only that job's JD, metadata, status, submitted application files, evaluation, match, interview index, and the active round's prior files.
2. Use `$jobsensei-career-evidence` with the selected context manifest. Preserve evidence IDs, source families, ownership, and current-versus-prior tense.
3. Read the matching generalized role-memory record only under the memory contract. Do not scan old jobs or transcripts.
4. Research the current company and requested stage when internet access is available:
   - Prefer official company, careers, engineering, product, and interview guidance.
   - Use no more than three public candidate-report sources.
   - Record title, URL, access date, and `official`, `reported`, or `inferred`.
   - Candidate reports are anecdotal and cannot establish candidate facts or guarantee a question.
   - Put the best official facts, reported process details, and likely stage-specific questions into `dashboardBrief.references` with `sourceType`, the local `research.md` path, and an exact heading anchor.
5. Update `status.json` history without deleting prior entries. Record only the requested round.

## Stage Distribution

The stage must control the question plan, not merely label it.

### Recruiter / Hiring Manager (Combined First Round)

- Create 14-18 primary questions in one bank, with hiring-manager questions first and recruiter questions clearly labeled as secondary within the same round.
- At least 60% must cover hiring-manager themes: ownership, judgment, ambiguity, customer challenges, collaboration, current-company scope, career progression, motivation, desired next role, and first-90-day thinking.
- Retain recruiter coverage for background, logistics, compensation, location, availability, authorization, and reason for leaving, but do not let logistics dominate the primary set.
- Include only 2-4 light technical verification questions. Keep deep architecture, coding, and challenge material under `Secondary / later-round preparation` until requested.

### Hiring Manager

- Create 12-16 primary questions.
- Prioritize ownership, judgment, ambiguity, customer challenges, cross-functional collaboration, project decisions, career goals, feedback, learning, and first-90-day thinking.
- Include moderate technical depth relevant to the role, but do not simulate a full technical loop.

### Technical

- Create 12-18 primary questions.
- Prioritize systems, agents, data, debugging, design tradeoffs, project depth, practical scenarios, validation, and failure handling.
- Retain concise motivation and collaboration checks without letting them dominate.

Technical challenge is an optional child of the technical round. When explicitly requested, create `interviews/02-technical/challenge/` with the same challenge brief, labs, answer keys, verbal scenarios, and evaluation information currently required by `$jobsensei-technical-challenge`. Do not create or imply challenge artifacts during ordinary technical preparation.

### Take-Home

Do not create a generic numbered question bank. Produce the expected evaluation rubric, constraints and assumptions, execution plan, validation checklist, submission explanation, self-review, and likely review questions. Never invent undisclosed exercise details.

### Onsite

Create 15-20 primary questions grouped by likely persona: technical, customer/cross-functional, behavioral, and leadership. Keep each inferred session explicitly uncertain unless confirmed.

### Executive And Unknown

- Executive preparation prioritizes company judgment, motivation, communication, values demonstrated through evidence, and strategic questions.
- `unknown` uses recruiter-screen preparation as primary and labels technical or later-stage material as secondary.

## Required Artifacts

`prep.md` must include:

- Requested round and target persona
- Natural 45-60 second career introduction
- Current-company and current-role explanation
- Why company, why role, why leaving, and what the candidate wants next
- Evidence-backed story map with truthful ownership
- Application claims to clarify, qualify, or avoid
- Gaps and transferability
- Portfolio or demonstration readiness when relevant
- Practical topics appropriate to the stage
- Five to eight stage-specific questions for the interviewer

`question_bank.md` must use these exact sections:

- `## Primary for this round`
- `## Likely follow-ups`
- `## Secondary / later-round preparation`
- `## Questions to ask`

Every primary question must contain:

1. `Testing`
2. `Direct answer (30-45 seconds)`: a complete first-person spoken answer
3. `Expanded answer (60-90 seconds)`: a complete deeper answer
4. `Likely follow-up probes`
5. `Evidence`: selected evidence IDs and source paths
6. `Scope / truthfulness caution`

Behavioral answers may run up to two minutes and use STAR only when the evidence supports Situation, Task, Action, and Result. Answer the question before background. Do not force metrics.

Use `proof of concept`, `production`, `contributed`, `led`, `customer enablement`, and `full account ownership` precisely. Unknown preferences or logistics must be marked for user confirmation, never filled in.

## Debrief Mode

A prompt such as `<Company> debrief` analyzes the latest completed or current round; it does not prepare a new round.

1. Resolve raw sources under `data/debrief/<company>/` and link their relative paths in the round record. Never copy, edit, or relocate them.
2. Treat the transcript as the primary performance record and generated summaries as secondary. Record conflicts, uncertain transcription, and missing context.
3. Create `debrief_analysis.md` containing:
   - Actual questions and meaningful follow-up chains
   - Concise answer summaries
   - What worked
   - Weak, unclear, incomplete, or overstated answers
   - Questions the preparation missed
   - Interviewer signals without inferring pass/fail
   - Process and next steps with source classification
   - Changes recommended for the next confirmed round
4. Interview statements are performance context, not career evidence. Corroborate any new factual claim against selected career evidence before reuse.
5. Mark the round `debriefed`. Add reported future rounds to `knownProcess` with `sourceType: reported_by_interviewer`, but do not create them.
6. Update only the matching generalized role-memory record. Store reusable patterns, not transcript text, employer details, compensation, or confidential material.

## Stop Conditions

- Stop after preparing the requested round.
- Stop after debrief analysis when the prompt is a debrief.
- Start a mock only when the user explicitly asks to practice or start a mock.
- Never infer interview success or advance the job based only on positive interviewer language.
