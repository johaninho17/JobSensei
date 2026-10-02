# JobSensei UI Design System & Style Specification

This document provides a complete specification for replicating JobSensei's user interface style, visual aesthetics, and component architecture in another application. **All terminal components and terminal-specific styles have been intentionally excluded.**

---

## 1. Technology Stack

- **Framework:** React 19 (or 18+) with TypeScript
- **Build Tool / Bundler:** Vite (`@vitejs/plugin-react`)
- **Styling Architecture:** Pure Vanilla CSS with CSS custom properties (`:root` design tokens)
  - *No Tailwind, no external UI component library (e.g. MUI, Chakra, AntD).*
  - Built with handcrafted utility and semantic component classes for high visual density and custom glassmorphism.
- **Icons / Badges:** Micro-text typography labels and Unicode/SVG icons styled with monospace badges.

---

## 2. Typography & Fonts

The interface uses a deliberate three-tier typographic hierarchy:

| Role | Font Family | Fallback Stack | Use Cases |
| :--- | :--- | :--- | :--- |
| **Display & Headings** | `"Space Grotesk"` | `sans-serif` | App logo, view titles, card headings, numbers, modal titles |
| **Micro-copy & Technical UI** | `"DM Mono"` | `"SF Mono"`, `monospace` | Status pills, tabs, file paths, labels, badges, buttons, dates, counts |
| **Body & Prose** | System Sans | `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | Reading content, descriptions, markdown rendered text |

### Google Fonts Import
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
```

---

## 3. Color Palette & Design Tokens

The aesthetic is a **technical dark forest / slate cyberpunk** motif with a vibrant lime/citron accent, paired with an optional light mint-sage theme.

### Core Token Variables

```css
:root {
  /* Surface & Backgrounds */
  --sensei-bg: #111313;
  --sensei-bg-gradient: radial-gradient(circle at 52% 18%, #1c2522 0%, #111313 48%);
  --sensei-surface-panel: rgba(12, 16, 14, 0.72);
  --sensei-surface-card: #172019;
  --sensei-surface-hover: #1a211c;
  --sensei-surface-active: #1b251c;
  --sensei-surface-input: #101512;

  /* Borders & Dividers */
  --sensei-border-subtle: #29302d;
  --sensei-border: #354238;
  --sensei-border-strong: #485b45;

  /* Typography Colors */
  --sensei-text: #e7eee5;       /* Primary headlines and bold text */
  --sensei-body: #c8d0c5;       /* General readable body text */
  --sensei-muted: #7f8c82;      /* Secondary labels, paths, metadata */
  --sensei-faint: #536357;      /* Subtle placeholders and borders */

  /* Semantic Accent Accents */
  --sensei-accent: #c8f269;      /* Brand electric lime / citron */
  --sensei-accent-dim: #b5db63;  /* Subdued lime for focus rings & subtle text */
  --sensei-accent-bg: #293b25;   /* Translucent green for tags & badges */
  --sensei-accent-contrast: #182014; /* Deep dark text on top of lime badges */

  /* State Alerts */
  --sensei-danger: #f09b8f;      /* Soft coral red for errors / deletions */
  --sensei-danger-bg: #2a1c1a;
  --sensei-warning: #edc275;     /* Warm amber gold for dirty/pending status */
  --sensei-warning-bg: #332b1d;
  --sensei-info: #9dab98;
}

/* Light Theme Overrides */
:root[data-theme="light"] {
  --sensei-bg: #eef2ec;
  --sensei-bg-gradient: radial-gradient(circle at 52% 18%, #fbfcf7 0%, #e8eee7 65%);
  --sensei-surface-panel: rgba(247, 250, 245, 0.86);
  --sensei-surface-card: #e5eee1;
  --sensei-surface-hover: #dfe8db;
  --sensei-surface-active: #d6e2d1;
  --sensei-surface-input: #f8faf6;

  --sensei-border-subtle: #cbd6ca;
  --sensei-border: #aabd9f;
  --sensei-border-strong: #60745f;

  --sensei-text: #243229;
  --sensei-body: #34483a;
  --sensei-muted: #617363;
  --sensei-faint: #8fa091;

  --sensei-accent: #315244;
  --sensei-accent-dim: #28653e;
  --sensei-accent-bg: #dce8d9;
  --sensei-accent-contrast: #f7faf6;

  --sensei-danger: #8a3730;
  --sensei-danger-bg: #fae9e7;
  --sensei-warning: #775613;
  --sensei-warning-bg: #f4e7c8;
}
```

