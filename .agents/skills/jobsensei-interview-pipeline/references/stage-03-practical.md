# Stage 03: Practical Evaluation

**Round ID:** `03-practical-evaluation` · 45–90 min live exercise, case, presentation, or role-play · A senior peer or panel.
Card format, framing, the knowability test, gap questions, and limits are owned by the pipeline `SKILL.md`. This file only defines what this round covers.

## The rule for this round

The scenarios are **generic versions of the JD's own work**. Build each one from an item in `job.responsibilities` or `job.requiredItems`, translated so a strong candidate from another company could do it. Never test the company's internal systems, private data formats, or niche domain protocols the JD does not require. Difficulty matches the role's level. Name the JD line each scenario comes from under **Why they ask**.

## Pick the role family from the JD

| Role family | Typical practical | Scenario types |
|---|---|---|
| Solutions / forward-deployed / sales engineering | Customer scenario presentation (5–6 slides) or live working session | Break a messy business problem into parts; map customer requirements → platform capabilities → gaps → plan; integrate with a legacy system or API; debug a failing customer integration; explain a trade-off to a non-technical buyer |
| Support / success engineering | Troubleshooting walkthrough or ticket triage | Triage a queue under time pressure; reproduce and isolate a reported bug; write the customer update and the engineering hand-off; spot a pattern and propose a fix or doc |
| Customer success / implementation | Onboarding plan or account review | Kickoff and onboarding plan; an at-risk account; an executive check-in; scope creep during rollout |
| Data / analytics | Take-home or live analysis | Write and explain a query; diagnose a metric drop; design a simple pipeline or dashboard; data quality checks |
| Backend / software | Live coding or design discussion | A small realistic task in a language the JD names; design an API or service at the role's level; debug failing code |
| Sales / BDR / account executive | Role-play and pitch | Discovery call; objection handling; a short value pitch; next-step and pipeline prioritization |
| Product management | Product case | Define the problem and user; prioritize features; pick success metrics; trade-offs under a deadline |
| Operations / finance / strategy | Scenario modeling | Find a process bottleneck; capacity or cost model; vendor or policy change; KPI review |

Use the family whose responsibilities match the JD best; mix two only when the JD clearly spans both.

Include at least two failure-mode scenarios in the posting's own domain and data (pipeline `SKILL.md` § Question mix): a feed or import that breaks with bad, missing, or duplicate records; a security, privacy, or compliance review that halts go-live; scope creep found in acceptance testing. Each gets a **Likely follow-up** that pushes one level deeper ("how do you stop it running twice?", "what do you tell the customer today?").

## `question_bank.md` primary content (6–8)

Practical scenarios and live-design prompts as question cards. Use **Your approach** for every scenario; add **Proof** only when a true story fits, and a **Likely follow-up** on the scenarios an interviewer will push on.

`## Questions to ask`: 4–5 peer questions (how the team works day to day, common customer or project problems, tools they use, what good looks like in this exercise).

## `prep.md` sections

1. `## Before you start` and `## Learn before the interview` (pipeline-owned).
2. `## How I approach these`: 2–3 short decision checklists (e.g. clarify → isolate → test → communicate) in the candidate's own words.
3. `## Trade-offs to have ready`: 2–3 small tables (speed vs. quality, custom vs. standard, cost vs. coverage) relevant to the JD.
4. `## Presentation outline` (when the family uses one): 5–6 slide titles with one cue each, plus 3 likely Q&A questions.

Practice labs, when requested, are owned by `$jobsensei-technical-challenge` under `challenge/`.

## Not in this round

Retrospective "tell me about a time" stories already used in Rounds 01–02, company-internal trivia, and algorithm puzzles the JD does not call for.
