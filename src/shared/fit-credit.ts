/** Fit-score credit per classification. Single owner: fit-scoring uses it, the app displays it. */
// Calibrated 2026-10-26 so a role rated transferable throughout lands near 3.5 ("credible"), not 4.0.
export const FIT_CLASSIFICATION_CREDIT = { direct: 1, strong_transferable: 0.7, adjacent_transferable: 0.45, unclear: 0.1, gap: 0 } as const;

/** The fit score at or above which a job counts as worth applying to (shown as the "mid" band and up). */
export const FIT_GATE = 3.2;
