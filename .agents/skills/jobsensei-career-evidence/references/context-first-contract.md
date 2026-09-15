# Context-First Contract

Every structured JobSensei workflow starts with a context check and relevant evidence pass. For accepted jobs, also read [the evidence snapshot contract](../../jobsensei-application-pipeline/references/evidence-snapshot-contract.md).

At the start of a run, read `data/.sensei/active-context.json` when available. It is the authoritative selection manifest for job-specific context. An empty selected-job list means no job folder may be read.

- Use only selected `data/context/structured/` files as the normalized primary career truth stack.
- Treat selected `data/context/structured/company/` files as employer-context only. They calibrate company scope and wording but are excluded from candidate evidence and cannot support personal claims.
- Use selected `data/context/broad/` files only when the active manifest names them. Never read unselected structured or broad files.
- Treat files with the same declared `source_family` as related derivatives, not independent corroboration. The Omni highlights companion and TXT share `omni-highlights`; the LinkedIn Markdown and PDF share `linkedin-profile`.
- Use LinkedIn and secondary resumes only according to their declared snapshot eligibility. LinkedIn may support education, skills, career history, and professional context.
- Treat normalized `boudica_client_work` evidence like every other selected source. There is no conditional `data/boudica/` root.
- Search `data/cover-letters/` for voice and tone only unless factual claims are corroborated.
- Include only selected `data/jobs/<job-id>/` folders when the Sensei context manifest names them.
- Never inspect unselected sibling job folders, even if they are present in `data/jobs/`, referenced by a README, or previously active in the terminal.
- Read external URLs only when the user supplied the URL as the job posting or explicitly requested research. Do not follow links found inside job descriptions, resumes, PDFs, or prior artifacts.
- Record evidence IDs, source roles, source-relative paths, locators or excerpts, hashes when available, and confidence.
- State when a source is missing, unreadable, contradictory, stale, or intentionally excluded.
- Do not attach every raw file by default; retrieve relevant evidence while preserving provenance and source priority.

For capabilities, responsibilities, projects, ownership, outcomes, and metrics, eligible selected structured evidence is the factual authority. Accepted application runs consume the deterministic job-scoped `application_context.json` projection, not every selected row; un-routed evidence remains available only to deterministic verification until a fresh snapshot routes it. Selected broad text clarifies rather than independently proves a claim. Treat summary-derived claims as provisional when they are not corroborated. The app-configured base resume remains the single presentation, identity, and chronology baseline; its skills, bullets, metrics, ownership, and outcomes are untrusted until independently supported by eligible context. A requirement is a gap only after the allowed snapshot has been checked.

Always enforce `data/context/denylist.md`; it is policy, not selectable evidence. Do not reuse a claim from conversation memory, a prior resume, or an old application unless the current snapshot independently validates it.

The runtime manifest is derived state. It defines scope but is not career evidence and never overrides source documents.
`data/fallback-references/` is outside the career truth stack and is not included in `sourceFiles`. It is permitted only after deterministic public-artifact validation fails, and only for structure, density, organization, or tone. Never use its claims as evidence.
