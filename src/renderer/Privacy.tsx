// Privacy and terms, shown in the app from the same PRIVACY.md and TERMS.md that ship with it (one owner each).
// Edition-only lines are kept or dropped by featureText, so each build describes only what it does.
import privacyMarkdown from "../../PRIVACY.md?raw";
import termsMarkdown from "../../TERMS.md?raw";
import { featureText, featuresFor } from "../shared/edition";
import { markdownHtml } from "./markdown";

// The build replaces only `FEATURES.<name>`, never the bare object, so the whole list comes from the edition.
const features = () => featuresFor(EDITION.edition);
export const privacyText = () => featureText(features(), privacyMarkdown);
export const termsText = () => featureText(features(), termsMarkdown);

export function PrivacyAndTerms() {
  return <div className="privacy-page iv-markdown">
    <div dangerouslySetInnerHTML={{ __html: markdownHtml(privacyText(), [], { readable: true }) }} />
    <hr />
    <div dangerouslySetInnerHTML={{ __html: markdownHtml(termsText(), [], { readable: true }) }} />
  </div>;
}

/** The same page as a dialog, for screens shown before Settings exists (first run, the candidate list). */
export function PrivacyDialog({ onClose }: { onClose: () => void }) {
  return <div className="search-overlay" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <div className="company-dialog privacy-dialog" role="dialog" aria-modal="true" aria-label="Privacy and terms">
      <PrivacyAndTerms />
      <div className="company-dialog-actions"><button className="btn-primary" autoFocus onClick={onClose}>Close</button></div>
    </div>
  </div>;
}
