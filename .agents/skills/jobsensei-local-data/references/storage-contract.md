# Storage contract

## Canonical layout

```text
data/
├── context/
├── screened-jobs/<screen-id>/
│   ├── original_jd.md
│   ├── original_jd.txt       # legacy/raw compatibility source when present
│   ├── screen.json
│   └── evaluation.md
├── jobs/<job-id>/
│   ├── .sensei/
│   │   ├── job.json
│   │   ├── status.json
│   │   ├── application_run.json
│   │   ├── evidence_snapshot.json
│   │   ├── application_context.json
│   │   ├── application_bundle.json
│   │   ├── application_draft.json       # derived by finalization
│   │   ├── application_evidence.json
│   │   └── validation_report.json
│   ├── original_jd.md
│   ├── <ArtifactPrefix>_<Company>_Resume.md
│   ├── cover_letter.md
│   ├── evaluation.md
│   ├── pdfs/
│   └── interviews/
│       ├── interview.json
│       └── <NN>-<stage>/
│           ├── research.md
│           ├── prep.md
│           ├── question_bank.md
│           ├── debrief_analysis.md
│           ├── mock_interview_<n>.md
│           └── feedback_<n>.md
├── debrief/
│   ├── <company>/
│   │   ├── <round>_transcript.txt
│   │   └── <round>_summary.txt
│   └── interview-memory/
│       ├── role-index.json
│       └── <role-family>.md
└── index.db
```

Do not assume every optional artifact exists.

Flat files directly under `interviews/` are valid legacy first-round artifacts. Readers must support them without moving or rewriting them. Raw debrief sources stay read-only under `data/debrief/<company>/` and are referenced by relative path from interview metadata.

## Job identifiers

Create IDs from normalized company, role, and local creation date. Sanitize separators and reserved names. Resolve collisions without overwriting an existing folder. Store display names in `.sensei/job.json`; support legacy root metadata without moving it.

## Artifact envelope

Private structured state under `.sensei/` should include:

- `schemaVersion`
- `createdAt` and `updatedAt`
- `sourceHashes`
- `promptVersion` when model-generated
- `model` when model-generated
- `status`
- validation or extraction warnings

Public resumes and cover letters must not include this envelope. New runs place evidence IDs beside generated claims in `.sensei/application_bundle.json`; finalization derives compact provenance in `.sensei/application_evidence.json`.

## Provenance

Career evidence should retain a stable evidence ID, source-relative path, source hash, excerpt or locator, normalized claim, and confidence. Generated artifacts should reference evidence IDs rather than duplicating untraceable claims.

## Index behavior

Treat SQLite as derived state. Commit canonical files before index updates. Supply a rebuild operation that scans folders, validates records, reports corrupt entries, and recreates the index without modifying source artifacts.
