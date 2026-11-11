import type { ApplicationStatus, InterviewOverview, InterviewStage, JobFolderSummary } from "../shared/schemas";
import { nextInterviewStep } from "../shared/interview-progress";

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
  // What comes next (src/shared/interview-progress.ts): after the furthest round done, counting interviews the user
  // recorded in the tracker; earlier rounds that were skipped are never suggested.
  const recorded = job.tracker?.interviews ?? [];
  const next = nextInterviewStep({ rounds: interview?.rounds ?? [], knownProcess: interview?.knownProcess ?? [], recorded });
  const nextRound = next.kind === "practice" ? interview?.rounds.find((round) => round.id === next.roundId) ?? null : null;
  const debriefRound = [...(interview?.rounds ?? [])].reverse().find((round) => round.debriefSourcePaths.length && !round.artifactPaths.debriefAnalysis) ?? null;

  // Interview prep, mocks, and debriefs exist only where interviews do (the Recruiter Edition stops at applying).
  if (FEATURES.interviews) {
    if (debriefRound) {
      add("analyze-debrief", `Analyze ${company} debrief`, `${named} debrief`, "Recommended", true);
    } else if (nextRound?.stage === "technical_challenge" && !nextRound.artifactPaths.practiceLabs) {
      add("prepare-current-challenge", `Prepare ${company} technical challenge`, `${named} technical challenge`, "Recommended", true);
    } else if (nextRound) {
      const words = stageWords(nextRound.stage);
      add("start-current-mock", `Practice ${words}`, `Start ${named} ${words} mock`, "Recommended", true);
    } else if (next.kind === "prepare") {
      const words = stageWords(next.stage);
      add("prepare-next-round", `Prepare ${words}`, `Prepare ${named} ${words}`, "Recommended", true);
    } else {
      add("evaluate-application", "Evaluate application", `Evaluate ${named} application`, "Recommended", true);
    }

    add("recruiter-interview", "Prepare recruiter interview", `Prepare ${named} recruiter interview`, "Interview");
    add("hiring-manager-interview", "Prepare hiring manager interview", `Prepare ${named} hiring manager interview`, "Interview");
    add("technical-interview", "Prepare technical interview", `Prepare ${named} technical interview`, "Interview");
    add("technical-challenge", "Prepare technical challenge", `${named} technical challenge`, "Interview");
    add("team-panel-interview", "Prepare team panel interview", `Prepare ${named} team panel interview`, "Interview");
    if (current) add("mock-interview", "Start current-round mock", `Start ${named} ${stageWords(current.stage)} mock`, "Interview");
    if (current?.debriefSourcePaths.length) add("debrief", "Analyze latest debrief", `${named} debrief`, "Interview");
  }

  if (application?.publicResumePath) add("review-resume", "Review tailored resume", `${named} resume`, "Application");
  add("review-cover-letter", "Review cover letter", `${named} cover letter`, "Application");
  add("evaluate-application", "Evaluate application", `Evaluate ${named} application`, "Application");
  return actions;
}
