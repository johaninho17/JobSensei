// How long a pasted job posting must be: one limit for the Add jobs box, the Agy chat, and the app's own check when it
// saves the paste (electron/jd-fetch.ts), so a paste one place accepts is never refused by another (#27).

/** A pasted posting shorter than this is not treated as a job description. */
export const MIN_PASTED_POSTING_CHARS = 250;

/** The chat turns a paste into a job attachment from this length (or 3+ lines); same number as above. */
export function looksLikePastedPosting(text: string): boolean {
  return text.trim().length >= MIN_PASTED_POSTING_CHARS;
}
