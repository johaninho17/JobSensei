---
name: jobsensei-feature-builder
description: Build or modify a JobSensei product feature end to end across the React renderer, Electron main process, preload bridge, shared schemas, and tests. Use for new screens, workflows, settings, job/interview views, context management, or any change spanning several layers.
---

# JobSensei feature builder

Build vertical slices that work end to end and keep JobSensei local-first.

## Start from repository truth
1. Load `jobsensei-architecture` and check the rows of `dev-notes/decisions.md` that touch the change (find them in its index).
2. Inspect the current source and `package.json` scripts. Plans in local notes are intent, not current API documentation.
3. Check `git status` and preserve unrelated changes.
4. State the user-visible outcome, the data contracts affected, and how you'll verify it before editing. For anything non-trivial, get the user's go-ahead on that plan.

Read [references/feature-workflow.md](references/feature-workflow.md) for layer boundaries and the definition of done.

## Route specialized work
- Screens, layout, styling, accessibility → `jobsensei-ui-ux`
- Workspace files, job folders, parsing, migrations → `jobsensei-local-data`
- Changing what Agy does → `edit-agy-skill`
- Finish meaningful changes with `jobsensei-quality-gate`

## Implement a vertical slice
1. Update the shared schema first (`src/shared/schemas.ts`, `contracts.ts`).
2. Write deterministic logic in `electron/` before any prompt or skill change.
3. Expose the smallest typed API through `electron/preload.ts`. React never touches the filesystem.
4. Build all UI states: empty, loading, success, partial, error, retry.
5. Persist only after validation succeeds; keep the last valid artifact on failure.
6. Add proportionate Vitest tests with fictional fixtures.
7. Run the real flow (`npm run dev`) and inspect the visible result.

## Control scope
- Implement the requested feature, not nearby roadmap items.
- No new abstraction without a second real consumer.
- Don't swap libraries or architecture without evidence and an explicit decision.
- AI generation stays with Agy and is always user-triggered; the app itself calls no hosted AI provider.
- Keep existing job folders readable (backward compatibility).

Report the outcome, the tests run, the visual checks done, and any remaining limitation. Don't claim completion if a layer is stubbed or unverified.
