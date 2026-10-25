# JobSensei workspace rules

JobSensei is a local-first career workspace. Candidate identity, chronology, preferences, source paths, and truth boundaries come from `data/profile/candidate.json` and the active context manifest. Never assume a particular person, employer, school, location, or filename.

## Core rules

- Never invent candidate experience, tools, dates, metrics, ownership, credentials, projects, or outcomes. Frame real work confidently, but every claim must be defensible in an interview.
- Treat selected structured career evidence as factual authority. Broad context clarifies; LinkedIn and secondary resumes corroborate history; the base resume protects identity, chronology, structure, and presentation.
- Unchanged base-resume bullets are the candidate's own approved claims and may appear word for word, but they earn no fit-score credit, and any rewritten or new claim must trace to evidence in the current `application_context.json`. Conversation memory, prior jobs, and old applications are never evidence.
- Always enforce the candidate's denylist. Never upgrade configuration, testing, integration, support, or enablement into architecture, sole ownership, production scope, or performance claims.
- Classify important JD language as supported, transferable, or unsupported. State only supported capabilities directly, and never copy JD terminology into candidate history.
- When AI is central to the JD and the evidence supports AI, agent, or model work, show that work in experience bullets, not only in Skills.
- Apply the candidate's voice profile (`styleRules`) last, for wording only; it cannot create or strengthen a claim.
- Never modify source resumes or career-context documents.
- Never read sibling jobs, prior tailored applications, or unselected context unless the user explicitly selects or names them.
- Enforce the Universal Surgical Diffing Standard: Never rewrite historical or earlier career experience unless explicitly relevant. Keep foundational past roles frozen verbatim from the base resume, focusing tailoring strictly on the top skills categories and the 3–4 target bullets at the current/most recent employer.
- Keep evidence IDs, warnings, hashes, and provenance out of employer-facing files.
- Never name clients or partners in a resume or cover letter (see the profile's `truth.confidentialNames`); describe them by industry instead.
- The cover-letter specification lives only in the generated `coverLetterBrief`; skills point to it.
- Keep candidate-specific guidance in the local ignored profile or context, not in public skills or repository rules.

## New job flow

Use `$jobsensei-application-pipeline` as the sole orchestrator for a pasted JD or job URL. It owns the steps: `jd:fetch` for a URL, one snapshot (which prints the context), one `.sensei/application_bundle.json` write, one finalize, then stop. Target: under 60 seconds.

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
  - *Hiring Manager:* Team operating cadences, managing stakeholder/client escalations, and balancing bespoke customer requests against core roadmaps and workflows.
  - *Practical / Peer:* Real-world day-to-day tooling bottlenecks, domain standards, and cross-functional peer collaboration.
  - *Executive:* Long-term market positioning, 2-to-3-year company vision, and key strategic priorities.
- **No Scripted Pitches or Fake Incidents (Generalize Frameworks, Anchor Truthfully):** Never generate verbatim monologue scripts, quotation marks, or canned STAR mini-scripts. Never invent fake customer outages, imaginary partner crises, or fake technical parameters out of local development notes. Structure preparation around **Generalizable Decision Mental Models**, **Truthful Real Evidence Anchors**, and **Glanceable Talking Cues** that candidates use as cognitive anchors while speaking naturally in their own authentic voice.
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
