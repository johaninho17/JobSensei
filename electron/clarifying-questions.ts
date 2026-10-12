import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { ClarifyingAnswer, ClarifyingAnswersReport, ClarifyingQuestion } from "../src/shared/schemas";
import { clarifyingAnswersReportSchema } from "../src/shared/schemas";
import { readCandidateProfile } from "./candidate-profile";
import { readJson, writeJsonAtomic } from "./persistence";

export const clarificationsRelativePath = ".sensei/job_clarifications.json";

export async function generateJobClarifyingQuestions(
  workspacePath: string,
  jobId: string,
): Promise<ClarifyingQuestion[]> {
  const profile = await readCandidateProfile(workspacePath);
  const setting = profile?.preferences.voice.interactiveQuestions ?? "on_gaps";
  if (setting === "never") return [];

  const jdPath = join(workspacePath, "jobs", jobId, "original_jd.md");
  const jdContent = await readFile(jdPath, "utf8").catch(() => "");
  if (!jdContent) return [];

  const questions: ClarifyingQuestion[] = [];
  const jdLower = jdContent.toLowerCase();

  // Domain check: Payments / Fintech
  if (jdLower.includes("payment") || jdLower.includes("checkout") || jdLower.includes("fintech") || jdLower.includes("transaction")) {
    questions.push({
      id: "domain_payments",
      prompt: "This role emphasizes digital payments, checkouts, or transactional flows. How should we position your experience?",
      contextHint: "Select the primary angle or provide specific payment tooling details.",
      options: [
        {
          id: "api_troubleshooting",
          label: "API Microservices & REST Endpoints",
          description: "Frame transactional reliability around RESTful API endpoint debugging, HTTP error codes, and Postman testing.",
        },
        {
          id: "partner_enablement",
          label: "Partner Enablement & Client Onboarding",
          description: "Focus on creating integration guides, playbooks, and troubleshooting partner integrations.",
        },
        {
          id: "data_sovereignty",
          label: "Data Security, Encryption & Compliance",
          description: "Highlight zero-trust database encryption, compliance, and secure data pipelines.",
        },
      ],
      allowWriteIn: true,
    });
  }

  // Domain check: AI / LLM / Agentic workflows
  if ((jdLower.includes("agent") || jdLower.includes("llm") || jdLower.includes("generative ai") || jdLower.includes("prompt")) && questions.length < 2) {
    questions.push({
      id: "domain_ai_systems",
      prompt: "The role involves Generative AI or Agentic systems. Which implementation depth should we emphasize?",
      contextHint: "Focus on your strongest verified AI experience.",
      options: [
        {
          id: "adk_agent_workflows",
          label: "ADK & Multi-Step Agent Workflows",
          description: "Highlight tool calling, connectors (Slack/Gmail/Drive), and custom agent task orchestration.",
        },
        {
          id: "rag_lora_fine_tuning",
          label: "RAG Pipelines & Model Fine-Tuning",
          description: "Emphasize enterprise RAG knowledge bases, LoRA parameter tuning, and vector search.",
        },
        {
          id: "evaluation_benchmarking",
          label: "AI Evaluation & Analytics Views",
          description: "Focus on OpenTelemetry tracing, BigQuery evaluation frameworks, and accuracy monitoring.",
        },
      ],
      allowWriteIn: true,
    });
  }

  // Strategic framing: Role balance (Hands-on coding vs Consultative Architecture)
  if (questions.length < 2 && (jdLower.includes("solution") || jdLower.includes("consultant") || jdLower.includes("partner engineering"))) {
    questions.push({
      id: "role_orientation",
      prompt: "What balance between hands-on engineering and client-facing architecture best fits your target positioning?",
      options: [
        {
          id: "balanced_hybrid",
          label: "Balanced Solutions Architect (50% Client / 50% Tech)",
          description: "Combine technical discovery and client walkthroughs with hands-on API debugging and test collections.",
        },
        {
          id: "deep_tech_first",
          label: "Systems & Integration First (70% Tech / 30% Client)",
          description: "Position primarily as a systems developer who works with partner engineers on difficult implementation blockers.",
        },
        {
          id: "consultative_advocate",
          label: "Partner Strategy & Enablement (70% Client / 30% Tech)",
          description: "Prioritize partner onboarding velocity, developer documentation, and cross-functional advocacy.",
        },
      ],
      allowWriteIn: true,
    });
  }

  return questions.slice(0, 2);
}

export async function readJobClarificationAnswers(
  workspacePath: string,
  jobId: string,
): Promise<ClarifyingAnswersReport | null> {
  const target = join(workspacePath, "jobs", jobId, clarificationsRelativePath);
  const stored = await readJson<unknown>(target);
  const parsed = clarifyingAnswersReportSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

export async function saveJobClarificationAnswers(
  workspacePath: string,
  jobId: string,
  answers: ClarifyingAnswer[],
): Promise<void> {
  const target = join(workspacePath, "jobs", jobId, clarificationsRelativePath);
  const report: ClarifyingAnswersReport = {
    jobId,
    answers,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(target, report);
}
