import { cp, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

export async function initializeWorkspace(workspacePath: string): Promise<void> {
  await Promise.all([
    mkdir(join(workspacePath, "profile"), { recursive: true }),
    mkdir(join(workspacePath, "context", "structured"), { recursive: true }),
    mkdir(join(workspacePath, "context", "broad"), { recursive: true }),
    mkdir(join(workspacePath, "resumes"), { recursive: true }),
    mkdir(join(workspacePath, "jobs"), { recursive: true }),
    mkdir(join(workspacePath, "debrief"), { recursive: true }),
    mkdir(join(workspacePath, "fallback-references"), { recursive: true }),
    mkdir(join(workspacePath, ".sensei"), { recursive: true }),
  ]);

  await seedWorkspaceSkillsAndRules(workspacePath);
}

async function seedWorkspaceSkillsAndRules(workspacePath: string): Promise<void> {
  const targetSkills = join(workspacePath, ".agents", "skills");
  const targetAgentsMd = join(workspacePath, "AGENTS.md");

  const sourceCandidates: Array<{ skills: string; agentsMd: string }> = [];

  if (process.resourcesPath) {
    sourceCandidates.push({
      skills: join(process.resourcesPath, "skills"),
      agentsMd: join(process.resourcesPath, "AGENTS.md"),
    });
  }
  sourceCandidates.push({
    skills: join(__dirname, "../../.agents/skills"),
    agentsMd: join(__dirname, "../../AGENTS.md"),
  });

  for (const candidate of sourceCandidates) {
    try {
      const skillsStat = await stat(candidate.skills).catch(() => null);
      if (skillsStat?.isDirectory()) {
        const targetExists = await stat(targetSkills).catch(() => null);
        if (!targetExists) {
          await mkdir(join(workspacePath, ".agents"), { recursive: true });
          await cp(candidate.skills, targetSkills, { recursive: true });
        }
      }
      const agentsMdStat = await stat(candidate.agentsMd).catch(() => null);
      if (agentsMdStat?.isFile()) {
        const targetExists = await stat(targetAgentsMd).catch(() => null);
        if (!targetExists) {
          await cp(candidate.agentsMd, targetAgentsMd);
        }
      }
      break;
    } catch {
      // Non-fatal fallback
    }
  }
}

