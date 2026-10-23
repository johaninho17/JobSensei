# Feature workflow

## Layer boundaries

| Layer | Owns | Must not own |
|---|---|---|
| React renderer (`src/renderer/`) | Presentation, local interaction state, typed `window.sensei` calls | Filesystem access, secrets, model calls |
| Preload (`electron/preload.ts`) | The narrow typed bridge | Business logic |
| Electron main (`electron/`) | Files, workspace safety, terminal/Agy session, snapshot, finalizer, validation, PDF export | Visual state |
| Shared (`src/shared/`) | Zod schemas, contracts, scoring and evidence rules shared by both sides | Transport details |
| Agy (`.agents/`) | Judgment and prose inside the bounded pipeline | Deterministic rules the code can enforce |

## Definition of done
- The requested user flow works end to end in the running app.
- Inputs and persisted outputs are schema-validated.
- Errors are actionable and never destroy valid data.
- `npm run typecheck` and `npm test` pass; new behavior has a test.
- Material UI changes are visually inspected.
- Tracked files contain no candidate data.
