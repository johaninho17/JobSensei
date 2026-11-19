# Workspace Format

JobSensei creates this ignored local structure:

```text
data/
  profile/candidate.json
  resumes/
  context/
    structured/
    broad/
    denylist.md
    application_voice_profile.md
  jobs/<job-id>/
  debrief/
  .sensei/
```

`profile/candidate.json` defines identity, artifact naming, source paths, chronology, and writing preferences. It organizes sources but does not replace detailed evidence.

The configured base resume protects identity, chronology, section order, and presentation. Selected structured context is the factual authority for candidate claims. Broad context clarifies structured evidence. LinkedIn and secondary resumes provide lower-weight historical or corroborating support.

Each accepted job uses `jobs/<job-id>/` with `original_jd.md`, `evaluation.md`, a profile-named resume, `cover_letter.md`, `pdfs/`, and hidden `.sensei/` run state. New runs generate one evidence-linked `.sensei/application_bundle.json`; finalization derives the legacy draft and verification files. `original_jd.md` is the cleaned posting: the app removes any application form, button text, and invisible characters, and gives a plain paste a header (title, company, location, source) and headings. A form found in a paste or page is kept apart in `.sensei/application_form.md`, where the Questions tab reads its questions. `.sensei/posting.json` is the app's structured reading of the posting (title, company, location, board, role overview, company line, requirements with `req:N` IDs, responsibilities, preferred items, benefits, pay as text and numbers, work setup and days in office, travel, experience, seniority, work authorization, tools named in the requirements, and a `missing` list of facts the posting does not state). The app writes it when a posting is saved and rebuilds it whenever the posting or the parser version changes; every screen and check reads requirements, pay, and work setup from it. Interview preparation is stored under `interviews/` only after explicit interview intent.

Application questions: `jobs/<job-id>/application_answers.md` holds the written questions from the posting's application form (Greenhouse, Ashby, and Lever links) or questions pasted in the app, each as a `###` heading followed by its answer, by notes when the employer asks the candidate to write it themselves, or by a skipped note with its reason (logistics, or nothing real to answer it with). You can edit it; the app shows and copies the edited text. `jobs/<job-id>/.sensei/application_questions.json` records the questions, word and sentence limits, each decision (answer, skip, notes) and kind, status, timing, warnings, and the cited evidence. A background Agy, separate from the terminal, writes both; logistics, salary, and eligibility questions are skipped unless the user presses "Answer anyway".

The application tracker lives in `jobs/<job-id>/.sensei/tracker.json` and is written only when the user changes a job's status, dates, or notes in the app: `status` (`saved`, `applied`, `interviewing`, `offer`, `rejected`, `withdrawn`), `appliedAt` and `nextFollowUpAt` (`YYYY-MM-DD` or null), `notes`, and a `history` of status changes. Agy and the pipeline never write it. It also holds `interviews` (real interviews only, each with `round`: recruiter, hiring_manager, practical, final, or other, an optional `date`, `note`, and `source`) and `outcome` (`stageReached`, `result`: rejected, withdrew, no_reply, offer, accepted, declined, the user's `reason`, and `date`), entered in the job's "What happened?" panel. Prep files alone never count as an interview there.

`jobs/<job-id>/.sensei/job-overrides.json` holds the user's corrections from Edit details on the job page (`src/shared/job-overrides.ts`): `company`, `title`, `location`, `workMode`, and `pay` (`min`, `max`, `currency`, `period`), each null when not corrected. It is laid over the posting record and `job.json` wherever the job is shown or named, and nothing but Edit details writes it.

`jobs/<job-id>/.sensei/framing-choices.json` lists the flagged lines the user chose to keep as written (`{ "kept": [<line text>] }`); a line whose text changes is checked again. Written only by Keep on the job page.

