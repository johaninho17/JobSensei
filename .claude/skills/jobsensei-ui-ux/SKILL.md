---
name: jobsensei-ui-ux
description: Design, implement, or review JobSensei interfaces (React renderer, styles, layout, dashboards, document viewer, interview views, accessibility) and verify them visually in the running app.
---

# JobSensei UI/UX

A calm, credible desktop workspace that makes dense career evidence, drafts, and interview prep easy to scan and act on.

## Before designing
0. Use Anthropic's `frontend-design` skill (plugin) for the design process and aesthetic direction. This skill only adds JobSensei specifics.
1. Read `UI_DESIGN_SYSTEM.md` (what the tokens mean, layout, components). Values live only in `src/renderer/tokens.css`; layout in `layout.css` (shell, pages, interview) and `styles.css` (documents, terminal, Settings). Never add a hex value outside `tokens.css`; `tests/workspace-search.test.ts` checks this.
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
1. `npm run build`, then screenshot every main screen in light and dark with Playwright `_electron` (navigation clicks only; never select rounds or send prompts on real jobs). Restore the theme to light afterwards; the driver shares the app's localStorage. For Today, `npm run screenshot:today -- <out-dir>` does this on a scratch copy of the demo workspace (light and dark, wide and narrow, Agy panel open and closed) and reports side scroll.
2. Exercise the main path plus the failure and retry paths.
3. Check a normal desktop width and a narrow window, plus long titles and long content, for overflow, clipping, and wrapping.
4. Fix visible defects before reporting. Never approve UI from source or tests alone.
