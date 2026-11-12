# Your data

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
<!-- feature:interviews -->
| `jobs/<job>/interviews/` | Interview prep for that job, one folder per round | Agy, when you ask for prep |
| `profile/story_bank.md` | Your stories for interviews | Agy drafts it once; you edit |
| `profile/interview_voice.md` | How you speak, and the delivery fixes you're working on | Updated from your recordings |
| `debrief/` | Interview recordings and transcripts, by company, plus practice interviews | You add files |
<!-- /feature -->
| `.sensei/` | The app's own state (queues, records, backups). Safe to ignore | The app |

## What counts as a fact

Only rows in your work records (and your base resume's own lines) can back a claim in a draft. Each row says what you did, when, its limits, and where it came from. Notes, LinkedIn, and other resumes help confirm dates and wording but never add a claim on their own. Nothing is invented: if your records don't say it, the draft doesn't either.

## Backups

Before the app or Agy changes one of your files, a copy goes to `.sensei/backups/`. Your original resumes are never changed.
