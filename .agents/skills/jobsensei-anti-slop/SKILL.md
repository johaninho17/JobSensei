---
name: jobsensei-anti-slop
description: Definitive standards and dictionary for eliminating AI clichés, machine filler, and corporate slop from JobSensei applications.
---

# Anti-AI Slop & Natural Professional English Guide

JobSensei produces applications that read like they were written by an experienced, articulate practitioner speaking directly to a peer hiring manager. AI-generated text has well-known linguistic tells that recruiters and department leads immediately flag as insincere, low-effort, or machine-synthesized.

This guide provides hard rules and replacement tables to keep JobSensei text natural, grounded, and human.

---

## 1. Banned AI Vocabulary (The Slop Dictionary)

Never use these words in resumes, cover letters, or interview responses unless they are part of a literal proper noun or API name.

| Slop Word / Phrase | Why It Signals AI | Human Engineering Alternative |
| :--- | :--- | :--- |
| **Delve / Delve into** | Classic LLM filler verb. Almost never used by engineers in casual speech. | *Investigated, analyzed, studied, examined, debugged, inspected* |
| **Leverage / Leveraging** | Corporate jargon overused by models to avoid naming concrete actions. | *Used, applied, ran, built with, called, configured* |
| **Utilize / Utilization** | Pretentious replacement for "use". | *Used, ran, employed* |
| **Navigate / Navigating** | Metaphorical filler used when the model doesn't know the exact mechanism. | *Resolved, addressed, handled, coordinated, managed* |
| **Empower / Empowering** | Empty HR buzzword that claims vague positive influence without proof. | *Enabled, trained, unblocked, allowed, automated* |
| **Enhance / Enhancing** | Vague positive filler without a concrete baseline or delta. | *Improved, accelerated, reduced, raised, refactored* |
| **Showcase / Showcasing** | Passive, portfolio-speak rather than real engineering ownership. | *Demonstrated, presented, validated, proved* |
| **Facilitate / Facilitating** | Passive corporate verb hiding who actually did the work. | *Organized, ran, coordinated, led, unblocked* |
| **Unlock / Unlocking** | Marketing hyperbole. | *Enabled, allowed, provided access to* |
| **Propel / Propelling** | Melodramatic verb unsuited for technical delivery. | *Accelerated, advanced, scaled* |
| **Spearhead / Spearheaded** | Heavily overused resume cliché. | *Led, directed, initiated, built, launched* |
| **Pivotal / Crucial** | AI uses this to artificially inflate importance without metrics. | *Key, core, central, primary* (or omit entirely) |
| **Robust / Seamless** | Empty praise words. Every system in AI output is "robust and seamless". | *Reliable, fault-tolerant, automated, low-latency, resilient* |
| **Transformative** | Hype word that hiring managers ignore. | *Measurable, high-impact* (show the result instead) |
| **Comprehensive** | Filler adjective used to pad bullet length. | *Full, end-to-end, thorough, detailed* (or omit) |
| **Intricate / Intricacies** | Used when the model wants to sound smart about complex things. | *Complex, distributed, detailed, technical mechanics* |
| **Cutting-edge / Bespoke** | Marketing fluff. | *Modern, custom, production, specialized* |
| **Landscape / Tapestry / Realm** | Statistically ubiquitous LLM nouns. | *Domain, ecosystem, architecture, system, industry, field* |
| **Intersection (At the intersection of)** | Formulaic AI cliché used to connect two skills. | *Combining X and Y, working across X and Y* |
| **Synergy / Synergize** | Universally mocked business buzzword. | *Collaboration, coordination, alignment, integration* |
| **Beacon / Catalyst / Testament** | Pure literary AI fluff. | *Example, foundation, driver, proof, demonstration* |

---

## 2. Banned Sentence Structures & Clichés

### A. The "Rule of Three" Corporate Slogan
AI models reflexively generate symmetrical clauses of three items:
* ❌ *Slop:* "Fostering team collaboration, driving system scalability, and enhancing developer efficiency."
* ✅ *Human:* "Automated build pipelines to reduce developer onboarding time from two days to three hours."

### B. The AI Contrast Scaffold ("Not X, but Y")
Models love grand philosophical contrasts:
* ❌ *Slop:* "I view solutions engineering not just as delivering APIs, but as architecting transformative bridges between human need and code."
* ✅ *Human:* "I enjoy solutions engineering because it bridges complex API architectures with direct client problem-solving."

### C. The Em-Dash Symmetrical Split
Models overuse em-dashes (`—`) to balance two poetic halves of a sentence:
* ❌ *Slop:* "Engineered real-time data streaming pipelines—ensuring zero-loss persistence while empowering downstream analytics."
* ✅ *Human:* "Engineered real-time PostgreSQL data streaming pipelines with zero-loss persistence for downstream Looker reporting."

### D. The Cliché Openers
* ❌ *Slop:* "In today's fast-paced, ever-evolving landscape..."
* ❌ *Slop:* "I am writing to express my eager enthusiasm for the position of..."
* ❌ *Slop:* "As a professional dedicated to driving innovation..."
* ✅ *Human:* "I am writing to apply for the [Role] at [Company] because my focus is solving friction at the boundary between internal teams and external stakeholders."

### E. The Corporate CEO Keynote Speech / Lecturing the Employer
Models reflexively lecture the target company about why their own industry, business, or role matters, or parrot the job description qualifications back to them as grand declarations:
* ❌ *Slop:* "For Google and the Product Solutions Engineer role, delivering seamless digital payment experiences requires both deep API fluency and the ability to guide external merchants through complex architecture decisions."
* ❌ *Slop:* "In consumer payments, trust and frictionless checkout are the lifeblood of modern commerce."
* ❌ *Slop:* "Effective talent acquisition requires a nuanced balance of strategic sourcing and human empathy."
* ✅ *Human:* "When third-party developers integrate external APIs, the hardest challenge is rarely the internal code—it is what happens at the boundary when external teams hit confusing payload errors, sandbox edge cases, or documentation gaps that stall production launches."
* ✅ *Human (HR):* "When an organization scales past 200 employees, the most common recruiting bottleneck is rarely sourcing volume—it is misaligned interview scorecards and slow hiring manager feedback loops that cost teams their strongest candidates."

---

## 3. Human Engineering Writing Principles

1. **Be Concrete, Not Descriptive:**
   Instead of claiming you are a "results-driven, proactive problem-solver", describe what broke, what tool you used to diagnose it, and what the outcome was.
2. **Name the Mechanism:**
   Always pair an action with the mechanism:
   - ❌ "Optimized database performance."
   - ✅ "Added compound indexes and pruned redundant joins in PostgreSQL to drop query latency by 35%."
3. **The "Coffee Test":**
   Read the sentence aloud. Would you say this to another engineer over coffee? If it sounds like a press release or an HR brochure, rewrite it.
4. **Chronological Honesty (Journey over Inventory):**
   In cover letters, describe the authentic arc: what you started doing (e.g. backend code, databases), what pulled you toward your current focus (e.g. client architecture, developer enablement), and why this specific role is the logical next problem you want to tackle.
