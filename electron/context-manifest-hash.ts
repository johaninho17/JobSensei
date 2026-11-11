import { createHash } from "node:crypto";
import type { ContextManifest } from "../src/shared/schemas";

/**
 * The manifest's fingerprint: which files are selected and their versions. `selectionMode` is left out (changed
 * 2026-11-11): it only says whether the user chose the files, and the app rewrote the same selection from "default"
 * to "explicit" during a live run, so the finalizer refused the draft as "context changed".
 */
export function contextManifestHash(manifest: ContextManifest): string {
  return fingerprint(manifest, false);
}

/**
 * The current manifest's fingerprint as `pinned` (a snapshot's) would have recorded it: snapshots taken before
 * 2026-11-11 included `selectionMode`, so they are compared the old way instead of all reading as stale.
 */
export function currentManifestHash(manifest: ContextManifest, pinned?: string | null): string {
  const hash = fingerprint(manifest, false);
  return pinned && pinned !== hash && fingerprint(manifest, true) === pinned ? pinned : hash;
}

function fingerprint(manifest: ContextManifest, withSelectionMode: boolean): string {
  const semanticManifest = {
    schemaVersion: manifest.schemaVersion,
    baseResumePath: manifest.baseResumePath,
    secondaryResumePaths: [...manifest.secondaryResumePaths].sort(),
    linkedinProfilePath: manifest.linkedinProfilePath,
    policyPaths: [...manifest.policyPaths].sort(),
    selectedJobIds: [...manifest.selectedJobIds].sort(),
    selectedCareerPaths: [...manifest.selectedCareerPaths].sort(),
    selectedStructuredPaths: [...manifest.selectedStructuredPaths].sort(),
    selectedBroadPaths: [...manifest.selectedBroadPaths].sort(),
    selectedJobFiles: [...manifest.selectedJobFiles].sort(),
    ...(withSelectionMode ? { selectionMode: manifest.selectionMode } : {}),
    scope: manifest.scope,
    sourceFiles: [...manifest.sourceFiles]
      .map(({ path, modifiedAt, sizeBytes, sourceFamily }) => ({
        path,
        modifiedAt,
        sizeBytes,
        sourceFamily: sourceFamily ?? null,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  return createHash("sha256").update(JSON.stringify(semanticManifest)).digest("hex");
}
