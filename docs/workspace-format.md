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

Each accepted job uses `jobs/<job-id>/` with `original_jd.md`, `evaluation.md`, a profile-named resume, `cover_letter.md`, `pdfs/`, and hidden `.sensei/` run state. New runs generate one evidence-linked `.sensei/application_bundle.json`; finalization derives the legacy draft and verification files. Interview preparation is stored under `interviews/` only after explicit interview intent.

The application tracker lives in `jobs/<job-id>/.sensei/tracker.json` and is written only when the user changes a job's status, dates, or notes in the app: `status` (`saved`, `applied`, `interviewing`, `offer`, `rejected`, `withdrawn`), `appliedAt` and `nextFollowUpAt` (`YYYY-MM-DD` or null), `notes`, and a `history` of status changes. Agy and the pipeline never write it. Until the user sets a status, the app derives one: Interviewing when interview prep exists, Applied when application drafts exist (applied date = the day the job was added), otherwise Saved.

The job queue lives in the workspace at `.sensei/job_queue.json`: `autoRun` and up to 50 `items` (`url`, `status`: queued, running, done, needs_attention, plus sent and finished times and the resulting `jobId`). The app sends one link at a time to Agy.

Files outside `data/` are application source and public documentation. Never place private candidate data in `examples/`; examples must remain fictional.
