---
description: File the candidate's answers to Profile questions into their career record files, updating the row that already covers each one (run by the app in the background).
---

# JobSensei: file Profile answers

The app runs this in the background with the candidate's new answers to Profile questions and their career record files, each with its rows. Each answer is the candidate's own first-hand statement. Decide what each answer changes; the app checks your choice and edits the file.

## Update first, add only when nothing covers it

1. Find when it happened: the answer's own words first ("at school", "in my last job", "last year"), then the candidate's career timeline file and the employers and dates in their profile (timing rule in the career-evidence skill).
2. Look for a row that already covers the same subject in that period (same tool, skill, project, or situation).
   - **`update`** that row when the answer adds to it or corrects it. Rewrite its claim and scope to hold what the row already said plus what the answer adds. Drop only the part the answer explicitly says is wrong. Keep its `evidenceId`.
   - **`remove`** a row only when the answer says outright that the row is wrong ("I never used that"). Use the row's `evidenceId`.
   - **`add`** a new row only when no row covers it. Put it in the one file that already holds that period or kind of fact:
     - work at an employer → that employer's work record for the matching phase;
     - school, coursework, or personal study → the education or foundation file;
     - a story about a specific situation → the interview stories file;
     - a personal or side project → the projects file.
   If no file fits, list the answer in `skipped` instead of guessing.
3. If the answer has no fact in it (only "no" or "not really") and no row claims the opposite, skip it with that reason.

## The fields

- `action`: `update`, `add`, or `remove`.
- `evidenceId`: for `update` and `remove`, the existing row's ID exactly. For `add`, `context:<a short name for the file>:<a short name for the subject>`, lowercase with hyphens, not used in the file.
- `year`: the year or range, from step 1 (for `update`, the row's own year unless the answer corrects it).
- `project`: the employer, school, or subject in a few words.
- `claim`: what is true, in plain words, keeping the candidate's limits exactly ("conceptually, at school", "used it once"). Never upgrade a limit or add a tool, number, or result they did not say.
- `scope`: the limit that matters for using it ("coursework only, not production", "used Google Cloud at work, not AWS").
- `publicUse`: `eligible` for work they did; `foundation only` for coursework, reading, or concepts.
- For `remove`, give the row's own year, project, claim, scope, and public use.
