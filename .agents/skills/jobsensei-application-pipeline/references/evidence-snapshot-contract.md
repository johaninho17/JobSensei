# Evidence Snapshot Contract

An accepted-job workflow must freeze its allowed factual sources before matching or drafting.

## Creation

1. Reread `data/.sensei/active-context.json`; do not rely on a manifest remembered earlier in the conversation.
2. Confirm its workspace, configured base resume, selected paths, and hashes.
3. Run `npm run context:snapshot -- <canonical-job-id>` from the JobSensei project root.
4. Read `data/jobs/<job-id>/.sensei/application_context.json` and record its `snapshotId` and `manifestHash`. The full `evidence_snapshot.json` remains the deterministic verification archive and is not the drafting payload.
5. Stop if creation fails, the base resume is missing, or the manifest belongs to another workspace.

The hidden `.sensei/evidence_snapshot.json` is immutable for the current run. The same command derives a bounded `.sensei/application_context.json`; only rows in that routed packet are available to scoring and drafting. The full snapshot preserves all selected evidence for deterministic verification but is not model drafting context. Normal runs do not create versioned snapshot folders.

Non-LinkedIn structured project evidence is primary for the current employer. LinkedIn remains useful for chronology, education, older roles, and corroboration, but cannot independently make a current-employer claim direct when richer selected project evidence is required.

## Authority

- Eligible structured `evidenceRows` are the exclusive factual authority for candidate capabilities, responsibilities, tools, projects, outcomes, ownership, and metrics.
- Each evidence row records normalized years, ongoing status, and a `current`, `recent`, `foundation`, or `unknown` recency band. Recency affects prioritization only after JD relevance is established.
- Selected broad `contextText` may clarify an eligible structured row. It cannot independently support a public claim.
- Eligible LinkedIn rows may support history, education, technologies, and older roles.
- Secondary resumes may help locate historical wording but cannot independently verify a public claim.
- The configured base resume controls identity, employer order, titles, dates, education, section grammar, and footprint. Its bullets, skills, metrics, and ownership language are untrusted until an eligible snapshot row supports them.
- The snapshot stores a defensive footprint profile for the selected Markdown, PDF, or DOCX base resume. Markdown and structurally readable DOCX profiles are reliable; PDF or malformed binary profiles may be partial and must expose warnings.
- Snapshot creation pins a deterministic `.sensei/application_run.json`. An unchanged manifest and base resume reuse the same snapshot and run. Changed inputs make earlier drafts pending review.
- The supplied JD supports employer and requirement statements only. It never supports candidate experience.
- `denylistRules` are mandatory policy and override resumes, old artifacts, the JD, and conversation memory.
- `context/application_voice_profile.md` is mandatory style policy. It may shape wording only after factual drafting and cannot create an evidence row or support a claim, score, chronology, metric, ownership, or outcome.
- Context indexes, generated summaries, prior applications, and unselected files are not evidence.

## Downstream Boundary

The evaluation, resume, cover letter, and inline evidence mappings in `.sensei/application_bundle.json` must consume the same routed application context and `snapshotId`. Do not reread career sources or the full evidence catalog after snapshot creation.

The single hidden evidence map declares the exact run ID, `snapshotId`, `manifestHash`, and `baseResumePath`. Copy evidence IDs exactly from the snapshot; never construct aliases or shorthand IDs. A claim with no eligible evidence ID is removed or recorded as a gap. Model memory cannot fill it.