---

## 4. Layout Architecture (App Shell)

The application shell uses a fixed full-screen grid preventing outer window scrolling, with independent scrollable panes:

```
+-----------------------------------------------------------------------------------+
|  Topbar (64px) - Brand Logo | Job Context Breadcrumb | Actions & Search | Theme   |
+-------------------+---------------------------------------------------------------+
|  Left Sidebar     | Resizer |  Main Content Workspace                             |
|  (260px - 340px)  | (4px)   |  - Dashboard / Cards                                |
|  Tree Navigation  |         |  - Document Viewer (Markdown / Rich / Binary)       |
|  File Explorer    |         |  - Split Markdown Editor & Live Preview             |
+-------------------+---------+-----------------------------------------------------+
|  Status Bar (34px) - Workspace path | Mode | Item Count | Status Dot              |
+-----------------------------------------------------------------------------------+
```

### CSS Layout Blueprint

```css
html, body, #root {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: var(--sensei-bg);
  color: var(--sensei-text);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  box-sizing: border-box;
}

* {
  box-sizing: inherit;
}

.app-shell {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: 64px minmax(0, 1fr) 34px;
  background: var(--sensei-bg-gradient);
  overflow: hidden;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 22px;
  border-bottom: 1px solid var(--sensei-border-subtle);
  background: rgba(17, 19, 19, 0.85);
  backdrop-filter: blur(12px);
}

.workspace-grid {
  display: grid;
  grid-template-columns: var(--left-panel-width, 280px) 4px minmax(320px, 1fr);
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.statusbar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 16px;
  border-top: 1px solid var(--sensei-border-subtle);
  color: var(--sensei-muted);
  font: 10px/1 "DM Mono", monospace;
  letter-spacing: 0.05em;
  background: rgba(17, 19, 19, 0.95);
}
```

---

## 5. Component Patterns & Styling

### 5.1 Wordmark & Brand Logo
```html
<div class="wordmark">
  <div class="wordmark-mark">S</div>
  <span>Sensei</span>
</div>
```
```css
.wordmark {
  display: flex;
  align-items: center;
  gap: 9px;
  font: 600 17px "Space Grotesk", sans-serif;
  color: var(--sensei-text);
}
.wordmark-mark {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--sensei-accent-contrast);
  background: var(--sensei-accent);
  font-weight: 700;
  font-size: 13px;
}
```

### 5.2 Topbar Buttons & Micro-Actions
```css
.topbar-button, .action-button {
  padding: 7px 11px;
  border: 1px solid var(--sensei-border);
  border-radius: 5px;
  color: var(--sensei-body);
  background: transparent;
  cursor: pointer;
  font: 10px "DM Mono", monospace;
  letter-spacing: 0.04em;
  transition: all 0.15s ease;
}

.topbar-button:hover, .action-button:hover {
  border-color: var(--sensei-accent);
  color: var(--sensei-accent);
  background: rgba(200, 242, 105, 0.04);
}
```

### 5.3 Primary High-Impact CTA Button
```css
.primary-button {
  display: inline-flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 18px;
  border: 0;
  border-radius: 6px;
  color: var(--sensei-accent-contrast);
  background: var(--sensei-accent);
  cursor: pointer;
  font: 600 13px "Space Grotesk", sans-serif;
  letter-spacing: -0.01em;
  transition: transform 0.1s ease, box-shadow 0.15s ease;
}

.primary-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(200, 242, 105, 0.25);
}
```

