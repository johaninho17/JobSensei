# JobSensei Truth And Run Integrity

Configure this workspace rule as **Always On**.

- For pasted JDs, `$jobsensei-application-pipeline` is the sole authority. Its Runtime Read Boundary is exhaustive; do not load downstream skills, references, implementation files, validators, raw context, resumes, or existing jobs.
- Candidate facts and score credit come only from the current pinned `.sensei/application_context.json`. Respect each row's employer, timeline, scope, eligibility, and classification ceiling.
- The base resume protects identity, chronology, structure, footprint, and career continuity. Use its employer narrative, bullet order, and supported wording as the drafting baseline, but never let it independently prove a claim. Selected context and the denylist override unsupported or exaggerated baseline wording. Conversation memory, prior jobs, old applications, and sibling folders are not evidence.
- Non-LinkedIn structured project evidence leads current-employer claims. LinkedIn and secondary resumes provide bounded corroboration or older history only.
- Always enforce the candidate's configured denylist. Preserve supported scope; never upgrade configuration, testing, integration, support, or enablement into architecture, ownership, production scope, or performance claims.
- Semantic equivalents may support transferable alignment and natural wording. Exact tools, domains, metrics, ownership, production scope, and direct classifications still require exact evidence.
- Classify important JD language as `supported`, `transferable`, or `unsupported`; only supported candidate capabilities may be stated directly.
- Never copy JD terminology into candidate history. Use it only when supported evidence describes the same capability.
- Use selected employer context to describe company scale when appropriate; employer context never proves the candidate's personal work.
- When AI is central to a JD and selected evidence supports AI, agent, model, or ML work, surface that work in experience rather than only Skills. Never infer model building from configuration, testing, integration, support, or enablement.
- Use exactly six scoring categories and the weights defined by the application skill. Keep Fit Score separate from Apply Recommendation.
- Run one snapshot, write one evidence-linked application bundle, and finalize once. A warning is a completed result; never refresh, patch, inspect implementation, or rerun to chase validation.
- The finalizer inserts the canonical Languages line. Never draft, map, route, or investigate evidence for that protected line.
- Never use Python, inline scripts, broad searches, converter discovery, subagents, or sibling-job reads during the default application run.
- Apply `data/context/application_voice_profile.md` last for wording only. It cannot strengthen or create a claim.
