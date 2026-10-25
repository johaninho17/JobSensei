import type { ApplicationStatus, InterviewOverview, InterviewStage, JobFolderSummary } from "../shared/schemas";

export type JobActionGroup = "Recommended" | "Interview" | "Application";

export type JobAction = {
  id: string;
  label: string;
  prompt: string;
  group: JobActionGroup;
  recommended: boolean;
  jobId: string;
  company: string;
};

function companyName(job: JobFolderSummary): string {
  return (job.company ?? job.name).replace(/,\s*(inc|llc|ltd)\.?$/i, "").trim();
}

function stageWords(stage: InterviewStage): string {
  const map: Record<InterviewStage, string> = {
    recruiter_screen: "recruiter interview",
    hiring_manager: "hiring manager interview",
    technical: "technical interview",
    practical_evaluation: "practical evaluation",
    technical_challenge: "technical challenge",
    take_home: "take-home practice",
    onsite: "onsite interview",
    final_panel: "team panel interview",
    executive: "executive interview",
    unknown: "interview",
  };
  return map[stage] ?? "interview";
}

export function buildJobActions(job: JobFolderSummary | null, interview: InterviewOverview | null, application: ApplicationStatus | null): JobAction[] {
  if (!job) return [];
  const company = companyName(job);
  // Company + title + job ID, so two jobs at the same company can never be confused.
  const named = job.title ? `${company} ${job.title}` : company;
  const actions: JobAction[] = [];
  const add = (id: string, label: string, text: string, group: JobActionGroup, recommended = false) => {
    const prompt = `${text} (job: ${job.id})`;
    if (!actions.some((action) => action.prompt.toLowerCase() === prompt.toLowerCase())) {
      actions.push({ id, label, prompt, group, recommended, jobId: job.id, company });
    }
  };
  const current = interview?.rounds.find((round) => round.id === interview.currentRoundId) ?? interview?.rounds.at(-1) ?? null;
  const currentStepIndex = current
    ? interview?.knownProcess.findIndex((step) => step.stage === current.stage || ("roundId" in step && step.roundId === current.id)) ?? -1
    : -1;
  const candidateSteps = currentStepIndex >= 0
    ? interview?.knownProcess.slice(currentStepIndex + 1) ?? []
    : interview?.knownProcess ?? [];
  const next = candidateSteps.find((step) => !interview?.rounds.some((round) => round.stage === step.stage || ("roundId" in step && step.roundId && round.id === step.roundId)))
    ?? interview?.knownProcess.find((step) => !interview?.rounds.some((round) => round.stage === step.stage || ("roundId" in step && step.roundId && round.id === step.roundId)))
    ?? null;

  if (current?.debriefSourcePaths.length && !current.artifactPaths.debriefAnalysis) {
    add("analyze-debrief", `Analyze ${company} debrief`, `${named} debrief`, "Recommended", true);
  } else if (next) {
    const words = stageWords(next.stage);
    add("prepare-next-round", `Prepare ${words}`, `Prepare ${named} ${words}`, "Recommended", true);
  } else if (current?.stage === "technical_challenge" && !current.artifactPaths.practiceLabs) {
    add("prepare-current-challenge", `Prepare ${company} technical challenge`, `${named} technical challenge`, "Recommended", true);
  } else if (current?.status === "prep_ready") {
    const words = stageWords(current.stage);
    add("start-current-mock", `Start ${words} mock`, `Start ${named} ${words} mock`, "Recommended", true);
  } else {
    add("prepare-recruiter", `Prepare ${company} recruiter interview`, `Prepare ${named} recruiter interview`, "Recommended", true);
  }

  add("recruiter-interview", "Prepare recruiter interview", `Prepare ${named} recruiter interview`, "Interview");
  add("hiring-manager-interview", "Prepare hiring manager interview", `Prepare ${named} hiring manager interview`, "Interview");
  add("technical-interview", "Prepare technical interview", `Prepare ${named} technical interview`, "Interview");
  add("technical-challenge", "Prepare technical challenge", `${named} technical challenge`, "Interview");
  add("team-panel-interview", "Prepare team panel interview", `Prepare ${named} team panel interview`, "Interview");
  if (current) add("mock-interview", "Start current-round mock", `Start ${named} ${stageWords(current.stage)} mock`, "Interview");
  if (current?.debriefSourcePaths.length) add("debrief", "Analyze latest debrief", `${named} debrief`, "Interview");

  if (application?.publicResumePath) add("review-resume", "Review tailored resume", `${named} resume`, "Application");
  add("review-cover-letter", "Review cover letter", `${named} cover letter`, "Application");
  add("evaluate-application", "Evaluate application", `Evaluate ${named} application`, "Application");
  return actions;
}
