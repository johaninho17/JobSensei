# JobSensei design system

Values live in one place: `src/renderer/tokens.css`. This document explains them; it never restates hex codes. Component layout lives in `src/renderer/layout.css` (shell, pages, interview view) and `src/renderer/styles.css` (documents, terminal, Settings). Neither file defines color, font, or spacing values of its own.

## Who it is for
A private, local workbench for a job seeker in any field. Two jobs matter most: knowing the next step for each application, and glancing at cues during a live interview.

## Color
| Token | Role |
|---|---|
| `--canvas`, `--raised`, `--sunken` | Page, panels and cards, sidebar and wells |
| `--ink`, `--muted` | Text, secondary text |
| `--line`, `--line-strong`, `--hover` | Dividers and borders, hover fill (derived from `--ink`) |
| `--accent`, `--on-accent` | Pine green: primary buttons, links, current navigation item |
| `--brass` | "Do this next": the next-step card, key points, focus ring. At most one brass element per screen besides focus. |
| `--leaf` | Met, ready, done |
| `--risk` | Blocked, error, "careful" |
| `--*-tint` | Low-alpha fills behind the matching semantic color |
| `--term-*` | The Agy terminal panel, which is dark in both themes |

Light is the default theme. Dark is neutral graphite with green accents, not dark green. Every text token passes WCAG AA (4.5:1) on `--canvas` and `--raised` in both themes; check new pairs before adding them.

## Type
- UI and body: Atkinson Hyperlegible Next (bundled, OFL), chosen for legibility during live calls.
- Titles, job titles, and interview questions: Newsreader (bundled, OFL).
- Monospace only for code, file contents, and the terminal.
- Scale: `--fs-12` to `--fs-35` (1.25 ratio, 15px base). Sentence case everywhere. No all-caps labels, tracked-out eyebrows, or "A · B · C" meta strings.

