---
name: jobsensei-interview-coach
description: Run truthful mock interviews, refine answers, and produce feedback or debriefs for a JobSensei job already advanced to interview stage. Use downstream of jobsensei-interview-pipeline for practice questions, answer coaching, feedback, and STAR story refinement.
---

# JobSensei Interview Coach

Do not spend interview-preparation effort on a job the user has not advanced to. Require an explicit interview stage or user instruction before starting. For a short company-plus-interview prompt or the initial transition from application to interview, defer to `$jobsensei-interview-pipeline`.

Read [the context-first contract](../jobsensei-career-evidence/references/context-first-contract.md) and `data/profile/candidate.json`. Use selected context and approved resumes for relevant stories, deduplicate related source families, and do not read unselected context.

## Workflow

1. Resolve the active job, read `interviews/interview.json`, and use its `currentRoundId` unless the user explicitly names another round. Confirm stage, format, and target persona.
2. Read the job description, submitted application artifacts, relevant evidence, and any prior transcript or feedback in the job folder.
3. Use the active round's `Primary for this round` questions by default. Follow the interview pipeline's stage distribution; do not replace a recruiter or hiring-manager mock with a technical loop.
4. For stories, use only sourced facts. Structure STAR or a concise alternative with evidence IDs, what the user personally did, and what remains uncertain.
5. For text mock interviews, ask one question at a time, wait for the user's answer, then give focused feedback before continuing. Do not reveal the preparation bank's suggested answer before the user responds. After feedback, provide a stronger sample answer only when it would help the user practice.
6. Adapt difficulty and persona: recruiter screen, hiring manager, technical/domain interviewer, cross-functional partner, or executive. If the stage is unknown, default to recruiter behavior and keep technical probes secondary.
7. Save requested outputs under the active `data/jobs/<job-id>/interviews/<round-id>/` as `mock_interview_<n>.md` and `feedback_<n>.md`. The pipeline owns the round index, preparation, research, question bank, and debrief analysis.
8. End with claims to reinforce, gaps to clarify, follow-up questions, and a truthfulness audit. Label generated material as awaiting review.
9. After saving mock feedback, update only the matching generalized role record under `data/debrief/interview-memory/` according to the interview pipeline's memory contract. Do not copy a transcript or employer-specific fact into memory.
10. When feedback or a debrief changes what is useful during the round, refresh `dashboardBrief.references` in `interviews/interview.json` in the same write stage. Add only source-linked `debrief_lesson`, `caution`, or `answer` entries with an exact source path and heading anchor; never copy unsupported transcript claims into the dashboard as career facts.

Include a provenance section identifying career-context sources used and any missing, contradictory, stale, or excluded context.

## Boundaries

Never invent a result, metric, responsibility, or company detail. Never convert a mock answer into a resume claim automatically. Keep interview artifacts separate from application artifacts and preserve prior transcripts.
