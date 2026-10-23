# Verification matrix

| Change surface | Required evidence |
|---|---|
| Shared types or schemas | Typecheck, schema unit tests, compatibility fixture |
| Local API or IPC | Contract test, unauthorized-path test, actionable error |
| Workspace files | Round-trip test, interrupted-write behavior, legacy-folder compatibility |
| Document ingestion | Representative fixtures, malformed input, extraction warnings |
| Agy skill / AGENTS.md / snapshot instructions | Test locking the rule; rule-ownership map updated; fresh-context pipeline run on demo data |
| Snapshot, finalizer, validator | Unit test with fictional fixture; check `application_context.json` shape |
| Privacy | Staged diff scanned for names, employers, clients, contact details, local paths, keys |
| Resume tailoring | Section/order integrity, evidence audit, no unsupported claims |
| UI component | Component/flow test and visual inspection |
| Navigation or layout | Keyboard flow, narrow-window and long-content inspection |
| Migration | Old fixture upgrade, idempotent rerun, failure recovery |

## Core AI evaluation cases

- A required skill has direct supporting evidence.
- A JD requirement has no supporting evidence.
- A resume asks for a section absent from the base template.
- The model proposes an attractive but unsupported metric.
- The model writes an invalid `application_bundle.json`.
- A client or partner company name reaches a public resume or cover letter.
- An interview answer contains an unsupported claim.
- An interview preparation artifact duplicates retrospective STAR stories across rounds or duplicates challenge labs in question banks.
- An interview scenario or practical challenge relies on proprietary unreleased internal company architecture rather than industry-standard first principles.
- An interview answer uses scripted verbatim monologues or quotation marks instead of glanceable punchy memory anchors.
- A research source conflicts with another source.

## Completion standard

Require evidence proportional to risk. A passing typecheck does not validate UI quality, persistence recovery, or agent truthfulness. A good-looking screenshot does not validate keyboard access or data safety.
