---
name: diagnose-agy-run
description: Trace a bad or surprising JobSensei output (cover letter, resume, evaluation, interview prep) back to its cause before changing anything. Read-only by default. Use when the user says an output regressed, ignored their instructions, invented something, or "sounds wrong".
---

# Diagnosing an Agy run

Default mode is **evaluation only**: no file edits until the user approves a fix.

## 1. Pin down the run
- Job folder: `data/jobs/<id>/`. Open only that job, plus others the user names.
- Note the dates of `.sensei/application_context.json`, `.sensei/application_bundle.json` and the public files.
- **Which instructions did Agy load?** Compare the repo copy with the workspace copy:
  ```bash
  diff -rq .agents/skills data/.agents/skills; diff -q AGENTS.md data/AGENTS.md
  ```
  If they differ and the run came from the in-app terminal, the stale workspace copy is a suspect.

## 2. Read what the model saw
Read `.sensei/application_context.json` for that job: `instructions`, `coverLetterBrief`, `styleRules`, `resumePlan`, `evidenceRows`, `resumeTemplate`. Most "it ignored the skill" problems are this payload contradicting the skill.

## 3. Compare output to intent
Read the public output and `.sensei/application_bundle.json`. For each problem, classify the cause:

| Cause | Typical sign |
|---|---|
| Payload | The brief or instructions literally ask for the bad pattern (e.g. a JD line in `roleProblems`) |
| Skill text | A skill or reference says it, or two copies disagree (see rule-ownership map) |
| Stale copy | The workspace skill differs from the repo skill |
| Data | The voice profile, profile, denylist, or evidence rows are wrong, missing, or over-hedged |
| Validator / finalizer | Composition changed the output (signature, truncation, protected fields), or a warning pushes the next run the wrong way |
| Model variance | Instructions are clear and consistent, but the output still deviates |

## 4. Check the decision
Look the behavior up in `dev-notes/decisions.md`. Report whether it is enforced, contradicted, or a gap.

## 5. Report
Give a short list: symptom → cause (file:line) → proposed fix at the owner → how a test would lock it. Don't fix until the user says go. Then follow `edit-agy-skill`.
