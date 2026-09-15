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
  return {
    recruiter_screen: "recruiter interview",
    hiring_manager: "hiring manager interview",
    technical: "technical interview",
    technical_challenge: "technical challenge",
    take_home: "take-home practice",
    onsite: "onsite interview",
    executive: "executive interview",
    unknown: "interview",
  }[stage];
}

export function buildJobActions(job: JobFolderSummary | null, interview: InterviewOverview | null, application: ApplicationStatus | null): JobAction[] {
  if (!job) return [];
  const company = companyName(job);
  const actions: JobAction[] = [];
  const add = (id: string, label: string, prompt: string, group: JobActionGroup, recommended = false) => {
    if (!actions.some((action) => action.prompt.toLowerCase() === prompt.toLowerCase())) {
      actions.push({ id, label, prompt, group, recommended, jobId: job.id, company });
    }
  };
  const current = interview?.rounds.find((round) => round.id === interview.currentRoundId) ?? interview?.rounds.at(-1) ?? null;
  const next = current
    ? interview?.knownProcess.find((step) => !interview.rounds.some((round) => round.stage === step.stage && round.sequence > current.sequence)) ?? null
    : interview?.knownProcess[0] ?? null;

  if (current?.debriefSourcePaths.length && !current.artifactPaths.debriefAnalysis) {
    add("analyze-debrief", `Analyze ${company} debrief`, `${company} debrief`, "Recommended", true);
  } else if (next) {
    const words = stageWords(next.stage);
    add("prepare-next-round", `Prepare ${words}`, `Prepare ${company} ${words}`, "Recommended", true);
  } else if (current?.stage === "technical_challenge" && !current.artifactPaths.practiceLabs) {
    add("prepare-current-challenge", `Prepare ${company} technical challenge`, `${company} technical challenge`, "Recommended", true);
  } else if (current?.status === "prep_ready") {
    const words = stageWords(current.stage);
    add("start-current-mock", `Start ${words} mock`, `Start ${company} ${words} mock`, "Recommended", true);
  } else {
    add("prepare-recruiter", `Prepare ${company} recruiter interview`, `Prepare ${company} recruiter interview`, "Recommended", true);
  }

  add("recruiter-interview", "Prepare recruiter interview", `Prepare ${company} recruiter interview`, "Interview");
  add("hiring-manager-interview", "Prepare hiring manager interview", `Prepare ${company} hiring manager interview`, "Interview");
  add("technical-interview", "Prepare technical interview", `Prepare ${company} technical interview`, "Interview");
  add("technical-challenge", "Prepare technical challenge", `${company} technical challenge`, "Interview");
  if (current) add("mock-interview", "Start current-round mock", `Start ${company} ${stageWords(current.stage)} mock`, "Interview");
  if (current?.debriefSourcePaths.length) add("debrief", "Analyze latest debrief", `${company} debrief`, "Interview");

  if (application?.publicResumePath) add("review-resume", "Review tailored resume", `${company} resume`, "Application");
  add("review-cover-letter", "Review cover letter", `${company} cover letter`, "Application");
  add("evaluate-application", "Evaluate application", `Evaluate ${company} application`, "Application");
  return actions;
}
