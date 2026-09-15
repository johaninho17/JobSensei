---
name: jobsensei-ui-ux
description: Design, implement, review, or refine JobSensei user interfaces and interaction flows. Use for React components, layouts, navigation, visual styling, design systems, responsive desktop behavior, accessibility, document comparison, AI progress states, forms, dashboards, and browser-based visual QA.
---

# JobSensei UI/UX

Create a calm, credible desktop workspace that makes dense career evidence and AI output easy to inspect.

## Establish the experience

1. Read `AGENTS.md` and the relevant product flow in `implementation_plan.md`.
2. Inspect existing tokens, components, and screenshots before creating new patterns.
3. Identify the primary user decision on the screen.
4. Define all states before implementation: empty, loading, streaming, success, partial, error, rate-limited, disabled, and destructive confirmation.
5. Preserve clear access to source evidence and original documents.

Read [references/design-system.md](references/design-system.md) before making visual or interaction decisions.

## Apply JobSensei principles

- Prioritize evidence, comparison, and next actions over decoration.
- Keep the three-panel layout legible without forcing every panel to remain open.
- Use progressive disclosure for long reports and technical details.
- Distinguish generated, verified, user-edited, stale, and failed content.
- Display compatibility scores with their evidence and uncertainty; never present a score as objective truth.
- Make generation explicit so the user understands when a Gemini request will occur.
- Keep original and tailored resume content visually distinguishable.
- Preserve editing affordances without making generated content look final by default.

## Build accessibly

- Use semantic HTML and native controls where possible.
- Provide visible keyboard focus, useful labels, and logical tab order.
- Meet WCAG AA contrast for text and controls.
- Do not encode status through color alone.
- Respect reduced-motion preferences.
- Keep primary actions reachable without precision pointing.

## Verify visually

For material UI changes:

1. Run the application.
2. Inspect it in the available browser tooling.
3. Exercise the main interaction and failure/retry paths.
4. Check the intended desktop viewport and a narrow window.
5. Inspect overflow, clipping, focus, contrast, text wrapping, and long content.
6. Capture screenshots when they help compare iterations.
7. Fix visible defects before reporting completion.

Do not approve a UI solely from source inspection or test output.
