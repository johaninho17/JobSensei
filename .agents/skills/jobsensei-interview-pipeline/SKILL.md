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
   - `practical_evaluation` (or `technical`)
   - `final_panel` (or `team_panel` / `team panel` / `panel` / `onsite` / `executive`)
   - `take_home`
   - `unknown`
6. For interview preparation creation, use the isolated canonical 4-stage layout:
   - `01-recruiter-screen/`: Non-technical 15–20 min Talent Acquisition screen. Bounded strictly to 6–8 questions covering background arc, motivation, role fit, checklist qualifications, logistics (location, comp, authorization, timeline), and reverse questions. Zero low-level architecture or debugging scenarios.
   - `02-hiring-manager/`: 30–45 min manager screen. Bounded strictly to 8–10 questions covering end-to-end ownership, cross-functional collaboration, navigating ambiguity, and 30-60-90 day thinking.
   - `03-practical-evaluation/` (or `03-technical/`): 45–60 min assessment. Role-aware: "Role-Play & Pitch Simulation" for BDR/Sales; "Technical & System Design" for Engineering; "Product Sense & Case Study" for PM; "Scenario Modeling" for Ops. Bounded to 6–8 practical scenarios.
   - `04-final-panel/`: 30–45 min leadership round. Bounded to 6–8 strategic questions covering mission alignment, culture fit, and executive reverse questions.
7. An initial recruiter screen prompt creates or updates only `01-recruiter-screen`. An explicit hiring-manager prompt creates or updates `02-hiring-manager`. An explicit practical or technical prompt creates or updates `03-practical-evaluation` (or `03-technical`). An explicit team panel, final panel, executive, or onsite prompt creates or updates `04-final-panel`. Technical challenge material remains opt-in under `challenge/`.

## Round Storage Contract

Use `data/jobs/<job-id>/interviews/interview.json` as the job-level index:

