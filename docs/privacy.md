# Privacy

JobSensei is local-first. The app indexes and previews files under its repository-local `data/` directory and does not upload them by itself.

Agy is a separate tool. When a user invokes Agy in the embedded terminal, Agy's own account, model, network, and permission policies apply. JobSensei limits workflow instructions and exposes the active context manifest, but it cannot override the external tool's privacy terms.

Before publishing or sharing the repository:

- Confirm `data/`, `.env`, `.sensei/`, `debrief/`, and build output are ignored.
- Review the complete staged-file list.
- Scan for names, email addresses, phone numbers, local paths, transcripts, and tokens.
- Rotate any credential that was exposed, even if it has since been deleted.

Deleting a local workspace file through the UI sends it to the operating system's Trash or Recycle Bin when supported.
