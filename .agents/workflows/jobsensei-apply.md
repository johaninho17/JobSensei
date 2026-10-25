# JobSensei Apply

## Description

Run the complete application-first JobSensei workflow for one supplied JD without reusing stale conversation claims.

## Steps

1. Invoke `$jobsensei-application-pipeline` with the supplied JD or URL and follow its One-Pass Flow exactly. It is the only detailed contract.
2. Report the returned score, confidence, gate, duration, and at most five warnings, then stop. A warning is a completed run. Do not repair, reread, refresh, or create interview material.

## Command Firewall

Do not execute Python, inline scripts, converter discovery, broad searches, or any command outside `jd:fetch`, `context:snapshot`, and `application:finalize`.
