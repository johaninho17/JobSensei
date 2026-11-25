// Bento pieces (ledger U77, U78, U79). Styles live in layout.css under .bento; values in tokens.css.
import type { ReactNode } from "react";

/** A raised card. tone "hero" is the one "Do this next" card per screen and the only card with a coloured edge: brass
 * edge and label (U2, U79). */
export function BentoCard({ id, title, tone = "raised", span, action, className, children }: {
  id?: string;
  title?: string;
  tone?: "raised" | "hero";
  /** Columns to span in the 4-column grid; the grid narrows it on smaller widths. */
  span?: 1 | 2 | 3 | 4;
  /** Shown at the right of the title row. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const classes = ["bento-card", tone === "hero" ? "is-hero" : "", span && span > 1 ? `span-${span}` : "", className ?? ""].filter(Boolean).join(" ");
  return <section id={id} className={classes} aria-label={title}>
    {(title || action) && <header className="bento-card-head">
      {title && (tone === "hero" ? <p className="bento-eyebrow">{title}</p> : <h2>{title}</h2>)}
      {action}
    </header>}
    {children}
  </section>;
}

/** One big number with its label and, when given, the one action it leads to. */
export function Kpi({ value, label, actionLabel, onAction }: {
  value: number;
  label: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return <BentoCard className="bento-kpi">
    <p className="bento-kpi-value tabular">{value}</p>
    <p className="bento-kpi-label">{label}</p>
    {actionLabel && onAction && <button className="btn-link" onClick={onAction}>{actionLabel}</button>}
  </BentoCard>;
}

/** Ring band from a 1–5 fit rating, the same cut-offs as fitBandOf (job-organize.ts). */
export function fitRingBand(rating: number | null | undefined): "high" | "mid" | "low" | "unrated" {
  if (rating === null || rating === undefined || Number.isNaN(rating)) return "unrated";
  return rating >= 4 ? "high" : rating >= 3 ? "mid" : "low";
}

const BAND_TEXT = { high: "strong fit", mid: "fair fit", low: "weak fit", unrated: "not rated" } as const;
const RADIUS = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A fit rating (1–5) as a ring with the number inside. Screen readers get the text, never the color alone. */
export function FitRing({ rating, size = 44 }: { rating: number | null | undefined; size?: number }) {
  const band = fitRingBand(rating);
  const share = band === "unrated" ? 0 : Math.min(Math.max(rating! / 5, 0), 1);
  const label = band === "unrated" ? "Fit not rated" : `Fit ${rating!.toFixed(1)} of 5, ${BAND_TEXT[band]}`;
  return <span className={`fit-ring band-${band}`} role="img" aria-label={label} style={{ width: size, height: size }}>
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <circle className="fit-ring-track" cx="20" cy="20" r={RADIUS} />
      <circle className="fit-ring-value" cx="20" cy="20" r={RADIUS} strokeDasharray={`${share * CIRCUMFERENCE} ${CIRCUMFERENCE}`} transform="rotate(-90 20 20)" />
    </svg>
    <span className="fit-ring-number tabular" aria-hidden="true">{band === "unrated" ? "–" : rating!.toFixed(1)}</span>
  </span>;
}
