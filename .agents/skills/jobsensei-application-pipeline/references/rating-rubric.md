# Application Rating Rubric

Produce a calibrated `Fit Score` and a separate `Apply Recommendation`. The Fit Score measures demonstrated evidence; the recommendation decides whether a credible transferable path makes the role worth applying to. A positive recommendation never increases the Fit Score.

The rows, columns, and classification meanings are defined in the pipeline skill's Evaluation Table section (one row per posting requirement). The app owns the arithmetic: category weights (core 40, technical 25, scope 15, outcomes 10, domain 5, learning 5, rescaled when a posting has nothing for a category), credit per classification (`src/shared/fit-credit.ts`), the evidence check against the posting's wording, core caps, and the gate.

A title, base-resume wording, generic role label, or the JD itself cannot make a requirement direct. Demonstrated learning supports ramp readiness and the Apply Recommendation but never erases a role-defining gap or turns transferable work into direct experience. Fold soft adjectives (rigorous, collaborative, excellent communicator) into observable work; keep logistics out unless they are genuine hard gates.

Report category scores, weighted arithmetic, confidence, direct strengths, transferable strengths, gaps, contradictions, the Apply Recommendation, and two or three reasons the score is not higher. A score does not represent hiring probability.

Use these interpretation bands:

- `4.5–5.0`: exceptional direct fit; at least 80% of the core is direct, with no material core gap.
- `4.0–4.4`: strong fit; mostly direct, at most one material transferable core requirement.
- `3.5–3.9`: credible fit; real transferable evidence, but not near-direct.
- `3.2–3.4`: stretch worth applying to (the gate is 3.2); show the tradeoffs.
- `<3.2`: weak fit or a meaningful blocker.

Use `high` confidence only when at least 75% of weighted material requirements are direct, with no major gap or source conflict. Use `medium` for mixed direct/transferable evidence and `low` for unclear or primarily transferable core evidence.

Hard blockers are reported separately. Only genuine non-negotiable constraints, such as required authorization, mandatory location, licensing, or an essential qualification that cannot reasonably be learned, can force `manual_review` or `screened_out` regardless of the weighted score. Missing preferred tools or exact domain experience must reduce fit or confidence and create a risk note, not automatically fail the job.
