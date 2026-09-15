# Agent engineering

## Capability selection

| Capability | Preferred mechanism |
|---|---|
| File parsing, hashing, validation, scoring arithmetic | Deterministic TypeScript |
| Job description extraction | Direct structured Gemini call |
| Evidence-to-requirement mapping | Direct structured call plus validator |
| Resume bullet tailoring | Direct structured call plus template/evidence checks |
| Cover letter and evaluation report | Direct structured call |
| Stateful mock interview | ADK LLM agent |
| Company research with controlled tools | ADK LLM agent |
| Cross-job coaching | ADK LLM agent after enough source data exists |
| Pipeline sequencing | Explicit application service |

## Agent contract

Every ADK agent must define:

- Name and single responsibility
- Typed inputs and outputs
- Prompt version and configured model
- Allowed tools and tool-call limit
- Maximum model turns
- Required evidence scope
- Persistence behavior
- Failure and cancellation behavior
- Representative evaluation cases

## Grounding contract

Represent retrieved evidence with stable IDs, source paths, excerpts, and confidence. Require generated factual claims to cite evidence IDs. Treat inferred fit, advice, and company interpretation as inference rather than candidate fact.

## Free-tier controls

- Default to one active model request.
- Avoid automatic fan-out.
- Reuse normalized career summaries and cached artifacts.
- Hash the JD, evidence selection, prompt version, schema version, and model.
- Bound input context to evidence relevant to the current capability.
- Allow cancellation and retain the last valid artifact.

## TypeScript ADK discipline

The JavaScript ADK changes quickly. Verify imports and constructor signatures against the installed package and official TypeScript documentation. Do not translate Python examples mechanically. Wrap framework objects behind JobSensei interfaces so provider or ADK changes stay localized.
