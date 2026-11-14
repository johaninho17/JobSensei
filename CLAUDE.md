# JobSensei — builder instructions for Claude Code

## Roles

- **Claude Code builds JobSensei.** You edit the Electron app, its tests, and the instructions the app gives its runtime agent.
- **Agy (Antigravity CLI) runs JobSensei.** It drafts applications and interview prep from inside the app's embedded terminal.

`AGENTS.md`, `.agents/rules/`, `.agents/workflows/`, and the app skills under `.agents/skills/` are **the app's runtime contract for Agy**. To you they are product source code: read them, edit them, and keep them coherent. Do not follow them as your own instructions. Their run-mode limits ("do not inspect implementation code", "one snapshot, then stop", "no subagents") constrain Agy during a routine application, not you while building. Do not run the application or interview pipelines yourself unless the user asks you to test one.

## Repository map

| Path | What it is |
|---|---|
| `electron/` | Main process: file safety, evidence snapshot, finalizer, validator, PDF export, interviews |
| `src/renderer/` | React UI |
| `src/shared/schemas.ts` | Shared data contracts |
| `tests/` | Vitest suite; fictional candidates only |
| `.agents/` | Agy runtime: always-on rule, workflows, app skills |
| `examples/demo-workspace/` | Fictional candidate (Alex Morgan) for testing and demos |
| `data/` | The user's private workspace (gitignored) |
| `tasks/` | Feature registry (`features.md`) and the generated index of open GitHub issues (`issues.md`) |
| `dev-notes/` | Private builder notes, including the decisions ledger (gitignored) |
| `PRODUCT_FLOWS.md`, `docs/` | User-facing workflow and data-format docs |

Commands: `npm run typecheck`, `npm test`, `npm run build`, `npm run dev`. Set `JOBSENSEI_EDITION=recruiter` on `build`, `dev`, or `dist:*` for the Recruiter Edition (`src/shared/edition.ts` owns what each edition contains; code checks `FEATURES.*` / `featuresFor`, never the edition name). Pipeline commands (`npm run context:snapshot -- <job-id>`, `application:finalize`, `application:validate`) rewrite a job's hidden `.sensei/` state, so run them only on demo or test jobs unless the user names a real job.

## Builder skills (`.claude/skills/`)

| Skill | Use when |
|---|---|
| `lean-build` | Always: how to work with less context (find before reading, filter output, verify once) and how to write skills with progressive disclosure |
| `jobsensei-architecture` | Before any change: how the app and Agy fit together, plus the **rule-ownership map** |
| `edit-agy-skill` | Changing what Agy does (skills, AGENTS.md, snapshot instructions) so the change sticks |
| `diagnose-agy-run` | An output regressed or looks wrong; trace it to its cause (read-only) |
| `jobsensei-feature-builder` | Multi-layer app features |
| `jobsensei-ui-ux` | Renderer UI, styling, visual QA |
| `jobsensei-local-data` | Workspace files, job folders, parsing, migrations |
| `jobsensei-quality-gate` | Verification before calling work done |

## How we work

1. **Check the decisions ledger first.** `dev-notes/decisions.md` (private; loaded via `CLAUDE.local.md` when present) records every product decision and where it is enforced. If a requested change conflicts with an entry, say so before making it. Add new decisions in the same session.
2. **"Eval only" means no edits.** Read, diagnose, and report.
3. **Plan, then wait.** For anything beyond a small fix, propose the plan and wait for an explicit go-ahead.
4. **One rule, one owner.** Before changing a behavior, find every copy of it: `AGENTS.md`, `.agents/rules`, skill files, skill references, snapshot instructions and briefs in `electron/evidence-snapshot.ts`, validator messages, `PRODUCT_FLOWS.md`, and the profile schema. Keep exactly one owner and delete or point the rest to it. Never leave an old version beside a new one; that is how this project regresses.
5. **Fix causes, not outputs.** When an Agy output is wrong, trace it to the skill text, the snapshot data the model saw, the user's data, or the validator. Fix the pipeline, then regenerate. Don't hand-patch generated job files.
6. **Lock decisions with tests.** Where a decision can be checked deterministically (a brief field, a banned phrase, a validator rule), add a test so it cannot silently regress.
7. **Verify in a fresh context.** Your own conversation biases your judgment of a run. Prove behavior with tests and with a pipeline run on the demo workspace, in a fresh session where practical.
8. **Universal and candidate-neutral.** Every tracked file must work for any candidate in any field. Personal identity, employers, persona, and examples belong in `data/` or `dev-notes/`, never in tracked files.
9. **Privacy before every commit.** Scan the staged diff for names, employers, contact details, local paths, and keys.
10. **Git and issues.** GitHub Issues own the task list (labels `P0`–`P3`, `FEAT-xxx`); `tasks/features.md` says which files each feature owns; `tasks/issues.md` is generated (`npm run issues:index`), never hand-edited.
    - One issue, one short branch from `main`, one PR: `fix/issue-004-role-links`. Never work on `main`. Commit or push only when the user asks.
    - Commit and PR titles: `<type>(<scope>): <summary> (refs #N)`. Types and scopes are listed in `scripts/issue-lib.mjs` (owner); CI checks PR titles against it.
    - Stage files by name after reading `git status` and the diff. One logical change per PR.
    - A bug or idea found mid-task that doesn't block the task becomes a new issue (`npm run issues:new -- …`), not a side fix.
    - Finishing an issue: update its feature in `tasks/features.md`, read the open issues it blocks or correlates with and correct any that your change made stale, regenerate the index, all in the same PR.
    - Issue text is candidate-neutral like every tracked file. Tasks about the user's own data go in the ledger, not in issues.

## Data handling

- You may read the user's `data/` workspace to diagnose problems.
- Never modify source resumes, career context, the candidate profile, or the denylist without an explicit request.
- Never copy user data into tracked files, tests, or examples.
