import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJson } from "./persistence";

/**
 * Lines from tailored resumes of jobs where the user recorded a real interview: wording that has already been in front
 * of a hiring team and got a call back. Offered to Agy in later applications only when every evidence ID behind a line
 * is routed to the new job, so grounding still holds. Computed when a snapshot is built, so it never goes stale.
 */
export type ProvenLine = { text: string; evidenceIds: string[]; employer: string | null; from: string };

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function provenLinesFor(workspace: string, routedIds: Set<string>, employerOf: (evidenceId: string) => string | null, limit = 12): Promise<ProvenLine[]> {
  const jobsRoot = join(workspace, "jobs");
  const out: ProvenLine[] = [];
  const seen = new Set<string>();
  for (const entry of await readdir(jobsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const tracker = await readJson<{ interviews?: unknown[] }>(join(jobsRoot, entry.name, ".sensei", "tracker.json"));
    if (!tracker?.interviews?.length) continue;
    const evidence = await readJson<{ resume?: { claimMappings?: Array<{ publicText?: string; claimType?: string; evidenceIds?: string[] }> } }>(join(jobsRoot, entry.name, ".sensei", "application_evidence.json"));
    for (const mapping of evidence?.resume?.claimMappings ?? []) {
      const ids = mapping.evidenceIds ?? [];
      if (!mapping.publicText || !["candidate", "framed"].includes(mapping.claimType ?? "") || !ids.length) continue;
      if (!ids.every((id) => routedIds.has(id))) continue;
      const key = norm(mapping.publicText);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: mapping.publicText, evidenceIds: ids, employer: employerOf(ids[0]!), from: entry.name });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
