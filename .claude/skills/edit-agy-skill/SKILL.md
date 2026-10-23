---
name: edit-agy-skill
description: Safe procedure for changing how Agy behaves in JobSensei. Covers AGENTS.md, .agents/rules, .agents/workflows, .agents/skills, and the model-facing instructions generated in electron/evidence-snapshot.ts. Use whenever a product behavior (cover letters, resume tailoring, scoring, interview prep) must change or a regression must be fixed so it stays fixed.
---

# Changing Agy's behavior without causing regressions

Regressions in this project have come from rules being added beside old ones instead of replacing them. Follow these steps in order.

## 1. Check the decision
Read `dev-notes/decisions.md` if present. If the change conflicts with a recorded decision, stop and ask. When the user decides something new, record it there with the date, then continue.

## 2. Find every copy
Start from `.claude/skills/jobsensei-architecture/references/rule-ownership-map.md`, then search for the behavior's key phrases:

```bash
git grep -n -i "<key phrase>" -- AGENTS.md PRODUCT_FLOWS.md .agents electron src
```

Always include `electron/evidence-snapshot.ts` (the `instructions` array, `buildCoverLetterBrief`, `compactStyleRules`) and validator remediation text in `electron/application-validation.ts`. The model reads both.

## 3. Edit the owner, collapse the rest
- Make the change at the owner.
- Delete the other copies, or reduce each to a one-line pointer at the owner. Never leave two wordings.
- Prefer replacing or shortening a rule over adding a new "CRITICAL" line.
- If the model-facing data contradicts the skill (e.g. the brief feeds JD text the skill says not to use), fix the data in code. Prompt text cannot outvote the payload.

## 4. Keep it universal and private
- Public files (`AGENTS.md`, `.agents/`, tests, examples) must work for any candidate in any field. No names, employers, clients, persona labels, or local paths.
- Candidate-specific voice and facts go in the user's `data/` files.

## 5. Lock it with a test
Add or update a Vitest test that fails if the behavior regresses. For example: the brief has no `roleProblems`; the prohibited list keeps a given phrase; a skill no longer contains a removed instruction. Use fictional fixtures (Alex Morgan / Northstar Labs).

## 6. Make sure Agy actually receives it
In-app Agy reads `<workspace>/.agents/skills` and `<workspace>/AGENTS.md`, which `electron/workspace-init.ts` seeds only once. Until that sync is fixed, tell the user exactly which copy needs refreshing; never assume a repo edit is live.

## 7. Verify in a fresh context
Run `npm run typecheck` and `npm test`. For behavior changes, run the pipeline on the demo workspace (`npm run demo:seed`) or a user-approved job, from a session that hasn't seen this conversation. Compare the output against the decision, not against your expectations.

## 8. Update the map
Update `rule-ownership-map.md` and the ledger's "Enforced at" column in the same change.
