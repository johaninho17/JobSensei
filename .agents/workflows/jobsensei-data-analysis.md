---
description: Check the candidate's career records for thin, stale, conflicting, or duplicate data and propose one fix per finding as JSON (run by the app in the background).
---

# JobSensei: check the career data

The app sends a brief it built from the candidate's own files:
- `demand`: skills and tools their saved postings ask for, how many postings, and whether any of their files mention it (`inEvidence`).
- `conflicts`: the same project or employer with different years in different files.
- `duplicates`: the same claim in more than one row.
- `files`: each career record file with its header, the date it last changed, and its rows (ID | year | project | claim | scope).
- `resume`: the lines of the base resume.

Judge what the app found and word one fix for each real problem. The app checks every finding and drops any that breaks a rule below; the candidate then accepts, edits, or refuses each one. Up to 12 findings, most useful first. No finding is better than a weak one: an empty list is a fine answer. List anything you looked at and left alone in `skipped` with a short reason.

## Kinds

- **thin**: a skill or tool in `demand` with `inEvidence: false` (2 or more postings), or a row whose claim is too vague to use in a resume ("helped with projects"). You cannot know the missing facts, so the fix is always `ask`: one short, specific question the candidate can answer in a sentence.
- **stale**: a row or file header whose years or role no longer match newer rows or the resume (a file header `years:` that ends before its own rows, a title the resume has moved past).
- **conflict**: facts that cannot both be true: different years, titles, employers, or numbers for the same thing (from `conflicts`, or a row against a resume line). Different wording or emphasis for the same work is not a conflict; the resume is framed on purpose. Say which side the other files and the resume support; if they don't settle it, `ask`.
- **duplicate**: from `duplicates`, or two rows that say the same thing. Fix with `remove` on the weaker row, or `update` the stronger one to hold both.

## Every finding

- `id`: `fnd-1`, `fnd-2`, …
- `subject`: what it's about in a few words (the tool, employer, or project).
- `file`: the career record file the fix changes (for `ask`, the file the answer belongs in). `rowId`: the row's Evidence ID, or null for `add` and `ask`.
- `issue`: one plain sentence of 25 words or fewer that a person understands without the brief.
- `basis`: 1 to 4 quotes copied word for word from a file in the brief or the resume (`file` is its path), that show the problem. Never quote the brief's own lists.
- `fix.action`: `update`, `add`, `remove`, or `ask`.
- `fix.row` (for `update`, `add`, `remove`): `evidenceId`, `year`, `project`, `claim`, `scope`, `publicUse`, with the meanings in jobsensei-file-answers.md. For `update`, keep what the row already says and change only what the basis shows. For `remove`, give the row as it is.
- `fix.question` (for `ask`): the question.

## Never

- Never put a number, tool, employer, or result in a row that the basis quotes or the row itself do not already hold.
- Never upgrade a limit ("coursework" stays coursework; "helped" doesn't become "led").
- Never propose a change outside the career record files in the brief.
