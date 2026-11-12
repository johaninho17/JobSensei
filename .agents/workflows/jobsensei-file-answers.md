---
description: File the candidate's answers to Today questions into the right career record files (run by the app in the background).
---

# JobSensei: file Today answers

The app runs this in the background with the candidate's new answers to Today questions and a list of their career record files. Each answer is the candidate's own first-hand statement. Decide where each one belongs and write it as one evidence row; the app checks your choice and writes it into the file. Never edit or remove an existing row.

## Where an answer goes

1. Find when it happened: the answer's own words first ("at school", "in my last job", "last year"), then the candidate's career timeline file and the employers and dates in their profile (timing rule in the career-evidence skill).
2. Pick the one file that already holds that period or kind of fact:
   - work at an employer → that employer's work record for the matching phase (the file whose rows cover that employer and those years);
   - school, coursework, or personal study → the education or foundation file;
   - a story the candidate told about a specific situation → the interview stories file;
   - a personal or side project → the projects file.
   Prefer an existing file. If none fits, say so in `skipped` instead of guessing.
3. If the answer has no fact in it (only "no" or "not really"), skip it with that reason.

## The row

- `evidenceId`: `context:<a short name for the file>:<a short name for the subject>`, lowercase with hyphens, new (not used in the file).
- `year`: the year or range the answer is about, from step 1.
- `project`: the employer, school, or subject in a few words.
- `claim`: what the candidate said, in plain words, keeping their limits exactly ("conceptually, at school", "used it once"). Never upgrade a limit or add a tool, number, or result they did not say.
- `scope`: the limit that matters for using it ("coursework only, not production", "used Google Cloud at work, not AWS").
- `publicUse`: `eligible` for work they did; `foundation only` for coursework, reading, or concepts.
