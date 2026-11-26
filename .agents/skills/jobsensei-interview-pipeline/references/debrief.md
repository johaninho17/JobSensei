# Debrief mode

1. Link raw sources under `data/debrief/<job-id>/` in the round record. Never copy, edit, or move them.
2. Write `debrief_analysis.md`: actual questions and follow-up chains, what worked, weak or unclear answers, questions the prep missed, delivery against `voice.deliveryFixes`, interviewer signals (no pass/fail inference), process and next steps, changes for the next round.
3. Work stories the candidate told that are not yet in their context: list them under `## Proposed interview stories` for the user to confirm into `data/context/structured/interview-stories.md`. Never add them yourself.
4. Mark the round `debriefed`; add reported future rounds to `knownProcess` with `sourceType: reported_by_interviewer`.
5. Update only the matching role-memory record per `interview-memory-contract.md`.
