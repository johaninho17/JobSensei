# Technical Challenge & Debugging Prep — Plaid IOE

## Round Objectives
- **Assessment Style:** 60-Minute Hands-on Debugging and Architecture Walkthrough.
- **Key Focus:** Troubleshooting a broken partner webhook integration, diagnosing payload schema drift, fixing HTTP 429 rate limit storm issues, and verifying cryptographic HMAC request signatures.

## Core Mindset for Integrations Operations
1. **Never Assume the Partner is at Fault:** First verify our own request headers, timestamps, and payload structure.
2. **Idempotency & Retries:** When APIs fail, how do we guarantee that retrying does not create duplicate charges or double-counted transactions?
3. **Data Partner Diplomacy:** Package reproducible cURL scripts with timestamps and payload hashes so partner engineering teams can immediately reproduce and fix bugs on their end.
