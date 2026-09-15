# Security

## Local Data

JobSensei stores resumes, career context, jobs, transcripts, and generated state under `data/`. That directory is ignored by Git, but users remain responsible for backups, file permissions, and reviewing staged files before publishing.

## Terminal Execution

The embedded terminal launches the user's normal shell at the repository root. Commands entered there can read or change files with the user's operating-system permissions. Review Agy tool requests and never run untrusted commands copied from a job posting or document.

## Secrets

JobSensei v1 does not require API keys. Never commit `.env`, authentication files, or tokens. If a secret is exposed, rotate it immediately; removing it from the latest commit is not sufficient when it exists in Git history.

## Reporting

Open a private security report with the repository owner. Include reproduction steps and affected versions, but do not attach personal resumes, job descriptions, or credentials.
