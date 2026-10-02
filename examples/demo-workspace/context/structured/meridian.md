# Evidence: Meridian Cloud Systems Career Records

- source_path: `context/broad/meridian_systems.txt`
- source_family: `meridian-systems`
- source_role: primary-context-summary-index
- years: 2021-2026
- projects: Partner Gateway, High-Throughput Webhooks, Automated Probes, Escalation Architecture
- confidence: high
- source_locator: Evidence table rows keyed by Evidence ID

## Evidence Inventory

| Evidence ID | Year | Project | Explicit claim | Scope note | Source locator | Confidence | Public use |
| --- | --- | --- | --- | --- | --- | --- | --- |
| context:meridian:2021:connectors | 2021-2026 | Partner Gateway | Architected and scaled TypeScript and Go integration adapters connecting Meridian's core platform to 25+ external partner REST APIs, processing over 45M monthly transactions. | Lead solutions engineer; designed adapter interface, schema validators, and data pipelines. | Architecture Spec #610 | high | eligible |
| context:meridian:2022:uptime-debug | 2021-2026 | Distributed Debugging | Diagnosed complex API authentication, schema drift, and cross-service data execution failures across distributed container environments, sustaining 99.99% partner uptime. | Led technical triage sessions with partner engineering leaders. | Incident Log 2023-Q4 | high | eligible |
| context:meridian:2023:synthetic-probes | 2023 | Endpoint Monitoring | Automated endpoint health verification using Python test suites, Postman collections, and synthetic probes to preemptively detect upstream partner regressions. | Designed synthetic probe infrastructure in AWS/Datadog. | QA Architecture Doc | high | eligible |
| context:meridian:2023:retry-engine | 2023 | Webhook Delivery | Designed a high-volume payload validation and webhook retry pipeline using Redis, Node.js, and exponential backoff, preventing event drop-offs during partner outages. | Lead implementer of delayed retry workers with DLQ. | PR #2401 Webhook Engine | high | eligible |
| context:meridian:2024:partner-guides | 2024-2026 | Partner Enablement | Spearheaded the technical triage workflow for partner escalations, authoring architectural integration guides that reduced enterprise onboarding cycles by 35%. | Technical author and partner architectural liaison. | Meridian Developer Portal | high | eligible |

## Corroboration & Scope Boundaries
- 45M monthly transaction scale and 99.99% uptime are verified through Datadog platform reports.
- While leading the partner integration squad, acknowledge cross-functional collaboration with platform SRE and product teams.
