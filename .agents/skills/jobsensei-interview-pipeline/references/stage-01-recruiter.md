# Stage 01: Recruiter Screen Specification

**Stage ID:** `01-recruiter-screen`  
**Stage Name:** Recruiter Screen  
**Duration & Format:** 15–20 minute non-technical screen via phone or Zoom  
**Interviewer Persona:** Talent Acquisition Partner, Recruiter, or Recruiting Coordinator  

---

## 1. Stage Objective & Scope

The Recruiter Screen is an initial operational and qualification filter. The recruiter's scorecard evaluates:
1. Basic communication clarity and professional demeanor.
2. High-level career trajectory arc and genuine role motivation.
3. Checklist verification of core domain, key tools/methods, and customer-facing or stakeholder requirements.
4. Practical logistics: location/commute, compensation expectations, work authorization, and transition timeline.

**The Golden Rule of Round 01:** Keep answers concise (under 60 seconds). Never explain low-level mechanics or architecture, never recite detailed debugging or procedural monologues, and never burn deep problem-solving stories on an initial recruiter call.

---

## 2. Artifact Layout & Content Archetype

This round produces **The 1-Page Recruiter Battlecard**:
- `interviews/01-recruiter-screen/prep.md`: Single-page glanceable battlecard.
- `interviews/01-recruiter-screen/question_bank.md`: Bounded strictly to 6–8 primary questions.
- Company-wide background belongs once at `interviews/company_research.md`. Do not duplicate company research inside this folder unless specific recruiter intel is discovered.

### `prep.md` Required Sections:
1. **45-Second Career Trajectory Arc:** High-level narrative (where the candidate started, how they grew, and why this role is the natural next step).
2. **Core Motivation:** Why this specific company, why this discipline, and why right now.
3. **Logistics Matrix:** 
   - *Target Location / Commute:* Metro area, remote/hybrid status, and physical office access.
   - *Work Authorization:* U.S. work authorized (confirming sponsorship need or lack thereof).
   - *Compensation Band:* Target base + bonus/equity aligned with verified market rates.
   - *Notice Period & Start Date:* Standard transition timeline (e.g., 2–3 weeks).
4. **Qualification Checkboxes:** 4–5 bullet cues confirming daily tool proficiency, customer-facing comfort, and relevant domain background from verified evidence.

---

## 3. `question_bank.md` Structure & Format Standard

The question bank must contain **strictly 6–8 primary questions**:
1. High-level career walkthrough / current focus.
2. Company motivation (why this company now).
3. Role alignment (why this specific job title).
4. Working with external partners, clients, or cross-functional stakeholders (verified scope).
5. Day-to-day stack / tooling checkboxes (proficient tools from verified evidence).
6. Logistics verification (location, compensation, authorization, start timeline).
7. 3–4 Recruiter Reverse Questions (process timeline, team growth targets, onboarding culture).

### Primary Question Card Format:
Never write scripted paragraphs or `Situation -> Action -> Result` monologues. Structure every question card as:

```markdown
### Question <N>: <Question Title>?

* **Core Takeaway:**
  - One punchy sentence summarizing the candidate's core answer.
* **Interviewer Intent:**
  - What the recruiter is checking off their evaluation rubric.
* **Glanceable Talking Cues:**
  - Concise bullet anchor 1 (Context / Positioning).
  - Concise bullet anchor 2 (Concrete tool or verified mechanism).
  - Concise bullet anchor 3 (Real outcome / impact).
* **Truth Boundary & Cautions:**
  - Explicit boundary: what to confirm vs. what not to claim or exaggerate.
```

---

## 4. Strict Prohibitions
- **NO Fabricated Experience:** Never invent client names, incidents, or metrics.
- **NO Scripted Monologues:** Never output text inside quotation marks or write paragraphs for the candidate to memorize.
- **NO Low-Level Mechanics or Trivia:** Zero deep system designs, zero low-level debugging or niche mechanics, zero complex math or algorithmic trivia.
- **NO Recycled Stories:** Do not use retrospective managerial crisis stories here; save those for Round 02.
