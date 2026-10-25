---
name: lean-build
description: Token- and time-efficient working rules for building JobSensei with Claude Code. Use on every build, fix, eval, or skill edit in this repo, and when writing or trimming any skill (builder or Agy) so it loads less context.
---

# Lean build

Every turn resends the whole conversation plus everything read. Cost tracks what you carry, not what you type. These rules keep context small without skipping verification.

## Find before reading
- Locate with `grep -n` / file listings first; then read only the needed range (`offset`/`limit`, `sed -n 'a,bp'`).
- Never read: `dist/`, `dist-electron/`, `node_modules/`, `release/`, lock files, PDFs/DOCX, `data/jobs/*` artifacts, or `.sensei/*.json` snapshots — unless the task is about that exact file. For JSON, extract fields with a one-line script instead of reading it.
- Don't re-read a file you just edited or already have in context; edits fail loudly if they miss.
- One question → one targeted search. Stop searching once you can act.

## Batch and filter
- Send independent reads, searches, and edits in one turn.
- Filter command output to what matters: `| tail -5`, `| grep -E "error|FAIL|Tests "`, `-q` flags. Never dump full logs or full test output.
- Make many small mechanical edits with one short script rather than many edit calls, when the edit is exact and safe.

## Verify once, at the right level
- While iterating: run only the touched test file (`npx vitest run tests/<file>`). At the end: `npm run typecheck`, `npm test`, `npm run build` once each, filtered.
- No verification loops: if a check passed, don't re-run it to be sure.
- Prove behavior on a scratch copy of `data/` (never the real job folders) and report the few lines that prove it.

## Write less
- Plans, reports, and chat answers: lead with the result; no recap of what the user already knows.
- Put long material (drafts, research, eval details) in a file and give its path instead of pasting it.

## Skills: progressive disclosure (builder and Agy)
From Anthropic's skill-authoring guidance:
- `SKILL.md` holds only what is needed on every use; aim for well under 500 lines, ideally one screen.
- Details go in `references/*.md`, one level deep, each loaded only when its situation arises (e.g. one stage file per interview round).
- Deterministic work belongs in commands or scripts (`interview:check`, `application:finalize`), not in prose the model must follow.
- One owner per rule (see `CLAUDE.md`): link to the owner instead of restating it.
- A precise `description` decides when the skill loads; a vague one loads it when it isn't needed.

## Sessions
- One bounded task per session. Long sessions get summarized; start fresh between unrelated phases.
- Subagents only when the user asks.
