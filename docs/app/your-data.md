# Your data

<!-- feature:!candidates -->
Everything lives in your workspace folder on this computer. Setup → Show in Finder (or Explorer) opens it. The names below are the original folder layout; with tidy folders (Setup → Your folders) the same files sit under plainer names.

| Folder or file | What it is | Who changes it |
|---|---|---|
| `profile/candidate.json` | Your name, contact details, preferences, and settings | You, in Setup and Settings |
| `resumes/` | Your base resume and other versions | You |
| `context/structured/` | **Work records**: the facts drafts are built from, one table row per fact, each with when it happened | You; Agy adds rows when it files your answers |
| `context/broad/` | Notes and documents that add background (not used as facts on their own) | You |
| `context/denylist.md` | Names to keep private and claims never to make | You, in Setup |
| `context/application_voice_profile.md` | How you write | You, in Setup |
| `jobs/<job>/` | One folder per job: the posting, your tailored resume, cover letter, evaluation, and PDFs | Agy writes drafts; you edit them |
<!-- /feature -->
<!-- feature:candidates -->
Everything lives in your recruiter folder on this computer: one folder for your own settings and postings, and one folder per candidate. Nothing is uploaded anywhere.

| Folder or file | What it is | Who changes it |
|---|---|---|
| `recruiter/settings.json` | Your name, agency, defaults for every candidate, and your instructions for Agy | You, in Settings |
| `recruiter/candidates.json` | Your candidate list and each one's status | You, on Candidates |
| `recruiter/library/` | Every posting you added, saved once, with who it went to | The app, from Postings |
| `candidates/<name>/` | One candidate's own folder, laid out as below | |
| `…/profile/candidate.json` | Their name, brief, application facts, and their own settings | You, in Profile |
| `…/resumes/` | Their base resume and other versions | You |
| `…/context/structured/` | Their files and your notes (`recruiter-notes.md`); every checked file is evidence | You |
| `…/jobs/<job>/` | One folder per job: the posting, the tailored resume, a cover letter when on, the evaluation, and PDFs | Agy writes drafts; you edit them |
| `…/jobs/<job>/submitted/` | Frozen copies of exactly what was sent, by date | The app, when you mark a job applied |

Each candidate's Agy history (its conversations and memory) is kept in the app's own data folder, one store per candidate, and moved in only while that candidate is open.
<!-- /feature -->
<!-- feature:interviews -->
| `jobs/<job>/interviews/` | Interview prep for that job, one folder per round | Agy, when you ask for prep |
| `profile/story_bank.md` | Your stories for interviews | Agy drafts it once; you edit |
| `profile/interview_voice.md` | How you speak, and the delivery fixes you're working on | Updated from your recordings |
| `debrief/` | Interview recordings and transcripts, by company, plus practice interviews | You add files |
<!-- /feature -->
<!-- feature:!candidates -->
| `.sensei/` | The app's own state (queues, records, backups). Safe to ignore | The app |
<!-- /feature -->

## What counts as a fact

<!-- feature:!candidates -->
Only rows in your work records (and your base resume's own lines) can back a claim in a draft. Each row says what you did, when, its limits, and where it came from. Notes, LinkedIn, and other resumes help confirm dates and wording but never add a claim on their own. Nothing is invented: if your records don't say it, the draft doesn't either.
<!-- /feature -->
<!-- feature:candidates -->
Every checked file in a candidate's folder (their base resume, other resumes, LinkedIn, work samples) and every line of your notes can back a claim on its own, as written. Wording may be framed more strongly, but no tool, number, event, or ownership is added that the files don't state. If their files don't say it, the draft doesn't either.
<!-- /feature -->

## Backups

<!-- feature:!candidates -->
Before the app or Agy changes one of your files, a copy goes to `.sensei/backups/`. Your original resumes are never changed.
<!-- /feature -->
<!-- feature:candidates -->
Before the app or Agy changes a file, a copy goes to that folder's `.sensei/backups/`. A candidate's original resumes are never changed. To hand a candidate their folder, use Export in the candidate menu; Delete removes their folder and their Agy history for good.
<!-- /feature -->
