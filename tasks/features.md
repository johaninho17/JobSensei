# Feature registry

Long-lived features and the files they own. Tasks live in GitHub Issues (labels `FEAT-xxx`, `P0`–`P3`); `tasks/issues.md` is an index generated from them (`npm run issues:index`).

This file says **where** a feature lives. It does not restate product rules: the rule-ownership map is in `.claude/skills/jobsensei-architecture`.

When an issue changes a feature's files or data contracts, update its entry here in the same PR and check the open issues that share the feature.

| ID | Feature | Main files | Shared contracts |
|---|---|---|---|
| FEAT-001 | Jobs list and tracker | `src/renderer/JobsHome.tsx`, `src/shared/tracker.ts`, `electron/tracker.ts`, `src/shared/job-organize.ts` | `tracker.json`, `TrackedJob`, `effectiveStatus` |
| FEAT-002 | Job workspace and documents | `src/renderer/JobWorkspace.tsx`, `src/renderer/Documents.tsx`, `electron/role-facts.ts`, `electron/pdf-export.ts`, `electron/pdf-file-actions.ts` | job record, validation report |
| FEAT-003 | Application pipeline | `electron/evidence-snapshot.ts`, `electron/application-artifacts.ts`, `electron/application-validation.ts`, `electron/application-finalize.ts` (Fix/Stop failure labels), `electron/fit-scoring.ts`, `.agents/skills/`, `src/shared/prompt-fence.ts` (posting text fenced as data in background prompts) | application context, evidence rows, bundle |
| FEAT-004 | Job Search | `src/renderer/JobSearchView.tsx`, `electron/job-search.ts`, `electron/job-boards.ts`, `src/shared/job-search.ts` | search settings, found-job items |
| FEAT-005 | Interviews and content | `src/renderer/InterviewView.tsx`, `electron/interview-context.ts`, `electron/interview-check.ts`, `src/shared/question-bank.ts` + `src/shared/interview-docs.ts` + `electron/interview-render.ts` (questions, prep, and research as JSON, #113), `electron/content-refresh.ts`, `src/shared/learnings.ts` | `question_bank.json`, question cards, recording record, story bank |
| FEAT-006 | Agy panel and queue | `src/renderer/TerminalPanel.tsx`, `src/shared/job-queue.ts`, `electron/terminal.ts`, `electron/run-watcher.ts`, `electron/agy-home.ts` | queue items, run status |
| FEAT-007 | Today | `src/renderer/TodayView.tsx`, `src/shared/today.ts`, `electron/today.ts` | `today.json`, questions |
| FEAT-008 | Setup, Settings, Career context | `src/renderer/SettingsModal.tsx`, `src/renderer/SetupAndContext.tsx`, `src/renderer/WorkspaceFolders.tsx`, `src/shared/workspace-layout.ts` (folder map, stray items), `electron/layout-migration.ts`, `electron/setup-readiness.ts`, `electron/context-import.ts`, `src/shared/profile-fields.ts` | candidate profile, context manifest |
| FEAT-009 | Design system and shell | `src/renderer/tokens.css`, `layout.css`, `styles.css`, `SubTabs.tsx`, `Section.tsx`, sidebar and shortcuts in `App.tsx`, `UI_DESIGN_SYSTEM.md` | design tokens |
| FEAT-010 | Recruiter Edition | `src/shared/edition.ts`, `src/shared/candidates.ts`, `electron/candidates.ts`, `src/renderer/CandidateProfile.tsx`, `Review.tsx` | `FEATURES.*`, roster |
| FEAT-011 | Build, CI, release | `.github/workflows/`, `scripts/`, `tasks/`, `build-config/` | — |
| FEAT-012 | Agy page | planned: `src/renderer/AgyView.tsx`, `src/shared/agy-actions.ts`, `src/shared/agy-behavior.ts`, `electron/agy-activity.ts`; settings band on Jobs and Learnings: `src/shared/job-organize.ts` (`settingsBandOf`), `src/shared/learnings.ts` (`bySettings`); keep or revert flagged lines: `electron/framing-choices.ts`, `framingLines` in `electron/application-validation.ts`, `baseBulletInPlace` in `electron/canonical-resume.ts`, `FramingLines` in `src/renderer/JobWorkspace.tsx` | `.sensei/framing-choices.json`, `preferences.agy`, settings score |
| FEAT-013 | Posting intake and job details | `electron/jd-fetch.ts`, `electron/posting-clean.ts`, `electron/posting-template.ts`, `electron/posting-record.ts`, `electron/posting-library.ts`, `src/shared/posting.ts`, `src/shared/posting-fields.ts`; user corrections: `src/shared/job-overrides.ts`, `electron/job-overrides.ts`, `EditJobDetails` in `src/renderer/JobWorkspace.tsx` | posting record, `.sensei/job-overrides.json` |

## Issue history

Open issues per feature: see `tasks/issues.md`. Completed issues are added here, under their feature, when their PR merges.
