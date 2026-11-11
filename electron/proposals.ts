// Jobs waiting for the candidate's approval (Recruiter Edition, plan R8 P5). When a candidate's brief says they approve
// jobs first, "Who is this for?" proposes the posting instead of queuing it: its saved copy goes to
// `.sensei/proposals/` (outside the queue's saved postings, which the queue tidies) and a line to
// `.sensei/proposals.json`. Approving moves it into the queue; declining removes it.
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { newQueueItem } from "../src/shared/job-queue";
import type { Proposal } from "../src/shared/recruiter-insight";
import { STAGED_JDS_DIR } from "./jd-fetch";
import { readJobQueue, saveJobQueue } from "./job-queue";
import { readJson, writeJsonAtomic } from "./persistence";

const LIST = [".sensei", "proposals.json"] as const;
const DIR = [".sensei", "proposals"] as const;
const ID = /^paste-[a-z0-9-]{4,40}$/;
const proposalSchema = z.object({ id: z.string().regex(ID), company: z.string().nullable(), title: z.string().nullable(), url: z.string().nullable(), reasons: z.array(z.string()).default([]), proposedAt: z.string() });
const listSchema = z.array(proposalSchema).max(200);

export async function readProposals(folder: string): Promise<Proposal[]> {
  const parsed = listSchema.safeParse(await readJson<unknown>(join(folder, ...LIST)));
  return parsed.success ? parsed.data : [];
}

/** Saves a proposal: the posting's staged files are copied from `stagedDir` under the proposal's ID. */
export async function addProposal(folder: string, stagedDir: string, sourceId: string, proposal: Omit<Proposal, "id" | "proposedAt">, now = new Date()): Promise<Proposal> {
  const id = newQueueItem({ kind: "paste", label: null }, now).id;
  const target = join(folder, ...DIR);
  await mkdir(target, { recursive: true });
  for (const name of await readdir(stagedDir).catch(() => [] as string[])) {
    if (name.startsWith(`${sourceId}.`)) await copyFile(join(stagedDir, name), join(target, `${id}${name.slice(sourceId.length)}`));
  }
  const clip = (value: string | null) => value ? value.replace(/\s+/g, " ").trim().slice(0, 160) : null;
  const entry = proposalSchema.parse({ ...proposal, company: clip(proposal.company), title: clip(proposal.title), id, proposedAt: now.toISOString() });
  const list = await readProposals(folder);
  await writeJsonAtomic(join(folder, ...LIST), [...list.filter((item) => !(item.url && item.url === entry.url)), entry].slice(-200));
  return entry;
}

async function removeProposal(folder: string, id: string, keepFiles: boolean): Promise<Proposal> {
  if (!ID.test(id)) throw new Error("That proposal ID is invalid.");
  const list = await readProposals(folder);
  const entry = list.find((item) => item.id === id);
  if (!entry) throw new Error("That job is no longer waiting for approval.");
  await writeJsonAtomic(join(folder, ...LIST), list.filter((item) => item.id !== id));
  if (!keepFiles) for (const name of await readdir(join(folder, ...DIR)).catch(() => [] as string[])) if (name.startsWith(`${id}.`)) await rm(join(folder, ...DIR, name), { force: true });
  return entry;
}

/**
 * The candidate approved: the posting joins their queue (call only while this candidate isn't open in the window).
 * The queue is written first; the proposal is removed only once the job is safely queued.
 */
export async function approveProposal(folder: string, id: string, now = new Date()): Promise<void> {
  if (!ID.test(id)) throw new Error("That proposal ID is invalid.");
  const entry = (await readProposals(folder)).find((item) => item.id === id);
  if (!entry) throw new Error("That job is no longer waiting for approval.");
  const staged = join(folder, ...STAGED_JDS_DIR.split("/"));
  await mkdir(staged, { recursive: true });
  const files = (await readdir(join(folder, ...DIR)).catch(() => [] as string[])).filter((name) => name.startsWith(`${id}.`));
  for (const name of files) await copyFile(join(folder, ...DIR, name), join(staged, name));
  const label = [entry.company, entry.title].filter(Boolean).join(", ").replace(/\s+/g, " ").slice(0, 200) || null;
  const item = { ...newQueueItem({ kind: "paste", label }, now), id };
  if (entry.url) item.url = entry.url;
  const queue = await readJobQueue(folder);
  await saveJobQueue(folder, { ...queue, items: [...queue.items.filter((existing) => existing.status !== "done").slice(-49), item] });
  await removeProposal(folder, id, false);
}

export async function declineProposal(folder: string, id: string): Promise<void> {
  await removeProposal(folder, id, false);
}
