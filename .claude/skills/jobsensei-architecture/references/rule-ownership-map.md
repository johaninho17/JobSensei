# Rule ownership map

For each product behavior: the intended **owner** (the one place to change it) and the **other copies** that exist today. When you change a behavior, edit the owner and delete or reduce every other copy to a one-line pointer. Update this map in the same change.

Audit date: 2026-10-23. ⚠ marks copies known to contradict each other.

| Behavior | Intended owner | Other copies today |
|---|---|---|
| Cover-letter structure & opening | `coverLetterBrief` in `electron/evidence-snapshot.ts` (what the model sees) | ⚠ `instructions` array in the same file (3-act) vs brief `requiredElements` (4-act); ⚠ `application-pipeline/SKILL.md` Act 1; ⚠ `application-writer/SKILL.md` Act 1; ⚠ `workflow-contract.md` ("not an application announcement"); ⚠ anti-slop "✅ Human" examples (which themselves lecture the employer) |
| JD content fed to the letter | `buildCoverLetterBrief` | ⚠ `roleProblems` pulls a JD responsibility line into the brief |
| Banned phrases (letters) | `prohibitedPatterns` in `buildCoverLetterBrief` | ⚠ truncated to 16 entries at write time; `application-writer/SKILL.md` list; anti-slop skill |
| Candidate voice | private `data/context/application_voice_profile.md` → `styleRules` | `candidate.json` `voiceGuidance` / `storyGuidance`; master prompt (not wired in); ⚠ the voice profile contradicts the master prompt |
| Resume tailoring scope | — (undecided in code) | ⚠ snapshot `instructions` + pipeline skill ("freeze history, 3–4 bullets"); ⚠ `resume-tailor/SKILL.md` (10–14 bullets, ≥3 changes across employers); ⚠ `workflow-contract.md` (12–18 rows across periods); ⚠ validator `RESUME_TAILORING_TOO_SIMILAR` (≥88% unchanged = warning, says rebuild) |
| Base-resume bullets as evidence | `evidence-snapshot.ts` + career-evidence skill | ⚠ rule "untrusted until evidence supports" vs the user decision that base-resume bullets are approved claims |
| Baseline bullet evidence IDs | `evidence-snapshot.ts` (`resumeTemplateEmployers`) | ⚠ falls back to an arbitrary routed row when there's no bullet-bank match |
| Fit-score categories & weights | `electron/fit-scoring.ts` | `application-pipeline/SKILL.md`, `rating-rubric.md`, `workflow-contract.md`, `job-match/SKILL.md`, `.agents/rules/jobsensei-truth.md` |
| Skills line count / Languages line | `application-artifacts.ts` | ⚠ truth rule "three technical lines" vs pipeline "curate categories" |
| Interview round definitions | `interview-pipeline/references/stage-0N-*.md` | `AGENTS.md`, `PRODUCT_FLOWS.md` (⚠ STAR wording), `interview-pipeline/SKILL.md`, `interview-coach/SKILL.md` (⚠ STAR) |
| No scripts / quotes in prep | stage refs | `AGENTS.md`, truth rule, quality-gate matrix |
| Run budget (one snapshot, one bundle, one finalize) | `application-pipeline/SKILL.md` | `AGENTS.md`, truth rule, `workflows/jobsensei-apply.md`, `PRODUCT_FLOWS.md`, `antigravity-permissions.md` (⚠ allows `validate`, not `finalize`) |
| URL fetch | `application-pipeline/SKILL.md` | ⚠ names `read_url_content` (not in Agy CLI); curl fallback writes to a not-yet-created folder |
| Client names out of public files | — (not enforced) | — |
| What Agy loads at run time | `electron/workspace-init.ts` | ⚠ seeds the workspace copy once and never refreshes it |
