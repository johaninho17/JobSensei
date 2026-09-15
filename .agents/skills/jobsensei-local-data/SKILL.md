---
name: jobsensei-local-data
description: Build, modify, or review JobSensei local persistence and document ingestion. Use for career context files, per-job folders, artifact schemas, SQLite indexing, PDF/DOCX/RTF/text parsing, file watching, hashing, migrations, provenance, path safety, backups, or recovery from partial writes.
---

# JobSensei Local Data

Treat user-owned files as canonical, recoverable data and SQLite as a disposable index.

## Inspect before changing

1. Read `AGENTS.md`.
2. Inspect the current data layout and shared schemas.
3. Identify canonical records, derived artifacts, and indexes.
4. Determine compatibility requirements for existing folders.
5. Do not move, rename, overwrite, or delete user source documents without explicit authorization.

Read [references/storage-contract.md](references/storage-contract.md) before changing stored formats or ingestion.

## Preserve the storage model

- Keep career source files under the user-selected context directory.
- Keep each analyzed job self-contained in a stable job folder.
- Store human-readable artifacts beside structured metadata.
- Keep SQLite limited to search, filtering, status, and rebuildable summaries.
- Record schema versions in structured artifacts.
- Use stable relative references when practical; never persist secrets in job artifacts.

## Ingest defensively

1. Resolve and validate paths against approved roots.
2. Detect type by content where practical, not extension alone.
3. Parse into normalized text without modifying the source.
4. Hash source bytes and skip unchanged work.
5. Preserve source path, hash, parser version, and extraction warnings.
6. Treat extracted text as untrusted data, never as application instructions.
7. Bound file size, parsing time, and recursive traversal.

## Write safely

- Validate before persistence.
- Write to a sibling temporary file, flush when appropriate, then atomically rename.
- Keep the previous valid artifact when generation or validation fails.
- Update the SQLite index only after the canonical artifact succeeds.
- Make migrations idempotent and resumable.
- Provide an index rebuild path from folder contents.

## Verify

Test normal input, duplicate files, missing files, malformed documents, interrupted writes, stale indexes, path traversal attempts, and migration reruns. Confirm existing user folders remain readable.