### 5.4 Status Badges & Pills
```css
.label {
  display: inline-block;
  padding: 3px 7px;
  border-radius: 4px;
  font: 9px "DM Mono", monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.label.source {
  color: #aeb9ac;
  background: #28312b;
}

.label.verified, .label.ready {
  color: var(--sensei-accent);
  background: var(--sensei-accent-bg);
}

.label.muted {
  color: var(--sensei-muted);
  background: #272d29;
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--sensei-muted);
}

.status-dot.is-ready {
  background: var(--sensei-accent);
  box-shadow: 0 0 8px rgba(200, 242, 105, 0.6);
}
```

### 5.5 Tree & File Navigation List
```css
.panel {
  min-height: 0;
  background: var(--sensei-surface-panel);
  display: flex;
  flex-direction: column;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 14px 12px;
  color: var(--sensei-muted);
  font: 10px "DM Mono", monospace;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.tree-file, .tree-directory {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--sensei-body);
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: 11px;
}

.tree-file:hover, .tree-file.is-selected {
  border-color: var(--sensei-border);
  background: var(--sensei-surface-hover);
  color: var(--sensei-text);
}
```

### 5.6 Command Palette / Search Modal (Cmd+K)
```css
.search-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: grid;
  place-items: start center;
  padding-top: 14vh;
  background: rgba(8, 11, 9, 0.65);
  backdrop-filter: blur(8px);
}

.search-dialog {
  width: min(620px, 94vw);
  border: 1px solid var(--sensei-border-strong);
  border-radius: 10px;
  background: #151d18;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}

.search-input {
  width: 100%;
  padding: 16px 18px;
  border: 0;
  border-bottom: 1px solid var(--sensei-border);
  outline: none;
  background: transparent;
  color: var(--sensei-text);
  font: 500 15px "Space Grotesk", sans-serif;
}

.search-results {
  max-height: 380px;
  overflow-y: auto;
  padding: 6px;
}

.search-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--sensei-body);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
}

.search-item.is-selected, .search-item:hover {
  border-color: var(--sensei-border);
  background: #202b23;
  color: var(--sensei-text);
}
```

### 5.7 In-Place Split Markdown Editor & Live Preview
```css
.markdown-editor-grid {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(280px, 1fr);
  min-height: 520px;
  overflow: hidden;
  border: 1px solid var(--sensei-border);
  border-radius: 8px;
  background: var(--sensei-surface-input);
}

.editor-pane {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--sensei-border);
}

.editor-pane-title {
  display: flex;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--sensei-border);
  color: var(--sensei-muted);
  background: #171e19;
  font: 9px "DM Mono", monospace;
  letter-spacing: 0.08em;
}

.editor-pane textarea {
  flex: 1;
  width: 100%;
  padding: 16px;
  resize: none;
  border: 0;
  outline: 0;
  color: var(--sensei-text);
  background: var(--sensei-surface-input);
  caret-color: var(--sensei-accent);
  tab-size: 2;
  font: 12px/1.65 "DM Mono", monospace;
}

.editor-preview {
  overflow: auto;
  padding: 20px 24px;
  background: #151a17;
  color: var(--sensei-body);
  font: 14px/1.7 ui-sans-serif, sans-serif;
}

.editor-preview h1, .editor-preview h2, .editor-preview h3 {
  color: var(--sensei-text);
  font-family: "Space Grotesk", sans-serif;
}
```

---

## 6. Micro-Interactions & Styling Rules

1. **Subtle Neon Glows:** Restrict bright accents (`#c8f269`) to active states, selected borders, ready dots, and primary CTAs. Avoid large background floods.
2. **Sharp, Low-Radius Corners:** Use border-radii of `4px` to `8px` (`border-radius: 5px` is standard throughout). Avoid overly pill-like bubbles for cards or inputs.
3. **Monospace Metadata:** All counts, labels, badges, timestamps, tags, and small utility indicators must use `"DM Mono"` with a slight letter-spacing (`0.06em` to `0.1em`).
4. **Resizer Dividers:** Resizer handles between panes are `4px` wide with a `1px` center line (`#303a34`), which thickens to `3px` and turns lime on `:hover` or active drag.
5. **No Clutter:** Keep surfaces clean, borders crisp, and typography prioritized over heavy shadows.
