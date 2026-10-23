# Stage 02: Hiring Manager Screen Specification

**Stage ID:** `02-hiring-manager`  
**Stage Name:** Hiring Manager Screen  
**Duration & Format:** 30–45 minute management & ownership interview via Zoom  
**Interviewer Persona:** Functional Manager, Practice Lead, Director, VP, or Department Head  

---

## 1. Stage Objective & Scope

The Hiring Manager round evaluates how the candidate thinks, operates, and executes in the real world:
1. End-to-end ownership of client engagements, projects, or workflows.
2. Handling ambiguity when requirements are unformed or customer goals are vague.
3. Troubleshooting and problem deconstruction under deadline pressure.
4. Managing concurrent accounts and ruthless time/milestone prioritization.
5. Cross-functional collaboration and navigating customer or stakeholder pushback.
6. 30-60-90 day execution vision and team ramp trajectory.

---

## 2. The Cardinal Rule: Generalize the Framework, Anchor Truthfully, Never Fabricate Outages

### ❌ The Old Defect (Hyper-Specific Hallucinations & Scripted Bullets):
In earlier versions, the AI took fragmented local development notes (e.g., local Docker port conflicts 5434/5435 or variable names) and invented fake, high-drama enterprise customer outages, formatting them into rigid `Situation -> Action -> Result` mini-scripts. **This is strictly prohibited.**

### ✅ The Required Standard (Generalized Methodology + Real Evidence Anchor):
Hiring managers do not expect a rehearsed Hollywood crisis monologue. They evaluate your **generalizable decision frameworks and operating philosophy**:
- **Interviewer Intent:** What the manager is actually testing (e.g., systematic isolation vs. panic/guessing; transparent communication).
- **Generalizable Mental Model (The Framework):** The universal, adaptable 3-to-4 step approach the candidate takes when facing this type of problem.
- **Truthful Real Anchor:** Grounding in the candidate's actual, verified background from `data/context/` (e.g., Docker container configuration, API scripting, Looker dashboard queries, partner discovery calls). Never inflate a local setup note into a customer-facing crisis!
- **Glanceable Talking Cues:** 3–4 punchy, natural bullet prompts that serve as glanceable memory anchors during live Zoom calls.

---

## 3. Artifact Layout & Content Archetype

This round produces **The Managerial Ownership & Decision Playbook**:
- `interviews/02-hiring-manager/prep.md`: Comprehensive strategy playbook.
- `interviews/02-hiring-manager/question_bank.md`: Bounded strictly to 8–10 questions.
- Company-wide background belongs once at `interviews/company_research.md`. Do not duplicate company research inside this folder.

### `prep.md` Required Sections:
1. **Executive Career Introduction & Operating Philosophy:** 45–60 seconds on the candidate's authentic career evolution, why they chose this discipline, and their personal operating principles.
2. **Core Generalizable Decision Frameworks:**
   - *Framework A (Ambiguity Deconstruction):* Translating vague stakeholder or customer desires into baseline success criteria, measurable metrics, and verifiable milestones.
   - *Framework B (Systematic Diagnostic Triage):* Isolating failure points, establishing baseline reproductions or root-cause metrics, and maintaining proactive stakeholder updates.
   - *Framework C (Prioritization & Velocity):* Triaging by blocker severity, transparent asynchronous updates, and dedicated deep-work blocks.
   - *Framework D (Managing Customer / Stakeholder Pushback):* Listening without defensiveness, root-cause investigation, temporary unblocking workarounds, and cross-functional alignment.
3. **Truthful Evidence Anchors:** Inventory of verified projects from `data/context/` mapped to these frameworks with strict truth boundaries.
4. **First 30-60-90 Day Execution Plan:** Realistic, high-impact ramp milestones tailored to the target role.
5. **Manager-Targeted Reverse Questions:** 5–6 high-impact questions on team dynamics, management cadences, and product feedback loops.

---

## 4. `question_bank.md` Structure & Format Standard

The question bank must contain **strictly 8–10 primary questions**:
1. Career walkthrough tailored to leadership (operating philosophy and transition drivers).
2. End-to-end initiative, account, or engagement ownership (discovery/scoping through execution and value delivery).
3. Handling ambiguity when a customer or stakeholder brings ill-defined or shifting requirements.
4. Systematic diagnostic troubleshooting or problem resolution under pressure (framework + truthful anchor).
5. Prioritizing concurrent accounts/workstreams and maintaining execution velocity.
6. Handling customer or stakeholder pushback on constraints, delivery trade-offs, or timeline friction.
7. Balancing bespoke customer concessions or custom requests against scalable core products, processes, or roadmaps.
8. A project or campaign that did not go as planned / course-correcting a key operational or strategic decision.
9. 30-60-90 day execution vision for this specific team.
10. Reverse questions for the Hiring Manager (cadences, team friction, cross-functional feedback loops).

### Primary Question Card Format:
```markdown
### Question <N>: <Question Title>?

* **Core Takeaway:**
  - One clear sentence summarizing the candidate's core operating stance.
* **Interviewer Intent:**
  - What the hiring manager is evaluating (e.g., emotional resilience, systematic deconstruction, ownership).
* **Generalizable Framework (Mental Model):**
  - Step 1: Deconstruct / Isolate / Clarify.
  - Step 2: Validate / Minimal Reproduction / Concrete Milestone.
  - Step 3: Communicate / Collaborate / Deliver.
* **Truthful Career Anchor:**
  - Ground in candidate's actual verified evidence from `data/context/` without inflating scope or inventing fake customer drama.
* **Glanceable Talking Cues:**
  - Punchy 1-line talking trigger 1.
  - Punchy 1-line talking trigger 2.
  - Punchy 1-line talking trigger 3.
* **Truth Boundary & Cautions:**
  - Specific boundary on what not to claim or exaggerate.
```

---

## 5. Strict Prohibitions
- **NO Fabricated Incidents:** Never invent fake customer names, fake outages, fake bugs, or fake port collisions.
- **NO Canned `Situation -> Action -> Result` Mini-Scripts:** Present frameworks and glanceable cues, not verbatim monologues.
- **NO Lectures on Proprietary Systems:** Do not coach the candidate to lecture the manager on their own private internal systems.