## Layout
```
┌ sidebar ─────────┬ top bar: ☐ ‹ › [Search ⌘K]            [● Agy] [⚙] ┬ Agy panel ┐
│ Sensei           ├──────────────────────────────────────────────────┤ (toggle)  │
│ Jobs         159 │ Page title (serif)                               │           │
│ Interviews    12 │ one line of help text                            │           │
│ Profile     5/10 │ toolbar: search · segmented filters · sort       │           │
│                  │ content                                          │           │
│ Recent jobs      │                                                  │           │
│ Settings         │                                                  │           │
└──────────────────┴──────────────────────────────────────────────────┴───────────┘
```
- Profile (U78): Setup and Career context are one page and one sidebar item, with tabs Setup · Sources · Resumes · Job files · Tune · Story bank · Interview voice (the Recruiter Edition's candidate page already worked this way).
- Pages: Jobs (add-jobs box with the waiting/running queue under it, a one-line setup banner, status subtabs Active · Interviewing · Applied · Saved · Closed · All with Active as the default; Closed splits "Reached interviews" from a collapsed "No interview"; one toolbar row: search, filter toggles, sort, Select, Cards/List, ⋯ menu; Select (or Cmd/Ctrl-click a job) adds checkboxes and a sticky bar to change the status of many jobs at once, with Shift-click for a range and one Undo toast), Interviews (subtabs Active · Past · Learnings), Career context (subtabs Sources · Resumes · Job files · Story bank · Interview voice).
- First run (new workspace, or name/resume missing): a compact stepper (Your name · Base resume · Agy · Make it better) over one card per step; one primary button per step, Back below the card. Setup page in the sidebar lists the same items afterwards.
- Job page: company, title (serif h1), stage, fit, location, then tabs Overview, Application, Interview, Files. The header carries Job posting · Export PDFs · Check. Overview has a one-line next step (hidden for closed jobs), "What happened?" for closed jobs that reached interviews, one line for checks to review, then flat Role, Fit, Tracking, and Interviews sections. Files has subtabs Application · Interview · Other. The Application tab has subtabs Resume · Cover letter · Questions · Evaluation · Checks (documents shown in place, Export PDF in the subtab row); Checks states the result in words, with pipeline diagnostics under "Pipeline details".
- Interview tab: round stepper, round title, then subtabs Prep · Questions · Research · Files with the round actions (live mode) at the right. Questions has a sticky rail to jump to any question (grouped Questions, Gaps, Ask them) beside the cards (search, keyboard). Prep is flat sections: 3 things to get across, before you start, the stage's sections, readiness. Live mode shows one card at a time with a timer, in the main window or a pop-out window.
- Content is left-aligned with a max width of about 1180px; reading columns (prep, research, documents) stay near 760–820px.
- **Bento cards.** Content sits in raised cards (see Bento below), not flat sections divided by rules. One brass element per screen.
- **Readable generated text:** prep and research render with `markdownHtml(…, { readable: true })`: tables, a small "source" link instead of URLs, IDs in a hover marker (ⓘ), and met/learnable/gap badges.
- **Subtabs** (`SubTabs.tsx`) split a long page into views instead of stacking boxes: one component everywhere, underlined, arrow keys move between tabs, actions sit at the right of the row.

## Components
- Buttons: `btn-primary` (one per area), `btn-quiet`, `btn-link`. Labels say what happens ("Send to Agy", "Start live mode").
- `segmented`: filters and view switches, with counts.
- `tracker-pill` / `tracker-select` (Saved muted, Applied accent, Interviewing leaf, Offer solid accent, Rejected risk, Withdrawn dashed), `status-pill` for pipeline state, `fit-badge`, `next-badge` (brass only when a follow-up is due): never color alone; the text carries the meaning.
- Interview card (`icard`): question in the UI font (15px, semibold), kind badge for non-questions, Say points as a short list, Proof in plain words (story and evidence IDs only in the tooltip), "Land on" with a leaf rule, "They may ask next" muted, "Careful" in risk color.

## Bento
Every page (ledger U77 pilot on Today, U78 everywhere). One shared surfaces block in `layout.css` gives every card template the same raised card; it is the only place the card shadows are used.
- `.bento-page` is a size container; `.bento` is a 4-column grid that steps to 2 and then 1 column by the page's own width (`@container`), so the Agy panel never causes side scroll.
- `BentoCard` (`BentoPrimitives.tsx`): a raised card with `--shadow-card` and `--specular-edge`, lifting to `--shadow-card-hover` when a control in it is hovered. `--raised-nested` is a well inside a card. Padding and gaps come from the density tokens `--card-pad`, `--card-pad-x`, `--card-gap` (U79); change those, not a page.
- The hero (`tone="hero"`) is the screen's one brass element and the only card with a coloured edge (U79): brass left edge and a brass "Do this next" label, with a pine `btn-primary`. Never a filled brass or green card.
- Today (U79): a compact header (title and date on one line); a top row (`.bento-row`) with the hero, picked by `pickNextStep` in `src/shared/today-next.ts`, and a `.kpi-stack` of up to three short KPI tiles beside it (number, label, one link on one line; a row when there is no hero). Then one card with tabs in its header for Due, New matches, and For the coming days (opens on the first with something in it; insights are one line each), then Questions, Your answers, and Today's activity (filter chips by kind).
- Job page (U79, U82): the header card holds title, status, fit ring, the settings score (U67), a short location (full text as tooltip), and a ⋯ menu for the added date, corrected fields, and Edit details; "Application ready" shows only before applying. One "PDFs" control holds the text size and Create. Documents show file details as a ? tip. Then the brass "Next" bar and the check line; the tabs stick while scrolling; the Fit card explains the score (confidence, gaps, strengths) without repeating it.
- Jobs (U79): a short header (title, status menu, one "Add jobs" button that opens the queue form); status views are also sidebar sub-items under Jobs; Sort and Group sit in a View menu.
- Templates: `BentoCard`, `Kpi`, `FitRing` (`BentoPrimitives.tsx`); job cards (`JobCard` in `JobsHome.tsx`) are compact (U79): fit ring, company and role, star and ⋯ on one row, then one meta line (status with a dot from `jobDotOf`: interviewing/offer leaf, applied pine, a blocker must-have while saved risk; interview round; added date). The whole card opens the job (click, Enter). Links underline on hover only. `.bento-surface` makes any panel a card.
- `Kpi`: one big tabular number, a muted label, at most one link. `FitRing`: the 1–5 fit rating as a ring (leaf strong, muted fair, risk weak) with the number inside and a text label for screen readers.

## Say it once (U82)
- Every page starts with `PageHead` (`BentoPrimitives.tsx`): title, one short status line, at most one main action, and an optional "?" `InfoTip` holding what the page used to explain in a paragraph. No help paragraphs under titles.
- Explanations live in a tip, a tooltip, or Docs; the page shows state and actions. Boxes only around things you act on.
- Empty sidebar groups don't render (Favorites appears once a job is starred; Jobs views with no jobs are hidden, Active and All stay).

## Accessibility
Native buttons and inputs; visible focus (`--focus`); `aria-current` for navigation, `aria-pressed` for toggles, `aria-expanded` for cards; menus and dialogs close on Escape and return focus; keyboard paths for the interview view (↑ ↓, Enter, /, L; live mode ← → R Esc); `prefers-reduced-motion` honored.
