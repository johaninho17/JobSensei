import type { EditionInfo, Features } from "../shared/edition";

declare global {
  /** Replaced at build time by vite.config.ts (one literal per feature), so left-out screens drop out of the bundle. */
  const FEATURES: Readonly<Features>;
  /** This build's edition: name, small print, badge. */
  const EDITION: Readonly<EditionInfo>;
}
