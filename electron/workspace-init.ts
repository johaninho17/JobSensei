import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function initializeWorkspace(workspacePath: string): Promise<void> {
  await Promise.all([
    mkdir(join(workspacePath, "profile"), { recursive: true }),
    mkdir(join(workspacePath, "context"), { recursive: true }),
    mkdir(join(workspacePath, "resumes"), { recursive: true }),
    mkdir(join(workspacePath, "jobs"), { recursive: true }),
    mkdir(join(workspacePath, "debrief"), { recursive: true }),
    mkdir(join(workspacePath, "fallback-references"), { recursive: true }),
    mkdir(join(workspacePath, ".sensei"), { recursive: true }),
  ]);
}
