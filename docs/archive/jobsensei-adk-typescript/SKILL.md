---
name: jobsensei-adk-typescript
description: Design, implement, debug, or evaluate JobSensei AI capabilities using TypeScript, Google ADK, or the Gemini SDK. Use for agents, model calls, prompts, tools, sessions, orchestration, structured outputs, career grounding, prompt caching, quota controls, mock interviews, company research, and AI-provider integration.
---

# JobSensei ADK TypeScript

Build evidence-grounded AI capabilities that are local-runtime friendly, inspectable, and economical on Gemini's free tier.

## Verify the environment

1. Read `AGENTS.md`.
2. Inspect installed package versions and current agent code.
3. Consult current official `@google/adk` or Gemini documentation for unstable APIs.
4. Preserve the configured model unless the user requests a model change.
5. Keep Gemini and ADK execution in the local Node backend; never expose keys to React.

Read [references/agent-engineering.md](references/agent-engineering.md) for the capability matrix, agent contract, and free-tier rules.

## Choose the smallest mechanism

Use deterministic TypeScript when the result follows fixed rules. Use a direct structured Gemini call for a bounded transformation. Use an ADK agent only when the model must choose tools, maintain a multi-turn session, or adapt its next action.

Do not create an autonomous agent merely because a step uses an LLM. Prefer an explicit application service for the job pipeline.

## Build grounded generation

1. Define Zod input and output schemas.
2. Retrieve only relevant career evidence.
3. Label evidence with source path and stable identifiers.
4. Require output claims to reference evidence identifiers.
5. Reject unsupported claims and invalid structures before persistence.
6. Preserve user edits and source documents.
7. Store prompt version, model, input hash, and generation metadata with the artifact.

## Protect quota and privacy

- Make expensive generation user-triggered.
- Cache by normalized input, evidence, prompt version, and model.
- Limit concurrency; avoid bursty parallel agents on the free tier.
- Bound agent turns and tool calls.
- Retry transient `429` responses with capped exponential backoff and jitter.
- Surface quota exhaustion without discarding prior results.
- Warn that cloud inference sends selected career content to the provider.

## Evaluate correctly

Use unit tests for schemas, tools, budgets, routing, and persistence. Use representative evaluation cases for grounding, relevance, truthfulness, tool choice, and conversation quality. Never assert exact prose from a nondeterministic model.
