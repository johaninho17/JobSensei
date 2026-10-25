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
│ Career context   │ toolbar: search · segmented filters · sort       │           │
│                  │ content                                          │           │
│ Recent jobs      │                                                  │           │
│ Settings         │                                                  │           │
└──────────────────┴──────────────────────────────────────────────────┴───────────┘
```
- Pages: Jobs (List, Board by status with drag and drop plus a status menu on each card, or Cards), Interviews (every job with prep, current round and progress), Career context (resumes, sources, job files Agy reads).
- Job page: company, title (serif h1), stage, fit, location, then tabs Overview, Application, Interview, Files. Overview leads with the next-step card, then Fit, Tracking (dates, notes, history), Documents, and Interviews. The Application tab states the check result in words; pipeline diagnostics sit under "Pipeline details".
- Interview tab: round stepper, round header with live mode, question cards (filter, search, keyboard), and a side column with key points, delivery reminders, a readiness checklist, prep notes, and files. Live mode shows one card at a time with a timer, in the main window or a pop-out window.
- Content is left-aligned with a max width of about 1180px. Sections are separated by space and headings; cards only for things you open.

## Components
- Buttons: `btn-primary` (one per area), `btn-quiet`, `btn-link`. Labels say what happens ("Send to Agy", "Start live mode").
- `segmented`: filters and view switches, with counts.
- `tracker-pill` / `tracker-select` (Saved muted, Applied accent, Interviewing leaf, Offer solid accent, Rejected risk, Withdrawn dashed), `status-pill` for pipeline state, `fit-badge`, `next-badge` (brass only when a follow-up is due): never color alone; the text carries the meaning.
- Interview card (`icard`): question in serif, kind badge, cues as chips, "Land on" with a leaf rule, "Careful" in risk color.

## Accessibility
Native buttons and inputs; visible focus (`--focus`); `aria-current` for navigation, `aria-pressed` for toggles, `aria-expanded` for cards; menus and dialogs close on Escape and return focus; keyboard paths for the interview view (↑ ↓, Enter, /, L; live mode ← → R Esc); `prefers-reduced-motion` honored.
