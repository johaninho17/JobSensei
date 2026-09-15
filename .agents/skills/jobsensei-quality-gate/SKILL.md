---
name: jobsensei-quality-gate
description: Verify JobSensei changes before completion or release. Use after implementing features, AI behavior, UI, persistence, document processing, migrations, or bug fixes; also use for test planning, regression review, truthfulness audits, accessibility checks, visual QA, and agent evaluation.
---

# JobSensei Quality Gate

Apply risk-based verification across code, local data, AI behavior, and the visible user experience.

## Build the verification matrix

1. Read `AGENTS.md`.
2. Inspect the actual diff and identify affected surfaces.
3. Map each material risk to evidence that would catch it.
4. Run the smallest decisive checks first, then broader regression checks.
5. Never hide failures or substitute unrelated passing tests.

Read [references/verification-matrix.md](references/verification-matrix.md) to select required checks.

## Separate deterministic and model quality

Use automated tests for:

- Types and schemas
- Pure transformations
- Tool contracts
- API or IPC boundaries
- Persistence and migrations
- Caching, quotas, and retries
- Security invariants

Use evaluation cases for:

- Career-claim grounding
- Job-match relevance
- Resume integrity
- Interview follow-up quality
- Tool selection
- Refusal to invent evidence

Do not assert exact wording from model output. Evaluate structured properties and rubric-based behavior.

## Verify the real experience

- Run changed user flows through the actual UI.
- Inspect loading, error, partial, offline, and rate-limit states.
- Check keyboard navigation and accessible labels.
- Inspect long job titles, long reports, and narrow windows.
- Confirm restart persistence for saved artifacts.
- Confirm failed generation does not destroy the last valid result.

## Report honestly

List commands and evaluations run, results, skipped checks with reasons, and residual risks. Do not mark the task complete when a required verification step cannot run.
