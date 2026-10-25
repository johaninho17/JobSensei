---
name: jobsensei-technical-challenge
description: Create hands-on, job-tailored coding labs and verbal scenarios for an existing JobSensei job only when the user explicitly mentions a technical challenge, coding test, live exercise, implementation walkthrough, case study, or take-home practice.
---

# JobSensei Technical Challenge

Prepare the user to perform work under interview conditions. This skill is separate from ordinary technical interview Q&A and must not alter application artifacts or existing interview preparation.

## Activation Firewall

Activate only for explicit assessment language such as:

- `<company> technical challenge`
- `<company> coding test`
- `<company> take-home practice`
- `<company> live implementation walkthrough`
- `<company> debugging exercise`

Do not activate for a pasted JD, application generation, `<company> interview`, or `<company> technical interview`. Those remain owned by the existing application and interview skills.

Resolve exactly one existing job workspace by the `AGENTS.md` job rule (a `(job: <job-id>)` in the prompt wins). Never create a job from a challenge prompt and never inspect sibling job artifacts.

## Source Order

1. Actual challenge prompt supplied by the user
2. Interviewer-reported process in `interviews/interview.json` or linked debrief analysis
3. Official company guidance
4. The job description and submitted application
5. Selected career evidence for truthful verbal answers
6. Candidate reports, clearly labeled anecdotal

Never claim a practice exercise is the employer's real assessment unless the actual prompt says so. Never turn interview answers or generated solutions into career evidence.

## Assessment Mode

Classify the request as `live_coding`, `debugging`, `implementation_walkthrough`, `system_design`, `take_home`, `case_study`, `mixed`, or `unknown`.

Technical challenges are distinct from the `technical` interview stage. Use `technical_challenge` for live tests and implementation assessments. Preserve a confirmed `take_home` stage when the user explicitly describes work completed outside the interview.

## Storage Contract

Create or attach one requested round under:

`data/jobs/<job-id>/interviews/03-practical-evaluation/challenge/` (or active practical/technical stage)

Create only:

- `challenge_brief.md`
- `practice_labs.json`
- `challenge.json`

Update `interviews/interview.json` only to register the requested round and these artifact paths. Do not modify existing resume, cover letter, evaluation, question bank, prep, mock, or debrief files.

Never write `dashboardBrief`. After writing the files, run `npm --prefix "$JOBSENSEI_APP_ROOT" run interview:check -- <job-id> <round-id>` once; it validates the labs and registers them, and the app builds the dashboard from the files.

`challenge.json` records schema version, job ID, round ID, assessment mode, known timebox, allowed tools, confirmed constraints, source basis, whether the real prompt was supplied, artifact paths, and unresolved unknowns.

## Practice Contract

Write `practice_labs.json` against the app's `challengePracticeSchema`. Create 3-6 exercises unless the user requests another count. Include both coding/implementation labs and verbal scenarios when the format is mixed or unknown.

The knowability test and framing rules in the interview pipeline `SKILL.md` apply to every exercise. Build each exercise from a JD responsibility or required item, as a generic version of that task a strong outside candidate could do. Use standard skills the JD names (a query, an API call, parsing JSON, debugging a failing request, a runbook, a customer plan); never the company's private systems, proprietary data formats, or niche protocols the JD does not require. The company name appears only in `jobRelevance`, never in `prompt`.

Every exercise requires:

- `jdRequirement`: the JD line it tests
- `knowableFrom`: `"general craft"` or `"public docs: <url>"`

- Stable ID, type, title, difficulty, and realistic timebox
- Job relevance
- Complete prompt
- Starter context when useful
- Requirements and expected output
- Acceptance tests for coding exercises
- One to three progressive hints
- A hidden solution and explanation
- Common mistakes and likely follow-up probes
- Evaluation criteria and a points-based self-scoring rubric

`sourceBasis: "reported_process"` requires at least one URL in `sources`; otherwise use `job_derived`.

Coding work should resemble realistic role tasks rather than difficult algorithm trivia unless the supplied assessment explicitly emphasizes algorithms. Verbal scenarios need a short approach (steps, not a script) grounded in selected evidence, an answer-duration target inside the prompt or starter context, and truthfulness cautions.

## Boundaries

- Do not solve or submit the employer's active assessment as the user's independent work.
- When an actual prompt is supplied, create analogous practice, a plan, review criteria, and coaching unless the user explicitly requests permitted assistance.
- Do not invent assessment details, tools, time limits, company systems, or evaluation criteria.
- Do not create later interview rounds.
- Stop after the three challenge artifacts and interview-index update.
