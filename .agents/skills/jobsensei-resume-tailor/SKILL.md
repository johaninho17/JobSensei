---
name: jobsensei-resume-tailor
description: Revise an existing JobSensei public resume from pinned career evidence without creating change plans or audit documents.
---

# Lean JobSensei Resume Tailor

Use the candidate profile fields exposed in `application_context.json.candidate` and `resumeTemplate` for the artifact prefix, career direction, employer structure, and preferences. Never assume fixed names or employers.

Use this skill only when the user explicitly asks to revise a resume for an existing canonical job. New JD runs are owned entirely by `$jobsensei-application-pipeline`.

Read `.sensei/application_run.json`, `.sensei/application_context.json`, `original_jd.md` (fall back to `original_jd.txt` for legacy workspaces), `evaluation.md`, and the current public resume. Do not read sibling jobs, previous tailored resumes, fallback references, or raw context outside the pinned application context.

Revise only the resume section of `.sensei/application_bundle.json`, keeping exact routed evidence IDs beside every edited skills line and bullet. Finalization derives the legacy draft and evidence map.

Do not create `resume_change_plan.md`, `resume_audit.json`, `resume_audit.md`, README, checklist, or a second resume filename.

Requirements:

- Context evidence is the factual authority; the base resume controls identity, chronology, structure, and footprint only.
- Do not copy or classify every canonical bullet. Build from selected evidence and evaluation, then use the baseline for protected structure, footprint, and independently supported career continuity. Profile career anchors provide grounding, not a copied-wording quota.
- Follow `.sensei/application_context.json.resumePlan` as the run's deterministic allocation. Keep 10-14 experience bullets; when the plan targets 13 or 14, do not fall back to 12 merely because the prose is concise.
- If `resumePlan.customerFacingRole` is true, satisfy `targetCurrentEmployerCustomerBullets` using only `customerFacingEvidenceIds`. Balance those bullets with technical current-employer work.
- Follow the plan's allocation and profile preferences while preserving employer boundaries, timeline scope, and denylist limits.
- Use the profile's current-employer and total bullet ranges. Do not add a duplicate or unsupported bullet merely to reach a range.
- Rank evidence by JD relevance (40%), evidence strength (25%), verified recency (20%), and role representation (15%). Relevance and truthfulness come before recency.
- For the current employer, prefer selected non-LinkedIn structured project evidence. LinkedIn corroborates chronology and older-role or education history; it must not replace richer project evidence because its wording overlaps the JD.
- Treat only evidence with `isOngoing: true` as current. Completed current-year work is recent and cannot be presented as a continuing responsibility.
- Lead the current employer with current or recent relevant work, then use older directly relevant technical foundation. Never merge separate projects into a fabricated current function.
- Reorder supported career anchors first, then rewrite only the highest-value bullets naturally for the JD. Treat canonical original bullets as non-evidence language references. Preserve the selected claim's action, object, employer, timeline, ownership, and scope; the JD may change priority and supported terminology, not the meaning of the work.
- Select the five or six highest-value requirements first. Copy exact evidence IDs from the pinned snapshot; never construct shorthand IDs, and never treat one corroboration-required row as direct proof.
- Tailor in order: reorder supported material, replace generic wording with concrete evidence, add exact supported JD terms naturally, then apply `context/application_voice_profile.md` as a wording-only pass.
- Treat the highest-priority evaluation requirements as emphasis guidance, not a requirement to make every line imitate the JD. Make at least three substantive evidence-backed choices; unsupported requirements never become keywords in candidate history.
- For each accepted job, visibly change emphasis through evidence choice, bullet order, or substantive wording where selected evidence supports it. Curate skills and bullets across relevant employers within truthful source bounds. A synonym replacement, keyword insertion, or copied unsupported baseline bullet does not count.
- Tailor for ATS and human review by classifying important JD terms as `supported`, `transferable`, or `unsupported`. Begin with the candidate's supported wording and add at most one or two exact supported JD terms where useful; do not rewrite the bullet around the JD. For transferable requirements, state the strongest supported underlying capability without implying the exact unsupported tool, tier, domain, or scope.
- Treat semantic evidence as valid when it supports the same capability, but never infer a named tool or elevated responsibility from a generic activity. Do not convert troubleshooting into Tier 2/3 support, task tracking into JIRA, responsiveness into SLA compliance, customer work into Salesforce/community ownership, or analytics exposure into production ownership.
- Keep skills role-specific and bounded. Preserve the categories in `resumeTemplate.editableSkillCategories`. Treat those headings as envelopes whose contents are curated from supported evidence, not as static boilerplate. Skills lines list concrete tools, platforms, frameworks, languages, and competencies rather than job-duty phrases.
- Tell the authentic career story defined by the candidate profile and selected evidence. Describe supported work and technical mechanics rather than parroting the JD.
- Use plain skills headings and concrete items. Omit decorative categories and unsupported phrases such as `Prompt Architecture`, `Fullstack Feature Shipping`, or production scope that exists only in the JD or base resume.
- Start each rewritten bullet with a natural, accurate action and name the concrete tool or mechanism. Include purpose or result only when the evidence states it; do not force a fixed verb list or invent an outcome to complete a writing formula.
- When AI or machine learning is a top requirement and the routed packet contains eligible AI, agent, model, or ML evidence, place at least two distinct supported examples in experience across the relevant employers. Do not satisfy the requirement only through Skills, and do not turn configuration, testing, integration, troubleshooting, or enablement into model building or production ownership.
- Read the routed context footprint before drafting and allocate the experience content budget across the canonical employers. Target 100-110% of total baseline words and 95-105% of baseline experience words when enough selected evidence exists. For the current template, useful bullets will normally average about 16-21 words.
- If concise wording is sparse, add another distinct evidence-backed bullet before lengthening existing bullets. Follow the employer targets in `resumePlan`; only then deepen existing bullets with supported action, method, scope, purpose, and qualitative impact.
- Never add filler, repeat a claim, or invent detail merely to fill the PDF.
- Never combine evidence from separate projects into one apparently continuous accomplishment. Keep exact unsupported employer tools out of skills and experience; use the truthful underlying transferable capability instead.
- Do not invent technologies, domains, metrics, ownership, seniority, or outcomes.
- Keep suggested unconfirmed bullets or metrics only in the hidden evidence map.
- Preserve one-page intent. A slight two-page draft is acceptable for user editing and must be reported as a warning, not trigger an automatic rewrite loop.
- Preserve the canonical format exactly. Revise only skills-line content and experience-bullet content; never rewrite headers, contact details, employer metadata, education, section order, or formatting.
- The voice pass may simplify jargon, slogans, abstract language, and model-like phrasing. It must not change facts, scope, ownership, timeline, tools, metrics, outcomes, or evidence mappings.
- Use secondary-resume `contextText` only to locate relevant older history that selected structured evidence or LinkedIn corroborates. A secondary resume cannot independently support a public bullet, score, metric, or ownership claim and cannot override canonical protected fields.

Never place candidate identity, contact details, titles, dates, locations, education, or section structure in the bundle. After one explicit revision, run `npm run application:finalize -- <job-id> --review` once and stop.
