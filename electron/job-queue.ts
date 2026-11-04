import { join } from "node:path";
import { jobQueueSchema, type JobQueue } from "../src/shared/schemas";
import { readJson, writeJsonAtomic } from "./persistence";
import { pruneStagedJobDescriptions } from "./jd-fetch";

const QUEUE_PATH = [".sensei", "job_queue.json"] as const;

export async function readJobQueue(workspacePath: string): Promise<JobQueue> {
  const parsed = jobQueueSchema.safeParse(await readJson<unknown>(join(workspacePath, ...QUEUE_PATH)));
  return parsed.success ? parsed.data : jobQueueSchema.parse({});
}

/** Validates and saves the whole queue (the renderer owns ordering and status changes). */
export async function saveJobQueue(workspacePath: string, input: unknown): Promise<JobQueue> {
  const queue = jobQueueSchema.parse(input);
  await writeJsonAtomic(join(workspacePath, ...QUEUE_PATH), queue);
  await pruneStagedJobDescriptions(workspacePath, queue.items.filter((item) => item.kind === "paste").map((item) => item.id));
  return queue;
}