`jobs/<job-id>/.sensei/job_record.json` is the app's summary of a job, rebuilt when the job's files change and saved only when it differs: fit (score, decision, confidence, whether it rates the posting's requirements by ID and still matches the posting), requirement rows, must-haves, gaps, gap terms (posting tools in rows the evidence didn't cover), documents present, posting facts (pay numbers, work mode, seniority, experience, tools, missing facts), interviews (prepared rounds, recorded interviews, furthest round), the outcome, and a health check per area (posting, evaluation, documents, tracking) with a note on how to fill each gap. Jobs ⋯ → Data health lists the jobs with gaps. Interviews → Learnings is computed from these records and counts only recorded interviews, never prep files.

Interview recordings live under `debrief/<company>/`. `.sensei/content-sources.json` records each one the app has seen (content hash; new, imported, duplicate, or skipped), so Interviews → Your content can show only new recordings and send Agy only those. An update backs up the interview content (`.sensei/content-backups/`), Agy writes its change list to `.sensei/content-changes.json`, and the app puts back anything removed without a better replacement.

Career files added in the app (Career context → Sources → Add files, or drag and drop) are copied into `context/structured/` (work records) or `context/broad/` (notes and documents) and checked for Agy; the originals are not touched, existing files are never overwritten, and the same file added twice is not copied again. Until the user sets a status, the app derives one: Interviewing when interview prep exists, Applied when application drafts exist (applied date = the day the job was added), otherwise Saved.

The job queue lives in the workspace at `.sensei/job_queue.json`: `autoRun` and up to 50 `items` (`kind`: link or paste, `url` for a link, a display `label`, an optional `note`, `manual` for items sent from the chat, `status`: queued, running, done, needs_attention, plus sent and finished times and the resulting `jobId`). A pasted job description is saved as `.sensei/staged-jds/<item-id>.md` (with a `.json` of parsed company, title, and location) and removed once its item leaves the queue. The app sends one job at a time to Agy, only when Agy is idle; links and pastes from the chat join the same queue, so a new paste never replaces a running job.

Job Search keeps its files in `.sensei/job-search/`: `settings.json` (titles, places, work setups, level, pay floor, keywords, boards, watched companies with how each was added, schedule, limits, ratings), `state.json` (every found job with its quick fit and any Agy light rating, every run with what it found and left out, links already seen, and drafts a scheduled search marked for the app to queue), `postings/<find-id>.md` (each found posting, cleaned like any other), `scheduled.log`, and `run.lock` (one search at a time between the app and the schedule). Nothing in `state.json` is ever trimmed.

`.sensei/evidence_snapshot.json` in each job is stored gzip-compressed (about five times smaller); the app reads compressed and older uncompressed snapshots alike.

Files outside `data/` are application source and public documentation. Never place private candidate data in `examples/`; examples must remain fictional.

## Folder layouts

A workspace uses one of two folder layouts. The app, its saved data, and every check name files the same way in both (the *logical* path, the left column); only the place on disk differs. `src/shared/workspace-layout.ts` owns the names, and `.sensei/layout.json` records which layout a workspace uses (no file = original).

| Logical path (always) | Original layout | Tidy layout |
|---|---|---|
| `context/structured/` | same | `career/records/` |
| `context/broad/` | same | `career/notes/` |
| `context/<other files>` | same | `career/` |
| `context/application_voice_profile.md` | same | `profile/writing-voice.md` |
| `context/denylist.md` | same | `profile/private-names.md` |
| `profile/story_bank.md` | same | `profile/story-bank.md` |
| `profile/interview_voice.md` | same | `profile/interview-voice.md` |
| `debrief/interview-memory/` | same | `interviews/memory/` |
| `debrief/<company>/` | same | `interviews/recordings/<company>/` |
| `jobs/<job-id>/`, `resumes/`, `profile/candidate.json` | same | same |

Setup → Your folders previews the move, applies it, and can undo it (`electron/layout-migration.ts`). Nothing is deleted: exact copies, old `screened-jobs/`, and leftover run files go to `archive/`. Agy's copy of the instructions in the workspace is rewritten with the disk names, and a file an Agy run writes to an old path is moved to its real home.
