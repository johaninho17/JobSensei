---
name: jobsensei-job-match
description: Evaluate an existing JobSensei job against its pinned evidence and update the job's single evaluation document without creating a separate match artifact.
---

# JobSensei Job Match

Use `application_context.json.candidateProfile` for current and prior employer identity. Never assume fixed employer names.

Use this skill only for an explicit evaluation or match request on an existing canonical job. New JDs belong to `$jobsensei-application-pipeline`.

Read the job's hidden `.sensei/application_run.json` and `.sensei/application_context.json`. Use only routed evidence rows and never exceed a route's `maximumClassification`. Do not inspect sibling jobs, prior applications, source context outside the pinned application context, or the base resume as factual evidence.

Use the full routed packet, not only rows sharing literal JD terms. For current-employer requirements, check selected non-LinkedIn project rows before LinkedIn; use LinkedIn primarily for corroboration, chronology, education, and older experience.

LinkedIn-only current-employer evidence is capped at `strong_transferable`. Direct credit requires a selected non-LinkedIn eligible project row demonstrating the same action, method, scope, and ownership.

Select the five or six highest-value JD requirements before expanding the complete scoring table. Prioritize material core work over incidental keywords. Copy exact evidence IDs from the pinned snapshot; never invent, shorten, normalize, or reconstruct an ID. A corroboration-required row cannot independently support a `direct` classification; require the documented distinct source-family corroboration or classify it as transferable, unclear, or gap.

Score each distinct capability once. Mark a row material only when it is reasonably needed on entry. Merge preferred tools, employer-specific systems, and learnable domain details into bounded rows instead of repeating them as separate penalties. The same underlying workflow or problem type can earn transferable credit when implementation vocabulary differs; exact tools, outcomes, scope, and ownership remain strict. Use `learning` once for demonstrated ramp readiness, never as a blanket bonus.

Use exactly six capability rows, one for each weighted category. Group genuinely related entry-critical requirements instead of expanding the table. Never score soft adjectives such as rigorous, detail-oriented, collaborative, proactive, or strong communicator on their own; attach them to observable validation, QA, stakeholder, or delivery work.

Classify requirements as:

- `direct`: selected evidence demonstrates the same action, method, scope, and ownership
- `strong_transferable`: the same underlying method or problem type without the exact tool, domain, tier, ownership, or outcome
- `adjacent_transferable`: related foundation without the same central work
- `gap`: no reliable evidence
- `unclear`: contradictory or insufficient evidence

Use deterministic credit of `1.00` for direct, `0.80` for strong transferable, `0.65` for adjacent transferable, `0.25` for unclear, and `0.00` for gap. Multiple strong-transferable core requirements may reach `4.2` when no material core uncertainty or gap exists; adjacent, unclear, and gap core requirements retain progressively lower evidence-sensitive caps.

Update or create only `evaluation.md`. Include the exact `### Requirement Scoring` table from `$jobsensei-application-pipeline`, with category weights totaling 40/25/15/10/5/5 and deterministic classification multipliers. Include the weighted score, gate status, direct matches, transferable evidence, important gaps, relevant employers/projects, and a concise tailoring recommendation. Do not create `job_match.md`, a provenance document, an audit, a README, or a checklist.

Treat the requirement table as the score authority. The finalizer normalizes the visible score and confidence from its deterministic arithmetic. Never inflate the narrative total or confidence above the table result.

Never invent exact tools, domains, metrics, production scope, or ownership. Missing evidence is a gap, not proof that the user lacks the capability.

Secondary resumes are historical discovery and corroboration aids only. They cannot independently contribute score credit or override the canonical baseline. Check LinkedIn when education or older experience is materially relevant.
