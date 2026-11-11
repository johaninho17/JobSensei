// The review screen's data (Recruiter Edition, plan R8 P2): every line of the tailored resume, whether it changed from
// the base resume, and the evidence each changed line cites, so the recruiter can check a draft before sending it.
// Read-only: built from the files the finalizer already wrote.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { applicationDraftSchema, applicationEvidenceSchema, type EvidenceSnapshotRow } from "../src/shared/schemas";
import type { ApplicationReview, ReviewLine, ReviewSection } from "../src/shared/review";
import { assertInsideWorkspace } from "./workspace";


/** Reads a JSON state file, plain or gzip-compressed (newer snapshots are stored compressed under the same name). */
async function readStateJson(path: string): Promise<unknown> {
  const raw = await readFile(path).catch(() => null);
  if (!raw) return null;
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function sourceLabel(row: EvidenceSnapshotRow | undefined, id: string): string {
  if (id.startsWith("base:")) return "Base resume";
  if (!row) return "Not in this run's evidence";
  const name = row.sourcePath.split("/").pop() ?? row.sourcePath;
  return name === "recruiter-notes.md" ? "Recruiter notes" : name;
}

export async function applicationReview(workspacePath: string, jobId: string): Promise<ApplicationReview> {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(jobId)) throw new Error("The job ID is invalid.");
  const state = assertInsideWorkspace(workspacePath, join(workspacePath, "jobs", jobId, ".sensei"));
  const [draftRaw, evidenceRaw, snapshotRaw] = await Promise.all(["application_draft.json", "application_evidence.json", "evidence_snapshot.json"].map((name) => readStateJson(join(state, name))));
  const draft = applicationDraftSchema.safeParse(draftRaw);
  const evidence = applicationEvidenceSchema.safeParse(evidenceRaw);
  if (!draft.success || !evidence.success) return null;
  const rows = new Map(((snapshotRaw as { evidenceRows?: EvidenceSnapshotRow[] } | null)?.evidenceRows ?? []).map((row) => [row.evidenceId, row]));
  const mappings = new Map(evidence.data.resume.claimMappings.map((mapping) => [key(mapping.publicText), mapping]));
  const line = (text: string): ReviewLine => {
    const mapping = mappings.get(key(text));
    const changed = !mapping || mapping.claimType !== "baseline";
    return {
      text,
      changed,
      evidence: changed ? (mapping?.evidenceIds ?? []).map((id) => ({ id, text: rows.get(id)?.claim ?? "", source: sourceLabel(rows.get(id), id) })) : [],
    };
  };
  const sections: ReviewSection[] = [
    ...(draft.data.resume.summary ? [{ title: "Summary", lines: [line(draft.data.resume.summary)] }] : []),
    { title: "Skills", lines: draft.data.resume.skillsLines.map(line) },
    ...draft.data.resume.employers.map((employer) => ({ title: employer.name, lines: employer.bullets.map(line) })),
  ];
  const all = sections.flatMap((section) => section.lines);
  return { resumeName: evidence.data.resume.publicArtifact, sections, changed: all.filter((entry) => entry.changed).length, total: all.length, letter: Boolean(draft.data.coverLetter) };
}
