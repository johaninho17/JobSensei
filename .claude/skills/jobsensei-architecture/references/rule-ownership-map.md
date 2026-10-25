# Rule ownership map

For each product behavior: the intended **owner** (the one place to change it) and the **other copies** that exist today. When you change a behavior, edit the owner and delete or reduce every other copy to a one-line pointer. Update this map in the same change.

Audit date: 2026-10-23, updated after Phase 4. ⚠ marks copies still known to contradict each other.

| Behavior | Intended owner | Other copies today |
|---|---|---|
| Cover-letter structure & opening | `buildCoverLetterBrief` (`structure`, `introContract`) in `electron/evidence-snapshot.ts` | Pointers only: pipeline skill, writer skill, `workflow-contract.md`, `AGENTS.md`, snapshot `instructions`. Locked by `tests/cover-letter-contract.test.ts` |
| JD content fed to the letter | `buildCoverLetterBrief` | None; `roleProblems` retired (optional in schema for old contexts). Test asserts no JD text in the brief |
| Banned phrases (letters) | `prohibitedPatterns` in `buildCoverLetterBrief` (no truncation) | Anti-slop skill (generic vocabulary). The candidate's own phrases are allowed via the voice profile |
| Candidate voice | private `data/context/application_voice_profile.md` → `styleRules` | `candidate.json` `voiceGuidance` / `storyGuidance`; master prompt (not wired in); ⚠ the voice profile contradicts the master prompt |
| Resume tailoring scope | Snapshot `instructions` (freeze earlier roles; rework 3–4 current bullets + skills) | Pointers: pipeline skill, resume-tailor skill. Validator `RESUME_TAILORING_TOO_SIMILAR` advice now matches |
| Base-resume bullets as evidence | `baseline` claim type (`validateBaselineClaim` in `application-artifacts.ts`) | Same wording in the truth rule, career-evidence skill + refs, evidence-snapshot contract: verbatim allowed, no score credit, rewrites need evidence |
| Baseline bullet evidence IDs | `evidence-snapshot.ts` (bullet-bank IDs only) + finalizer `claim()` | No fallback IDs anywhere. Test in `evidence-authority.test.ts` |
| Fit-score categories & weights | `electron/fit-scoring.ts` | `application-pipeline/SKILL.md`, `rating-rubric.md`, `workflow-contract.md`, `job-match/SKILL.md` |
| Must-have requirements (learnable −0.15 each, cap −0.45; gate uses pre-penalty score; only blockers stop) | `parseMustHaves` / `applyMustHaves` / `gateStatusFor` in `electron/fit-scoring.ts`; the list comes from the posting (`extractRequiredItems` → context `mustHaves`), checked by `verifyMustHaves`; best evidence per item is routed (`bestEvidenceForRequirement`); table format in pipeline skill "Evaluation" | Pointers: `rating-rubric.md`, `job-match/SKILL.md`, `workflow-contract.md`. Tests in `fit-scoring.test.ts` |
| Settings → Agy (story, career direction, tone, custom guidance, boundaries, confidential names, anti-slop) | `narrativeStoryLines` / `compactStyleRules` / `profileInstructionLines` in `evidence-snapshot.ts`; pillars stored only in `preferences.coverLetter.narrativePillars` | Settings "What Agy Sees" tab reads the same functions via `profile:preview`. Tests in `settings-and-summary.test.ts` |
| Resume summary | `canonical-resume.ts` (`summaryHeadingLine`, `summaryIsEditable`, compose) → `resumeTemplate.summary.editable` | Pipeline skill bullet; resume-tailor points to it. Tests in `settings-and-summary.test.ts` |
| Letter echoes the JD / dense paragraphs | `COVER_LETTER_ECHOES_JD`, `COVER_LETTER_DENSE_PARAGRAPH` in `application-validation.ts` (warnings) | — |
| Skills line count / Languages line | `application-artifacts.ts` | Pipeline skill "curate categories" (truth rule folded into AGENTS.md 2026-10-24) |
| Interview round definitions | `interview-pipeline/references/stage-0N-*.md` | `AGENTS.md`, `PRODUCT_FLOWS.md` (⚠ STAR wording), `interview-pipeline/SKILL.md`, `interview-coach/SKILL.md` (⚠ STAR) |
| No scripts / quotes in prep | stage refs | `AGENTS.md`, truth rule, quality-gate matrix |
| Run budget (fetch, one snapshot, one bundle, one finalize; <60s) | `application-pipeline/SKILL.md` (One-Pass Flow) | Pointers: `AGENTS.md` "New job flow", `workflows/jobsensei-apply.md`. Timing recorded in `.sensei/run_timing.json`, reported as `durationSeconds` |
| URL fetch | `npm run jd:fetch` (`electron/jd-fetch.ts`, JSON-LD first) + pipeline skill step 1 | `antigravity-permissions.md` allow list |
| Client names out of public files | Profile `truth.confidentialNames` → brief prohibited list, snapshot instruction, validator `CONFIDENTIAL_NAME_PUBLIC` | `AGENTS.md` pointer |
| What Agy loads at run time | `syncWorkspaceAgentFiles` in `electron/workspace-init.ts` (at launch and before each terminal start; backs up differing copies) | `tests/workspace-agent-sync.test.ts` |
| Cover-letter word limits | `buildCoverLetterBrief` (200–280, hard 330; ≤3 sentences per body paragraph) | `MIN/TARGET_MAX/MAX_COVER_LETTER_WORDS` in `application-artifacts.ts` (kept in sync) |
| Letter signature | `coverLetterSignatureName` in `canonical-resume.ts` (profile full name) | — |

| Unchanged bullets in the bundle | `{ "baseline": N }` refs + omitted employers, expanded by `expandBundleBaselines` (`application-finalize.ts`) | Pipeline skill step 5 + contract example; `tests/pipeline-speed.test.ts` |
