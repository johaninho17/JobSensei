import { createHash } from "node:crypto";
import type { ContextManifest } from "../src/shared/schemas";

export function contextManifestHash(manifest: ContextManifest): string {
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
    selectionMode: manifest.selectionMode,
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
