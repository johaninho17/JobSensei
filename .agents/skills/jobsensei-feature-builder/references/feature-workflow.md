# Feature workflow

## Layer boundaries

| Layer | Owns | Must not own |
|---|---|---|
| React UI | Presentation, local interaction state, typed client calls | API keys, raw filesystem access, model clients |
| Local backend | Files, SQLite, providers, agent execution, validation | Visual component state |
| Domain | Schemas, evidence rules, scoring rules, artifact contracts | Framework-specific transport |
| Persistence | Atomic artifacts and rebuildable indexes | Prompt decisions |

Use IPC for Electron or loopback HTTP for a localhost browser app. Keep the domain and service layers transport-independent so the shell choice can change without rewriting core behavior.

## Definition of done

- The requested user flow works end to end.
- Inputs and persisted outputs are schema-validated.
- Errors are actionable and do not destroy valid data.
- Gemini usage is visible, bounded, and retryable.
- Relevant automated checks pass.
- Material UI changes are visually inspected.
- New behavior is documented in code or schemas where future maintainers will find it.
