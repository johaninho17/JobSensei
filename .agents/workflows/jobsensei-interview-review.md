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
4. When re-run on newer recordings (the app names only the new files), update the delivery tracker statuses with dated evidence and add new question patterns. Content is **added, merged, or upgraded**: a new story is a new row; an existing row may gain a source locator, a sharper claim, or the candidate's own qualifier, shown to the user as before → after. Remove or shorten something (a story, row, question pattern, phrase, delivery fix, or qualifier) **only when a better version replaces it** (fuller, better supported, or more accurate), and show the user each one as old → new with why.
   After saving, write the change list the app checks to `.sensei/content-changes.json`: `{"changes": [{"file": "<workspace path>", "kind": "added" | "upgraded" | "replaced" | "removed", "item": "<the old text, or its ID such as S3 or context:interview-stories:slug>", "replacement": "<new text or ID, for replaced/removed>", "why": "<one line>"}]}`. The app restores anything removed or shortened that isn't in this list.
5. Keep the `## Imported recordings` list at the top of `context/structured/interview-stories.md` current: each file once, with its date. Skip files already listed.
6. **Practice interviews** (a mock with an AI interviewer or a friend, e.g. files under `mock-interviews/` or titled "simulation" or "mock"): the candidate's answers are their own words, so they count fully for **interview voice** (phrases, structure, and dated delivery-fix evidence: filler openers, underselling, a process recited instead of an example, a wrong story for the question) and for **story proposals** (a real situation they described). Questions they struggled with (no example, a gap with no bridge, a long stall) go to the role memory as `## Hard questions to practice` with the round, never counted as questions real interviewers asked. The mock interviewer's own feedback is a second opinion, not evidence: use it only where the transcript shows the same thing, and never take a metric, timeline, or result from it.
7. Answers written by an AI interview assistant (they read as polished, complete answers, often with metrics, rather than speech) are not the candidate's words. Take only the interviewer's questions and the process from them; a story from such a file needs the candidate to confirm they said or did it.

## Command Firewall

No scripts or commands. Read and write only the files named above.
