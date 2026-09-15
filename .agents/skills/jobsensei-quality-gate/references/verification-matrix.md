# Verification matrix

| Change surface | Required evidence |
|---|---|
| Shared types or schemas | Typecheck, schema unit tests, compatibility fixture |
| Local API or IPC | Contract test, unauthorized-path test, actionable error |
| Files or SQLite | Round-trip test, interrupted-write behavior, index rebuild |
| Document ingestion | Representative fixtures, malformed input, extraction warnings |
| Gemini structured call | Mocked contract test, schema rejection, quota handling |
| ADK agent | Smoke run plus eval cases for behavior and tool use |
| Resume tailoring | Section/order integrity, evidence audit, no unsupported claims |
| UI component | Component/flow test and visual inspection |
| Navigation or layout | Keyboard flow, narrow-window and long-content inspection |
| Migration | Old fixture upgrade, idempotent rerun, failure recovery |

## Core AI evaluation cases

- A required skill has direct supporting evidence.
- A JD requirement has no supporting evidence.
- A resume asks for a section absent from the base template.
- The model proposes an attractive but unsupported metric.
- The provider returns invalid JSON.
- The provider returns `429`.
- An interview answer contains an unsupported claim.
- A research source conflicts with another source.

## Completion standard

Require evidence proportional to risk. A passing typecheck does not validate UI quality, persistence recovery, or agent truthfulness. A good-looking screenshot does not validate keyboard access or data safety.
