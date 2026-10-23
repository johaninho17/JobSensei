---
name: jobsensei-ui-ux
description: Design, implement, or review JobSensei interfaces (React renderer, styles, layout, dashboards, document viewer, interview views, accessibility) and verify them visually in the running app.
---

# JobSensei UI/UX

A calm, credible desktop workspace that makes dense career evidence, drafts, and interview prep easy to scan and act on.

## Before designing
1. Read `UI_DESIGN_SYSTEM.md`. It is the owner of visual style: tokens, typography, layout, and components in `src/renderer/styles.css`.
2. Inspect the existing components in `src/renderer/` before creating new patterns.
3. Name the one decision the user makes on this screen.
4. Define every state: empty, loading, running (Agy working), success, partial, error, stale, disabled, destructive confirm.

## Principles
- Evidence, comparison, and next actions come before decoration.
- Progressive disclosure for long reports and technical detail.
- Glanceable during live use. Interview views must be scannable in seconds (see the interview rules in `AGENTS.md`).
- Distinguish generated, user-edited, stale, and failed content. Use a label or icon, not color alone.
- Pair scores with their evidence and uncertainty; never present a score as objective truth.
- Make it obvious when an action will start an Agy run.
- Preserve user edits through retries; confirm destructive changes.

## Accessibility
Semantic HTML and native controls, visible focus, logical tab order, WCAG AA contrast, reduced-motion support, and no status encoded by color alone.

## Verify visually
1. Run `npm run dev` and open the app (use the built-in browser on `http://127.0.0.1:5173` for renderer checks).
2. Exercise the main path plus the failure and retry paths.
3. Check a normal desktop width and a narrow window, plus long titles and long content, for overflow, clipping, and wrapping.
4. Fix visible defects before reporting. Never approve UI from source or tests alone.
