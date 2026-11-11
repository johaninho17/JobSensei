# Privacy

What the app stores and what leaves the computer is described once, for users, in [`PRIVACY.md`](../PRIVACY.md) (also shown in the app). This page is the builder's checklist.

Before publishing or sharing the repository:

- Confirm `data/`, `.env`, `.sensei/`, `debrief/`, and build output are ignored.
- Review the complete staged-file list.
- Scan for names, email addresses, phone numbers, local paths, transcripts, and tokens.
- Rotate any credential that was exposed, even if it has since been deleted.

Deleting a local workspace file through the UI sends it to the operating system's Trash or Recycle Bin when supported.
