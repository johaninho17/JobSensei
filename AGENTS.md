# JobSensei workspace rules

JobSensei is a local-first career workspace. Candidate identity, chronology, preferences, source paths, and truth boundaries come from `data/profile/candidate.json` and the active context manifest. Never assume a particular person, employer, school, location, or filename.

## Core rules

- Never invent candidate experience, tools, dates, metrics, ownership, credentials, projects, or outcomes.
- Treat selected structured career evidence as factual authority. Broad context clarifies; LinkedIn and secondary resumes corroborate history; the base resume protects identity, chronology, structure, and presentation.
- Never modify source resumes or career-context documents.
- Never read sibling jobs, prior tailored applications, or unselected context unless the user explicitly selects or names them.
- Keep evidence IDs, warnings, hashes, and provenance out of employer-facing files.
- Keep candidate-specific guidance in the local ignored profile or context, not in public skills or repository rules.

## New job flow

Use `$jobsensei-application-pipeline` as the sole orchestrator for a pasted JD or job URL. Follow its bounded read list and command budget exactly:

1. Screen once.
2. For accepted jobs, batch intake files.
3. Run `npm run context:snapshot -- <job-id>` once.
4. Read the compact application context once.
5. Write one `.sensei/application_bundle.json` with evidence IDs inline.
6. Run `npm run application:finalize -- <job-id>` once and stop.

Do not inspect implementation code, validators, schemas, package metadata, or other skills during a routine application. Do not use subagents, scratch scripts, manual word-count commands, converter searches, or repair loops. A finalization warning means the drafts are ready for human review.

Default application output is limited to `original_jd.md`, `evaluation.md`, the tailored resume, `cover_letter.md`, `pdfs/`, and hidden `.sensei/` state. Do not create README, checklist, match, change-plan, or separate audit files.

## Interview flow

Use `$jobsensei-interview-pipeline` only after the user explicitly asks to prepare an existing job for an interview. Use `$jobsensei-technical-challenge` only for an explicitly requested challenge or test. A pasted JD never creates interview content.

### Interview Rules & Quality Standards:
- **Universal Role Agnosticism (For Anyone in Any Field):** JobSensei serves candidates across Engineering, Sales, Product Management, Operations, Customer Success, Marketing, and Finance. Every stage and scenario must adapt naturally to the target discipline without assuming software engineering terminology:
  - *Sales / BDR / Commercial:* Territory planning, cold outreach, objection handling, qualification frameworks (MEDDPICC/BANT), deal velocity, pipeline generation, and customer pitch simulations.
  - *Product Management:* User journey mapping, North Star metrics, feature prioritization (RICE), cross-functional consensus, PRD design, and product sense case studies.
  - *Operations / Strategy / Finance:* Process bottleneck identification, unit economics, supply chain modeling, vendor negotiation, and spreadsheet scenario modeling.
  - *Customer Success / Implementation:* Account onboarding escalations, churn prevention, QBR presentations, and customer relationship recovery.
  - *Engineering / Technical:* First-principles system design, distributed data contracts, diagnostic troubleshooting, and code walkthroughs.
- **Zero Proprietary Over-Fitting / First-Principles Standard:** Never ask, expect, or coach a candidate to explain the hiring company's internal, proprietary architecture, private backend systems, or unreleased product roadmap. Real interviewers test generalizable domain principles, problem-solving methodology, and the candidate's own past career track record. Always frame questions around industry-standard concepts and the candidate's verified evidence.
- **Strict Story Partitioning & Zero Cannibalization:** Never duplicate the same primary STAR stories or anecdotes across multiple rounds. A candidate cannot tell the Hiring Manager in Round 02 the exact same 3 stories they tell in Round 03. When preparing any round, inspect all preceding rounds to construct an explicit non-overlap boundary—never re-ask prior questions, never recycle the same career anecdotes, and never repeat reverse questions:
  - *Round 01:* High-level career trajectory arc, checklist stack verification, and compensation/location logistics. Zero deep architecture monologues.
  - *Round 02:* Deep ownership under ambiguity, handling customer/stakeholder pushback, prioritization under tight deadlines, and 30-60-90 day impact.
  - *Round 03:* Live interactive problem-solving, trade-off analysis, domain frameworks, and live simulations. Focus on real-time execution rather than retrospective story monologues.
  - *Round 04:* Strategic market alignment, executive vision, culture add, and high-impact macro business outcomes.
- **Differentiated Reverse Questions by Persona:** Reverse questions must be strictly unique to the target interviewer persona:
  - *Recruiter:* Hiring process milestones, team growth rate, and onboarding expectations.
  - *Hiring Manager:* Team operating cadences, managing client escalations, and balancing custom field requests against core roadmaps.
  - *Practical / Peer:* Real-world day-to-day tooling bottlenecks, domain standards, and cross-functional peer collaboration.
  - *Executive:* Long-term market positioning, 2-to-3-year company vision, and key strategic priorities.
- **No Scripted Pitches or Direct Quotes:** Never generate verbatim monologue scripts or answers in quotation marks. Output must be structured as glanceable, punchy bullet points (Context -> Concrete Tool/Action -> Real Outcome) that candidates use as memory anchors while speaking naturally.
- **Strict Stage Isolation (The 4 Canonical Rounds):**
  1. `01-recruiter-screen`: 15–20 min non-technical filter. Bounded to 6–8 questions covering background arc, role motivation, checklist qualifications, logistics (location, comp band, authorization, timeline), and reverse questions. Zero low-level architecture or debugging scenarios.
  2. `02-hiring-manager`: 30–45 min manager screen. Bounded to 8–10 questions covering end-to-end ownership, cross-functional collaboration, navigating ambiguity, and 30-60-90 day thinking.
  3. `03-practical-evaluation`: Role-aware assessment bounded to 6–8 practical scenarios. Uses role-appropriate terminology (e.g., "Role-Play & Pitch Simulation" for BDR/Sales; "Technical & System Design" for Engineering; "Product Sense & Case Study" for PM; "Scenario Modeling" for Ops).
  4. `04-final-panel`: 30–45 min leadership round bounded to 6–8 strategic questions covering mission alignment, culture fit, and executive reverse questions.
- **Cognitive Bounds & Glanceability:** Strip internal audit metadata (`Category`, `What it tests`, `Evidence Anchor`, `Scope Boundary`) from primary question cards. Keep answers immediately scannable in under 5 seconds during live calls.
- **Zero Corporate/AI Filler:** Strictly enforce the anti-slop dictionary. Ground all points in verified candidate evidence without corporate jargon or exaggerated titles.
- **Evidence Integrity:** Interview research may use current public sources when requested, but external information cannot become candidate career evidence. Transcripts are performance records, not factual career sources.

## Engineering work

Inspect the current implementation before editing, preserve unrelated changes and private data, keep Electron/renderer interfaces narrow, and run proportionate tests. Do not publish or deploy without explicit user authorization.

See `PRODUCT_FLOWS.md` for the user-facing workflow map and safe skill-customization guidance.
