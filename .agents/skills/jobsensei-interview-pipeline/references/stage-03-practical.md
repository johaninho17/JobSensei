# Stage 03: Practical & Peer Evaluation Specification

**Stage ID:** `03-practical-evaluation` (or `03-technical`)  
**Stage Name:** Practical & Peer Evaluation  
**Duration & Format:** 45–60 minute interactive technical/practical assessment via Zoom / IDE / Whiteboard  
**Interviewer Persona:** Senior Peer Practitioner, Staff/Principal Engineer, Senior Solutions Architect, Senior PM, or Senior AE  

---

## 1. Stage Objective & Scope

The Practical Evaluation evaluates live, real-time problem-solving, trade-off analysis, and functional execution:
1. Real-time diagnostic reasoning (can the candidate isolate root causes systematically without guessing?).
2. Architectural or functional system design grounded in first principles.
3. Concrete trade-off evaluation (latency vs. accuracy, cost vs. quality, custom scripting vs. core platform features).
4. Peer-level craft empathy and technical communication.

**The Golden Rules of Round 03:**
- **Zero Retrospective Story Cannibalization:** Round 03 is forward-looking and interactive. Do NOT duplicate the career introduction, motivation, or retrospective behavioral stories from Rounds 01 and 02.
- **Zero Proprietary Over-Fitting:** Real interviewers never test private, unreleased internal company stacks. Ground all scenarios in open, industry-standard patterns and verified candidate knowledge.

---

## 2. Universal Discipline Adaptability

Round 03 automatically adapts terminology, frameworks, and scenarios to the candidate's target discipline:
- **Engineering / AI / Solutions:** *Technical & System Design* — distributed tracing, telemetry pipelines, API data contracts, diagnostic troubleshooting trees, live code walkthroughs.
- **Sales / BDR / Account Executive:** *Role-Play & Pitch Simulation* — discovery questioning (MEDDPICC/BANT), objection handling, live value pitch, and commercial contract boundaries.
- **Product Management:** *Product Sense & Case Study* — customer journey mapping, feature prioritization matrices (RICE), North Star metrics, and cross-functional trade-offs.
- **Operations / Strategy / CS:** *Operational Incident Triage & Scenario Modeling* — SLA breach response, process bottleneck identification, unit economics modeling, and customer de-escalation.

---

## 3. Artifact Layout & Content Archetype

This round produces **The Live Diagnostic & Execution Framework**:
- `interviews/03-practical-evaluation/prep.md`: Live reference frameworks, trade-off matrices, and diagnostic trees.
- `interviews/03-practical-evaluation/question_bank.md`: Bounded strictly to 6–8 practical scenarios or live design problems.
- Company-wide background belongs once at `interviews/company_research.md`. Do not duplicate company research inside this folder.

### `prep.md` Required Sections:
1. **30-Second Technical / Craft Positioning Statement:** Core tools, operating methodology, and engineering/craft philosophy.
2. **Live Decision & Diagnostic Trees:** 2–3 step-by-step diagnostic trees for isolating failure states in live systems.
3. **Trade-Off Matrices:** Concrete trade-off comparisons across speed, reliability, operational complexity, and cost (e.g., deterministic vs. model-based evaluation, synchronous vs. asynchronous telemetry export).
4. **Architectural / Execution Blueprint:** A clean, first-principles ASCII architecture diagram or operational workflow illustrating standard end-to-end data flow.
5. **Peer-Targeted Reverse Questions:** 5–6 high-impact questions on daily practitioner tooling, CI/CD friction, technical debt, and cross-team collaboration.

---

## 4. `question_bank.md` Structure & Format Standard

The question bank must contain **strictly 6–8 practical scenarios**:
1. End-to-end system instrumentation / architecture design.
2. Isolating live latency spikes or performance degradation.
3. Quality gates & evaluation strategies (deterministic checks vs. deep analysis).
4. State boundary enforcement / handling data corruption across steps.
5. Scaling telemetry / throughput architecture under high request loads.
6. Diagnostic network / connectivity troubleshooting across isolated environments.
7. Reverse questions for Peer Practitioners (tooling friction, deployment cadences).

### Primary Question Card Format:
```markdown
### Question <N>: <Scenario / Architecture Prompt>?

* **Core Takeaway:**
  - One concise sentence summarizing the core technical stance or solution.
* **Interviewer Intent:**
  - What the peer interviewer is testing (e.g., diagnostic methodology, trade-off awareness, architectural cleanliness).
* **Diagnostic / Architectural Framework:**
  - Step 1: Boundary isolation / baseline telemetry.
  - Step 2: Decoupling / queuing / asynchronous buffering.
  - Step 3: Mitigation / validation criteria.
* **Trade-Offs & Key Decisions:**
  - Option A vs. Option B (e.g., latency budget vs. token cost).
* **Glanceable Talking Cues:**
  - Punchy 1-line talking trigger 1.
  - Punchy 1-line talking trigger 2.
  - Punchy 1-line talking trigger 3.
* **Truth Boundary & Cautions:**
  - Explicit boundary on scope and candidate background.
```

---

## 5. Strict Prohibitions
- **NO Retrospective Behavioral Stories:** Do not ask or answer "Tell me about a time you..." questions; focus on "How do you design / diagnose / evaluate..." scenarios.
- **NO Proprietary Guesswork:** Never ask the candidate to explain the hiring company's unreleased internal code or private architecture.
- **NO Scripted Monologues:** Keep talking points glanceable and punchy.
