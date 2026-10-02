# Recruiter Screen Question Bank & STAR Stories

## Primary Questions for This Round

### Question 1: Tell me about your background and how your career has evolved over the past 8+ years.
- **What it tests:** Senior career trajectory, increasing technical scope, and strategic perspective.
- **Suggested Answer:** Outline your progression from foundational full-stack and REST service development at Cascade Labs into high-throughput streaming pipelines at Kinetics, culminating in leading enterprise partner integrations and webhook reliability at Meridian. Emphasize that 8+ years in integrations has taught you that software always fails at the boundary between two systems, which is where you thrive.

### Question 2: Why Plaid, and why the Integrations Operations Engineering team specifically?
- **What it tests:** Motivation grounded in scale and operational craftsmanship.
- **Suggested Answer:** "Plaid is the gold standard for financial data connectivity. The IOE team sits right where engineering rigor meets partner collaboration. Having led integration adapters handling 45M monthly transactions at Meridian, I know how demanding multi-partner reliability is. I want to bring that experience to Plaid's 12,000-institution network."

### Question 3: Can you share an example of a high-severity production integration bug you led to resolution?
- **What it tests:** Root-cause analysis, system architecture, and operational leadership.
- **Suggested Answer (STAR):**
  - **Situation:** At Meridian, three major enterprise partners began experiencing intermittent webhook drops during peak morning transaction spikes.
  - **Task:** Eliminate data loss and restore delivery reliability without requiring partner code changes.
  - **Action:** Traced Datadog metrics and correlated socket timeouts. Discovered partner gateways enforced strict 800ms timeouts while synchronous DB queries occasionally took 950ms under peak load. I re-architected the delivery layer into an asynchronous Redis worker pool with exponential backoff and randomized jitter, while optimizing PostgreSQL composite indexes to drop query latency by 45%.
  - **Result:** Sustained 99.99% delivery uptime across 45M monthly transactions and cut partner onboarding cycles by 35%.

### Question 4: How do you handle partner engineering teams who insist the bug is on your side?
- **What it tests:** Diplomacy, communication clarity, and technical reproducibility.
- **Suggested Answer:** "I lead with concrete, undeniable data rather than debate. I package an exact reproduction kit: timestamps, request IDs, cURL scripts with headers, and visual diffs showing where their endpoint response diverges from the agreed schema. When partner engineers see a reproducible test case they can execute with one command, defensiveness evaporates and we fix the issue together."

## Questions to Ask the Recruiter
1. How is the IOE team structured between new financial institution onboarding versus maintaining existing connectivity health?
2. What tooling does Plaid use to automatically flag when a bank changes its authentication flows before end-users experience failures in Plaid Link?
3. How does the IOE team collaborate with the Data Partner Relationships (DPR) group when driving technical fixes with tier-1 banks?
