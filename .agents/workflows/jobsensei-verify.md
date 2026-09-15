# JobSensei Verify

## Description

Independently verify an existing JobSensei application in a fresh Antigravity task.

## Steps

1. Resolve the explicitly named canonical job folder. Do not inspect sibling jobs.
2. Read `.sensei/application_run.json`, the pinned snapshot, constrained draft, public artifacts, and hidden evidence map.
3. Run `npm run application:validate -- <canonical-job-id> --inspect` exactly once. This user-invoked verification does not consume or reset the automatic run budget.
4. Report every structured validation issue grouped by run integrity, factual grounding, resume density/recency, metrics/ownership, and cover-letter chronology.
5. Do not approve the drafting conversation's reasoning as evidence. Validate only the pinned files and selected evidence rows.
6. Do not modify files unless the user explicitly asks for repair. Never refresh the snapshot merely to make existing artifacts pass.
