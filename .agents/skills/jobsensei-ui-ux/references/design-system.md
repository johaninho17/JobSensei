# JobSensei design system

## Product character

Aim for a focused professional workspace: calm, precise, evidence-led, and supportive. Avoid neon AI motifs, excessive gradients, glass effects, ornamental charts, and dashboard clutter.

## Layout

- Treat the center workspace as primary.
- Allow the job-history and context panels to collapse.
- Keep document reading widths comfortable.
- Use sticky local actions only when they do not obscure content.
- Prefer split views for direct comparison and tabs for mutually exclusive artifacts.

## Hierarchy

- Use one clear page title and one primary action per state.
- Put company, role, status, and freshness near the top.
- Pair scores with requirement evidence, gaps, and confidence.
- Put provenance close to claims instead of burying it in settings.

## Status language

Represent these states consistently:

- Source: imported and unchanged
- Verified: supported by career evidence
- Generated: produced by a model and awaiting review
- Edited: changed by the user
- Stale: source or prompt changed after generation
- Failed: generation or validation did not complete

Use icons or labels in addition to color.

## Interaction

- Require a deliberate action before consuming model quota.
- Show what will be generated and whether cached output exists.
- Preserve user edits during retries.
- Confirm destructive data changes.
- Provide undo or recovery when practical.

## Accessibility and visual QA

Target WCAG AA contrast, semantic controls, visible focus, and reduced motion. Test common desktop, narrow desktop, long-content, keyboard-only, and 200% zoom conditions.
