# JobSensei Apply

## Description

Run the complete application-first JobSensei workflow for one supplied JD without reusing stale conversation claims.

## Steps

1. Invoke `$jobsensei-application-pipeline` with the supplied JD or URL. It is the sole detailed contract; follow its five-item Runtime Read Boundary. Do not read any other skill, reference, resume, context source, existing job, package file, schema, source code, validator, or finalizer implementation.
2. Screen once with exactly six weighted capability rows. Stop below `3.5/5` or on a hard blocker.
3. For an accepted job, run `npm run context:snapshot -- <canonical-job-id>` once and read `.sensei/application_context.json` once.
4. In one pass, write only `.sensei/application_bundle.json`, with evidence IDs inline beside each generated claim.
   Classify important JD language as `supported`, `transferable`, or `unsupported`; only supported candidate capabilities may be stated directly.
   Draft and map only the three technical skills lines. The finalizer supplies the protected Languages line.
5. Run `npm run application:finalize -- <canonical-job-id>` once. It derives the public files and compact hidden verification state.
6. Report the returned score, confidence, gate, and at most five warnings, then stop. A warning is a completed run. Do not repair, reread, refresh, or create interview material.

## Command Firewall

Do not execute Python, inline scripts, converter discovery, broad searches, or any command outside the two supported snapshot/finalization commands.