```json
{
  "schemaVersion": 2,
  "jobId": "<job-id>",
  "company": "<display company>",
  "role": "<display role>",
  "currentRoundId": "01-recruiter-screen",
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

- Store new artifacts under canonical folders: `01-recruiter-screen/`, `02-hiring-manager/`, `03-practical-evaluation/`, and `04-final-panel/`.
- **Shared Company Research Contract:**
  - Company-wide background (mission, leadership, funding, core products, customer logos, market category) is researched once and saved to `interviews/company_research.md`.
  - Round folders must NEVER duplicate identical company research files. A round-level `research.md` is strictly optional and only created when there is specific intel on the interviewer persona or unique evaluation rubric.
  - In `interview.json`, `artifactPaths.research` defaults to `jobs/<job-id>/interviews/company_research.md`.
- **Dedicated Stage Specifications:**
  - When preparing a round, the pipeline MUST load and strictly adhere to the dedicated stage specification in `references/`:
    - `01-recruiter-screen`: Follows `references/stage-01-recruiter.md` (The 1-Page Recruiter Battlecard).
    - `02-hiring-manager`: Follows `references/stage-02-hiring-manager.md` (The Managerial Ownership & Decision Playbook).
    - `03-practical-evaluation`: Follows `references/stage-03-practical.md` (The Live Diagnostic & Execution Framework).
    - `04-final-panel`: Follows `references/stage-04-final-panel.md` (The Strategic Vision & Culture Alignment Guide).
- **Strict Story Partitioning & Zero Cannibalization:** Never duplicate the same stories, anecdotes, or reverse questions across multiple rounds:
  - *Recruiter Screen:* High-level trajectory arc, checklist stack verification, and compensation/location logistics. Zero deep architecture monologues.
  - *Hiring Manager:* Ownership under ambiguity, handling customer/stakeholder pushback, prioritization under tight deadlines, and 30-60-90 day impact.
  - *Practical Evaluation / Technical:* Live problem-solving, trade-off analysis, domain frameworks, and live simulations. Focus on real-time execution rather than retrospective story monologues.
  - *Final Panel:* Strategic market alignment, executive vision, culture add, and high-impact macro business outcomes.
- Round preparation creates stage-specific `prep.md` and `question_bank.md` tailored to that round's archetype. Technical challenge artifacts remain opt-in under `challenge/`.
- Debrief analysis may add only `debrief_analysis.md` in the completed round.
- Text mock coaching may add numbered mock and feedback files in that round.
- Existing flat `interviews/research.md`, `prep.md`, and `question_bank.md` form a read-only legacy first round. Do not move, overwrite, or silently regenerate them.
- Create exactly one requested round or optional challenge artifact set. A reported future process step belongs in `knownProcess`; it does not authorize creating its folder or artifacts. Existing legacy rounds are read-only until the user explicitly requests migration.
- Do not modify submitted application artifacts, the JD, evaluation, match, or audits.

## Preparation Sources

After resolving one job:

1. Read that job's JD, metadata, status, submitted application files, evaluation, match, interview index, and the **files of all preceding rounds** (`prep.md`, `question_bank.md`) as well as the active round's prior files:
   - Build an explicit **Non-Overlap / Exclusion Boundary**: Inspect the questions, anecdotes, past project examples, and reverse questions from all preceding rounds (`01-`, `02-`, etc.).
   - Strictly prohibit re-asking questions, recycling career anecdotes, or reusing reverse questions in the current round.
   - For `03-practical-evaluation`, enforce first-principles scenarios and live problem-solving; never re-tell Round 02 retrospective stories.
2. Use `$jobsensei-career-evidence` with the selected context manifest. Preserve evidence IDs, source families, ownership, and current-versus-prior tense.
3. Read the matching generalized role-memory record only under the memory contract. Do not scan old jobs or transcripts.
4. Research the current company and requested stage when internet access is available:
   - Perform general company research once and save to `interviews/company_research.md`.
   - Prefer official company, careers, engineering, product, and interview guidance.
   - Use no more than three public candidate-report sources.
   - Record title, URL, access date, and `official`, `reported`, or `inferred`.
   - Candidate reports are anecdotal and cannot establish candidate facts or guarantee a question.
   - Put the best official facts, reported process details, and likely stage-specific questions into `dashboardBrief.references` with `sourceType`, the local `company_research.md` (or round `research.md`) path, and an exact heading anchor.
5. Update `status.json` history without deleting prior entries. Record only the requested round.

## Stage Distribution & Universal Multi-Disciplinary Standards

The stage and target discipline must strictly control the artifact structure, questions, and preparation focus.

**Zero Fabricated Incidents / Zero Hallucinated Drama:**
- Never invent customer names, partner crises, production outages, port collisions, or imaginary incidents out of local development notes or fragments.
- For behavioral questions, provide **generalizable decision frameworks and operating philosophy** anchored in the candidate's real, verified evidence from `data/context/`.

**Universal Role Mapping Across Disciplines:**
- *Engineering / Technical:* "Technical & System Design" — first-principles architecture, data flow, telemetry/metrics, debugging trees, and live code walkthroughs.
- *Sales / BDR / Account Executive:* "Role-Play & Pitch Simulation" — mock cold outreach, discovery questioning (MEDDPICC/BANT), objection handling, deal stage progression, and pricing negotiation.
- *Product Management:* "Product Sense & Case Study" — user personas, problem definition, North Star metrics, feature prioritization (RICE), and trade-off matrices.
- *Operations / Strategy / Finance:* "Operational Scenario & Case Modeling" — process bottlenecks, capacity planning, unit economics, supply chain modeling, and KPI dashboards.
- *Customer Success / Implementation:* "Client Onboarding & Escalation Simulation" — technical kickoff walkthroughs, churn risk diagnosis, QBR presentations, and SLA recovery.

### Modular Stage Specifications:
For each round, follow the dedicated specification module in `references/`:
1. `01-recruiter-screen`: Read and follow `references/stage-01-recruiter.md`. (15–20 min non-technical filter, 1-page battlecard, logistics matrix, checkboxes).
2. `02-hiring-manager`: Read and follow `references/stage-02-hiring-manager.md`. (30–45 min manager screen, ownership & decision playbooks, generalizable mental models, truthful anchors).
3. `03-practical-evaluation`: Read and follow `references/stage-03-practical.md`. (45–60 min assessment, diagnostic decision trees, trade-off matrices, first-principles architectures).
4. `04-final-panel`: Read and follow `references/stage-04-final-panel.md`. (30–45 min leadership round, strategic vision, culture alignment, intellectual humility).

### Take-Home & Unknown
- Take-Home produces the expected evaluation rubric, constraints and assumptions, execution plan, validation checklist, submission explanation, self-review, and likely review questions.
- `unknown` uses recruiter-screen preparation as primary and labels later-stage material as secondary.

`question_bank.md` must use these exact top-level sections:

- `## Primary for this round`
- `## Likely follow-ups`
- `## Secondary / later-round preparation`
- `## Questions to ask`

### Standardized Question Bank Contract (Glanceable Framework Cues)

Never produce full-prose conversational monologues, scripted pitches, answers in quotation marks, or rigid `Situation / Context -> Action & Mechanism -> Result & Impact` bullet scripts. Every primary and follow-up question must be formatted as clean, glanceable bullet cues that candidates use as 3-second memory triggers while speaking naturally in their own authentic voice:

Every question under `## Primary for this round` must follow this structure:

```markdown
### Question <N>: <Question Text>?

* **Core Takeaway:**
  - <1-2 punchy lines delivering the bottom-line answer (scannable in 3 seconds)>
* **Interviewer Intent:**
  - <What the interviewer is actually testing: systematic deconstruction, ownership, trade-off awareness>
* **Generalizable Framework (Mental Model):**
  - <Step 1: Deconstruct / Isolate / Clarify>
  - <Step 2: Validate / Minimal Reproduction / Concrete Action>
  - <Step 3: Communicate / Collaborate / Deliver>
* **Truthful Career Anchor:**
  - <Ground in verified evidence from data/context/ without inflating scope or inventing fake customer drama>
* **Glanceable Talking Cues:**
  - <Punchy 1-line talking trigger 1>
  - <Punchy 1-line talking trigger 2>
  - <Punchy 1-line talking trigger 3>
* **Truth Boundary & Cautions:**
  - <1 concise line clarifying scope boundaries or key logistical facts>
```

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
