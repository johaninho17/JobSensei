# Technical Challenge Brief: Bank Webhook Rate-Limit & Signature Mismatch

## Scenario
A regional banking partner ("First National Trust") reports that Plaid's webhook ingestion engine has stopped acknowledging transaction synchronization events. Inbound transactions for thousands of joint accounts are delayed, triggering customer support tickets.

## Telemetry Symptoms
1. **HTTP 401 Unauthorized:** 60% of incoming webhooks from First National fail with `ERR_INVALID_SIGNATURE`.
2. **HTTP 429 Too Many Requests:** When Plaid attempts to retry failed synchronizations, First National’s gateway returns 429 rate limit errors, causing an exponential pile-up in the backlog.

## Engineering Tasks
- **Task 1 (Signature Verification):** Inspect the HMAC-SHA256 signature verification middleware. Discover why timestamp drift or raw payload encoding is causing valid bank signatures to be rejected.
- **Task 2 (Resilient Ingestion & Backoff):** Implement an adaptive retry mechanism with token bucket rate-limiting and jitter to prevent thundering-herd retry storms against First National's rate-limited API gateway.
- **Task 3 (Partner Communication):** Draft a concise, technical incident update to First National's API engineering team detailing the root cause, immediate mitigation, and joint prevention plan.
