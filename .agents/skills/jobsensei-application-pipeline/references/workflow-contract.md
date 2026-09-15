# Lean Application Workflow Contract

The default JD workflow creates three visible application documents plus the immutable original JD. All machine state is stored under the job's hidden `.sensei/` directory.

## Visible Files

- `original_jd.md` (readable canonical derivative; legacy `original_jd.txt` remains an accepted fallback)
- `evaluation.md`
- `<artifactPrefix>_<Company>_Resume.md`
- `cover_letter.md`
- User-approved exports under `pdfs/`

Do not create a README, checklist, separate job match, resume change plan, readable audit, or separate resume/cover-letter audit.

## Hidden State

- `.sensei/job.json`
- `.sensei/status.json`
- `.sensei/application_run.json`
- `.sensei/evidence_snapshot.json`
- `.sensei/application_context.json`
- `.sensei/application_bundle.json`
- `.sensei/application_draft.json`
- `.sensei/application_evidence.json`
- `.sensei/validation_report.json`

The hidden application context is a compact deterministic projection produced by the snapshot command. It retains all routed claims while removing duplicate route and source metadata. Routing balances JD relevance, evidence strength, recency, employers, and source families. Non-LinkedIn structured current-employer evidence leads; LinkedIn is limited to corroboration, education, chronology, and older roles. The full snapshot remains the verification archive, while Agy drafts from the compact packet.

For new runs, Agy writes only `application_bundle.json`, with evidence IDs beside generated text. The finalizer deterministically derives `application_draft.json` and `application_evidence.json` for validation and compatibility. Legacy jobs that already contain the two derived files remain supported.

## Source Boundary

Use only the supplied JD and routed rows in the current hidden application context. Do not read the full evidence catalog or source context again after snapshot creation. Never inspect sibling jobs, prior application artifacts, fallback references, or validator source. The application context's voice profile is style policy only; it cannot support a candidate fact, score, chronology, metric, ownership, or outcome.

During an explicitly authorized regeneration, all existing generated Markdown and hidden draft, evidence, or validation files are stale outputs to overwrite. They are not references and must not be opened before replacement. Route from the saved JD alone so an older evaluation cannot bias the new evidence packet.

Tailor deliberately within that boundary. The JD identifies what to prioritize; it never proves that the candidate performed it. Begin with the candidate's supported claim and use the JD to prioritize, reorder, or add one or two accurate terms. Never reshape the claim around the JD or upgrade its tool, scope, ownership, metric, or outcome.

Every accepted job requires a job-specific resume pass. Use the current evaluation's five or six highest-value requirements as the drafting brief, then make at least three substantive, evidence-backed choices that reflect those requirements across skills, bullet order, or bullet wording. A generic resume copied from another job is not an acceptable draft. If two roles genuinely prioritize the same capabilities, preserve truthful content but still explain the different emphasis through bullet ordering and supported terminology; never use a reusable resume as the default simply because it is valid.

The evaluation's highest-priority requirements guide emphasis; they do not require every skills line or bullet to mirror the JD. At least two editable choices should serve those priorities and at least three substantive changes are required when selected evidence permits. If a requirement has no supporting evidence, leave it out rather than inventing a differentiating keyword.

Within the one generation pass, select five or six requirements and prioritize 12-18 rows from the bounded packet across relevant employers and time periods. Preserve each claim's action, object, employer, timeline, ownership, and scope. Reorder before rewriting, never construct an evidence ID, and apply the application voice profile last without changing facts or mappings.

Write public content in direct engineering language. Resume bullets use an accurate action and concrete tool or mechanism; include purpose or result only when evidence states it. When AI is central to the JD, supported AI/agent/ML evidence must appear in experience rather than only Skills, without upgrading integration or testing into model ownership. Skills use plain categories and concrete technologies. Cover letters stay candidate-first and chronological without buzzword chains, repeated model scaffolds, or keyword inventories.

The evaluation uses exactly six rows in the required `### Requirement Scoring` table: `core` 40%, `technical` 25%, `scope` 15%, `outcomes` 10%, `domain` 5%, and `learning` 5%. No other category name is valid. Direct/strong-transferable/adjacent-transferable/unclear/gap receive 1.00/0.80/0.65/0.25/0.00 credit. Semantic capability equivalence may earn transferable credit without literal JD overlap, while direct still requires matching action, method, scope, and ownership. Logistics remain constraints rather than weighted capability rows unless they are hard gates. The finalizer derives the visible score and confidence from this deterministic arithmetic, including evidence-sensitive core-work caps; model-written narrative totals are not authoritative.

Current means explicitly ongoing (`isOngoing: true`). Completed current-year evidence is recent and cannot support continuing-language claims. Career stages come from dated evidence rather than the JD. Secondary-resume text may locate historical context, but only selected structured evidence or LinkedIn may substantiate public claims and score credit.

If the snapshot includes current-employer context, use it only to calibrate organizational scale. Employer context cannot substantiate the candidate's responsibilities or outcomes.

The canonical template is immutable outside the constrained draft fields. Resume generation changes only skills and experience bullets. Cover-letter generation changes only recipient/date/salutation/body/closing fields. Finalization supplies all protected content and formatting.

Use the pinned footprint, `resumePlan`, and candidate profile before drafting. Follow their total and current-employer bullet ranges, employer allocation, and role-relevant tailoring. Preserve employer boundaries and never fuse projects. Begin the cover letter with the candidate's documented direction or transition, not an application announcement or employer description. Keep at least three quarters on the candidate and demonstrate fit through concrete evidence.

For a customer-facing role, `resumePlan` supplies selected recent customer evidence and a current-employer target. Use it while retaining technical work. Tailoring changes emphasis; it does not replace the stable present-role narrative with a JD-shaped task list.

## Execution Boundary

Use one screening batch, one intake/snapshot batch, one constrained generation batch, and one `application:finalize` command. Do not delegate to subagents. Do not run shell-based word counting. Finalization is diagnostic; after it returns, stop without editing or rerunning anything.

## Validation Severity

Technical errors include missing or unreadable required inputs, stale or wrong run context, and inability to compose the protected canonical template. The finalizer's returned `fitScore`, `fitConfidence`, and `gateStatus` are the only completion-summary score values.

Review warnings cover weak evidence overlap, unsupported or denylisted claims, invented metrics, ownership inflation, resume bullet allocation, preferred density, cover-letter length, body-paragraph preferences, formatting differences, and incomplete hidden evidence bookkeeping. After the `3.5/5` gate passes, these warnings never prevent the Markdown resume and cover letter from being persisted and never trigger automatic rewriting.
