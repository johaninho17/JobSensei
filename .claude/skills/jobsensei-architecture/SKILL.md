---
name: jobsensei-architecture
description: How JobSensei is built and how its runtime agent (Agy) is wired in. Load before any change to the app, its Agy skills, AGENTS.md, the evidence snapshot, the finalizer or validator, or when diagnosing why Agy produced a given output. Includes the rule-ownership map showing which file controls each product behavior.
---

# JobSensei architecture (builder's view)

JobSensei is an Electron desktop app. Agy, an external CLI agent, does all AI generation inside the app's embedded terminal. The app does the deterministic work around it: file safety, evidence routing, protected resume composition, scoring, validation, PDF export, and dashboards.

## Two layers, two audiences

| Layer | Lives in | Audience |
|---|---|---|
| App code | `electron/`, `src/`, `tests/` | Claude (builder) |
| Agy runtime contract | `AGENTS.md`, `.agents/rules/`, `.agents/workflows/`, `.agents/skills/` | Agy at run time; Claude edits it as source |
| Builder instructions | `CLAUDE.md`, `.claude/skills/` | Claude only; never shipped to users |
| User workspace | `data/` (dev) or `~/Documents/JobSensei` (packaged) | Private; gitignored |

**Where Agy actually reads its skills.** The terminal starts in the workspace root (`electron/main.ts`, `terminal:start`). `electron/workspace-init.ts` seeds `<workspace>/.agents/skills` and `<workspace>/AGENTS.md` from the repo (or packaged resources), **only when they don't already exist**. A repo-side skill edit may therefore never reach in-app Agy runs. Always check which copy the run used (see `diagnose-agy-run`).

## Application pipeline (pasted JD → drafts)

1. Agy screens the JD (`.agents/skills/jobsensei-application-pipeline`) and writes `jobs/<id>/original_jd.md`.
2. `npm run context:snapshot -- <id>` → `electron/evidence-snapshot.ts`:
   - reads the active manifest (`electron/context.ts`), the candidate profile (`candidate-profile.ts`), the base resume (`canonical-resume.ts`, `resume-footprint.ts`) and the bullet bank (`bullet-bank.ts`);
   - writes the full `.sensei/evidence_snapshot.json` (verification archive) and the compact `.sensei/application_context.json`, which is **what the model sees**. That file holds evidence rows, the resume template, `resumePlan`, `styleRules`, `coverLetterBrief` and `instructions`.
3. Agy writes `.sensei/application_bundle.json`, with evidence IDs beside every claim.
4. `npm run application:finalize -- <id>` → `application-finalize.ts`. It composes the public files using `application-artifacts.ts` (protected fields, formats, limits), scores with `fit-scoring.ts`, and validates with `application-validation.ts`. Output: `evaluation.md`, `<Prefix>_<Company>_Resume.md`, `cover_letter.md`, plus hidden draft, evidence and validation files.

Consequence: **model behavior is set by two sources, the skill text and the generated `application_context.json`.** The second is code (`buildCoverLetterBrief`, `compactStyleRules`, the `instructions` array). A skill fix that contradicts the brief will lose.

## Interview pipeline
Agy skills `jobsensei-interview-pipeline` (+ `references/stage-0N-*.md`), `jobsensei-interview-coach` and `jobsensei-technical-challenge` write under `jobs/<id>/interviews/`. `electron/interviews.ts` reads `interview.json` and the `dashboardBrief` for the UI.

## Rule ownership
See [references/rule-ownership-map.md](references/rule-ownership-map.md) before changing any product behavior. Every behavior should have exactly one owner. The map records where duplicates exist today.

## Design principles to keep
- Deterministic TypeScript for anything rule-based: scoring, composition, limits, file safety. The model only does judgment and prose.
- Grounding: every generated factual claim carries an evidence ID. Unsupported claims are dropped, not invented.
- The renderer gets narrow typed APIs through `electron/preload.ts`. There is no direct filesystem access from React.
- Public files never contain evidence IDs, warnings, hashes, or provenance.
