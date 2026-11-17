# Privacy and your data

JobSensei runs on your computer. It has no accounts, no servers of its own, and no analytics. This page says what it stores, what leaves your computer, and how to export or delete it.

## What is stored, and where

- **Your workspace folder** (the folder you chose when you set up the app) holds the resumes, career files, notes, job postings, drafts, and evaluations. Nothing in it is uploaded by JobSensei.
<!-- feature:candidates -->
- **One folder per candidate.** Each candidate's resume, career files, recruiter notes, and jobs live in their own folder inside your workspace (`candidates/<name-id>/`). The candidate list and the posting library live in `recruiter/`.
<!-- /feature -->
- **The app's own data folder** holds its settings and Agy's sign-in and conversation history<!-- feature:candidates --> (a separate history for each candidate)<!-- /feature -->.
- Files you add are copied in; your originals are never changed.

## What leaves your computer

- **Job postings you add by link.** The app opens the posting's web page to save a copy, like a browser would.
- **Text Agy reads.** Agy, Google's Antigravity command-line tool, writes the drafts. When it runs, the text it reads (the posting, the base resume, the career files you checked<!-- feature:candidates -->, and recruiter notes<!-- /feature -->) is sent to Google's model under your Google account and Google's terms. JobSensei limits what Agy can open to the workspace<!-- feature:candidates --> of the candidate you have open<!-- /feature -->, and Agy can't change the base resumes in it; it can't change Google's terms.
<!-- feature:jobSearch -->
- **Job Search.** A search sends your search settings (titles, places, keywords; never your resume or career files) to Agy, and the app reads public job lists from job boards (Ashby, Greenhouse, Lever) to check postings are still open.
<!-- /feature -->
<!-- feature:applicationQuestions -->
- **Application questions.** For Greenhouse, Ashby, and Lever postings the app reads the board's public application form to find the written questions.
<!-- /feature -->
- **Update check.** Once per launch the app asks GitHub whether a newer release exists. No personal information is sent.

Nothing else leaves your computer.

## Export and delete

<!-- feature:candidates -->
- **Export a candidate:** Candidate menu → Export saves a .zip of their folder.
- **Delete a candidate:** Candidate menu → Delete. You type their name to confirm. It removes their folder, their Agy history, and their place on the candidate list. Export first if you may need the files.
<!-- /feature -->
<!-- feature:!candidates -->
- **Export a backup:** Settings → Privacy and data → Export backup saves a .zip of your workspace (caches the app rebuilds are left out).
<!-- /feature -->
- **Everything:** your workspace is an ordinary folder. Copy it to keep a backup, or delete it to remove everything. Deleting the app's data folder removes its settings and Agy's sign-in and history.

<!-- feature:candidates -->
## Candidates' information

You are responsible for having each candidate's permission to store their information, to have it processed as described above, and to apply to jobs for them.
<!-- /feature -->

This page describes how the app works. It is not legal advice.
