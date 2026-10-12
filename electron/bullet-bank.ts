import { join } from "node:path";
import type { BulletBank, BulletBankItem, BulletBankTheme } from "../src/shared/schemas";
import { bulletBankSchema } from "../src/shared/schemas";
import { readJson, writeJsonAtomic } from "./persistence";

export const bulletBankRelativePath = "profile/bullet_bank.json";

export const defaultThemes: BulletBankTheme[] = [
  {
    id: "solutions_partner_engineering",
    label: "Solutions Architecture & Partner Enablement",
    description: "Enterprise client onboarding, technical discovery, integration guides, and partner troubleshooting.",
    keywords: ["partner", "client", "solutions", "onboarding", "enablement", "integration", "discovery", "api"],
  },
  {
    id: "ai_systems_agentic",
    label: "AI Systems & Agentic Workflows",
    description: "Agent development (ADK), LLM fine-tuning, RAG pipelines, vector memory, and model evaluation.",
    keywords: ["ai", "agent", "adk", "rag", "llm", "lora", "vector", "generative", "model", "vertex"],
  },
  {
    id: "cloud_data_infrastructure",
    label: "Cloud Infrastructure & Data Pipelines",
    description: "Cloud platforms (GCP), encrypted databases, analytical views, containerization, and observability.",
    keywords: ["gcp", "cloud", "pipeline", "postgresql", "docker", "looker", "bigquery", "opentelemetry", "security"],
  },
  {
    id: "fullstack_software_engineering",
    label: "Fullstack & Systems Engineering",
    description: "TypeScript/Node.js, Angular, REST microservices, unit testing, and CI/CD automation.",
    keywords: ["typescript", "javascript", "angular", "node", "express", "frontend", "fullstack", "microservices", "ci/cd"],
  },
];

export async function readBulletBank(workspacePath: string): Promise<BulletBank> {
  const target = join(workspacePath, bulletBankRelativePath);
  const stored = await readJson<unknown>(target);
  const parsed = bulletBankSchema.safeParse(stored);
  if (parsed.success) {
    // Ensure all default themes exist
    const themeMap = new Map(parsed.data.themes.map((t) => [t.id, t]));
    for (const def of defaultThemes) {
      if (!themeMap.has(def.id)) {
        themeMap.set(def.id, def);
      }
    }
    return {
      ...parsed.data,
      themes: [...themeMap.values()],
    };
  }

  const initialBank: BulletBank = {
    schemaVersion: 1,
    themes: defaultThemes,
    bullets: [],
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(target, initialBank).catch(() => undefined);
  return initialBank;
}

export async function saveBulletBank(workspacePath: string, bank: BulletBank): Promise<BulletBank> {
  const target = join(workspacePath, bulletBankRelativePath);
  const verified = bulletBankSchema.parse({
    ...bank,
    updatedAt: new Date().toISOString(),
  });
  await writeJsonAtomic(target, verified);
  return verified;
}

export function findThemeBullets(bank: BulletBank, themeId: string): BulletBankItem[] {
  return bank.bullets.filter((bullet) => bullet.themeId === themeId);
}
