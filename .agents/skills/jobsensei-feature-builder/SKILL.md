---
name: jobsensei-feature-builder
description: Build or modify complete JobSensei product features across the React UI, local Node backend, shared contracts, and tests. Use for implementing screens, workflows, settings, job history, context management, application pipeline controls, or any change spanning multiple JobSensei layers.
---

# JobSensei Feature Builder

Build vertical slices that work end to end and preserve JobSensei's local-first guarantees.

## Start with repository truth

1. Read `AGENTS.md`.
2. Read the relevant sections of `implementation_plan.md`; treat it as intent, not infallible current API documentation.
3. Inspect the current source tree and package scripts. Prefer implemented conventions over speculative paths in the plan.
4. Check the working tree and preserve unrelated user changes.
5. Define the user-visible outcome, affected data contracts, and verification before editing.

Read [references/feature-workflow.md](references/feature-workflow.md) for layer boundaries and the definition of done.

## Route specialized work

- Use `$jobsensei-ui-ux` for screens, interactions, layout, accessibility, or styling.
- Use `$jobsensei-adk-typescript` for Gemini, ADK, prompts, agent state, tool use, or AI output.
- Use `$jobsensei-local-data` for career files, job folders, SQLite, ingestion, persistence, or migrations.
- Finish meaningful changes with `$jobsensei-quality-gate`.

## Implement a vertical slice

1. Define or update the shared schema first.
2. Implement deterministic domain logic before adding model behavior.
3. Implement the backend or service boundary.
4. Expose the smallest typed browser-facing API.
5. Build the UI states: empty, loading, success, partial, error, rate-limited, and retry.
6. Persist only after validation succeeds.
7. Add proportionate automated tests.
8. Exercise the real user flow and inspect its visible result.

Keep secrets and filesystem primitives out of React. Keep canonical career and job artifacts in folders; use SQLite only as a rebuildable index.

## Control scope

- Implement the requested feature, not nearby roadmap items.
- Avoid introducing abstractions without a second concrete consumer.
- Do not replace chosen libraries or architecture without evidence and an explicit decision.
- Do not silently consume Gemini quota. Make generation user-triggered and show progress.
- Preserve backward compatibility for saved job folders whenever feasible.

## Complete the task

Report the outcome, tests run, visual checks performed, and any remaining limitation. Do not claim completion when a required layer is stubbed or unverified.
