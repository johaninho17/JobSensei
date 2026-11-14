# Troubleshooting

## Agy is waiting and nothing happens

Agy shows its own screens (sign-in, colour scheme, terms, "allow access to this file?") only in **Console**. The panel switches there by itself when Agy is waiting; answer the screen, then go back to Chat. Queued jobs wait until Agy is ready.

## The Agy panel stays empty or says Agy didn't start

The panel says why in red. Use **Restart** in the Agy panel. If it keeps failing, send the app's log: <!-- feature:!candidates -->`JobSensei/logs/main.log`<!-- /feature --><!-- feature:candidates -->`JobSensei Recruiter Edition/logs/main.log`<!-- /feature --> in your app data folder (Mac: `~/Library/Application Support/`; Windows: `%APPDATA%\`).

## "Not signed in" or a sign-in loop

Open the Agy panel and follow the sign-in in Console. If it keeps asking, close the app, open it again, and sign in once more.

## Quota used up

Agy stops until your quota resets. `/usage` shows when. Jobs stay in the queue and continue afterwards.

## A draft says something that isn't true, or misses something real

<!-- feature:!candidates -->
Drafts only use your work records. Add or fix the record (Career context), then run the job again from its ⋯ menu. Editing the draft by hand fixes only that one job.
<!-- /feature -->
<!-- feature:candidates -->
Drafts only use the candidate's files and your notes. Add a line to their notes or fix the file (Profile → Notes or Files), then run the job again from its ⋯ menu. Editing the draft by hand fixes only that one job. A rule for every job (wording, things never to write) goes in Instructions for Agy instead (Settings, or Profile → Settings for one candidate).
<!-- /feature -->

## A posting can't be read

<!-- feature:!candidates -->
Some sites block reading. Paste the posting text into Add jobs instead of the link.
<!-- /feature -->
<!-- feature:candidates -->
Some sites block reading. Paste the posting text on Postings (or in the candidate's Jobs) instead of the link.

## A candidate isn't suggested for a posting

Postings marks why: no base resume yet, the company is on their skip list or is their current employer, they already have this job, or the posting is outside their brief (roles, places, pay floor, sponsorship). You can still tick them.

## A cover letter wasn't written

Letters are off unless you turn them on (Settings, or Profile → Settings for one candidate), and they also need a career story, a writing voice, and two or more files besides the resume. The candidate's Overview says what's missing.
<!-- /feature -->

## The base resume isn't accepted

Use Word (.docx) or Markdown (.md). A PDF only works with a Word or Markdown copy of the same resume beside it.
<!-- feature:interviews -->

## Interview prep tells old facts

Prep uses your current records. If you just changed them, prepare the round again.
<!-- /feature -->
<!-- feature:jobSearch -->

## The scheduled search didn't run

Check Search settings → Schedule is on. A search the computer slept through runs when you open the app or it wakes.
<!-- /feature -->
