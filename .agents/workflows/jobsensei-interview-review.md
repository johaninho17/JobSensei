# JobSensei Interview Review Import

## Description

Turn the candidate's recorded interviews (Granola, Otter, or notes saved under `data/debrief/`) into four reusable drafts: question patterns, interview voice, story proposals, and logistics. Nothing is saved until the user confirms each part.

## Steps

1. Read only the review or transcript files the user names under `data/debrief/`, plus `data/profile/candidate.json`, the existing `data/profile/interview_voice.md`, `data/profile/story_bank.md`, and `data/debrief/interview-memory/` records. Transcripts are performance records: what was asked and how the candidate answered.
2. Draft, then show the user, these four parts:
   1. **Question patterns** by role family and round (recruiter, hiring manager, practical, panel): questions actually asked, how often, practical formats seen, and follow-up triggers. Follow `interview-memory-contract.md`: no salary, names of interviewers, or confidential details.
   2. **Interview voice** for `data/profile/interview_voice.md` with exactly these sections:
      - `## Phrases I use`: the candidate's natural words and openers.
      - `## How I structure answers`: their usual order (e.g. context → action → ownership).
      - `## Delivery fixes`: 3–5 fixes, each as `<fix> — Now: <what recordings show> — Aim: <target> — Status (<date>): <not started | improving | done>`. Base them on evidence in the recordings (long answers, ending with apologies, underselling, unprepared common questions).
      - `## Answers that sounded like me`: 3–6 short verbatim excerpts, for recognizing the candidate's wording only; never copied into prep.
   3. **Proposed interview stories** for `data/context/structured/interview-stories.md`: one row per real work story the candidate told, using the structured context table (Evidence ID `context:interview-stories:<slug>`, Year, Project, Explicit claim, Scope note with the candidate's own qualifiers, Source locator with interview date and company, Confidence, Public use). Mark stories the candidate explicitly limited ("not production", "not the sole owner") exactly as limited. Never upgrade a hedged story.
   4. **Logistics draft** for Settings → Interview Prep (location, work authorization, compensation, notice period, work arrangement), quoting what the candidate said, and flagging inconsistencies for the user to resolve.
3. Wait for the user's confirmation of each part. Save only confirmed parts: role memory under `data/debrief/interview-memory/`, voice to `data/profile/interview_voice.md` (merge the tracker, keep earlier dates), confirmed story rows to `data/context/structured/interview-stories.md`. Logistics are entered by the user in Settings.
4. When re-run on newer recordings, update the delivery tracker statuses with dated evidence, add new question patterns, and propose only new stories.

## Command Firewall

No scripts or commands. Read and write only the files named above.
