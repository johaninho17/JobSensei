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

Resolve exactly one existing job workspace using the active Sensei selection or that job's `.sensei/job.json`. Never create a job from a challenge prompt and never inspect sibling job artifacts.

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

`data/jobs/<job-id>/interviews/02-technical/challenge/`

Create only:

- `challenge_brief.md`
- `practice_labs.json`
- `challenge.json`

Update `interviews/interview.json` only to register the requested round and these artifact paths. Do not modify existing resume, cover letter, evaluation, question bank, prep, mock, or debrief files.

Refresh the technical round's `dashboardBrief.technicalTopics`, readiness counts, and `references` in the same write stage. Add each lab and verbal scenario as a `challenge` reference with its real source path, stable exercise ID or exact heading anchor, full prompt summary, and `primary` or `secondary` priority. Keep the challenge files authoritative; dashboard references navigate to them and must not replace prompts, tests, hints, answers, or scoring details.

`challenge.json` records schema version, job ID, round ID, assessment mode, known timebox, allowed tools, confirmed constraints, source basis, whether the real prompt was supplied, artifact paths, and unresolved unknowns.

## Practice Contract

Write `practice_labs.json` against the app's `challengePracticeSchema`. Create 3-6 exercises unless the user requests another count. Include both coding/implementation labs and verbal scenarios when the format is mixed or unknown.

Every exercise requires:

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

Coding work should resemble realistic role tasks rather than difficult algorithm trivia unless the supplied assessment explicitly emphasizes algorithms. Verbal scenarios need a direct sample answer grounded in selected evidence, an answer-duration target inside the prompt or starter context, and truthfulness cautions.

## Boundaries

- Do not solve or submit the employer's active assessment as the user's independent work.
- When an actual prompt is supplied, create analogous practice, a plan, review criteria, and coaching unless the user explicitly requests permitted assistance.
- Do not invent assessment details, tools, time limits, company systems, or evaluation criteria.
- Do not create later interview rounds.
- Stop after the three challenge artifacts and interview-index update.
