/**
 * Everything the Agy page offers as a button (owner of that list). Each action says what it does and where it runs,
 * and is carried out by an existing path: a request to Agy in its panel, an Agy command, or the app's own step.
 * It never adds a second way to do something the app already does.
 */

export type AgyActionGroup = "This job" | "Interviews" | "Job search" | "Agy";
export type AgyActionWhere = "Agy panel" | "Background" | "In the app";
export type AgyActionRun =
  /** One of the open job's actions (`job-actions.ts`), run exactly as from the job page. */
  | { kind: "job-action"; actionId: string }
  /** A request typed to Agy in its panel. */
  | { kind: "prompt"; text: string }
  /** An Agy command (opens Agy's own screen in the Console). */
  | { kind: "command"; text: string }
  /** A step the app runs itself or a page it opens. */
  | { kind: "app"; call: "search-run" | "search-watched" | "open-recordings" | "open-job-search" };

export type AgyAction = { id: string; group: AgyActionGroup; label: string; what: string; where: AgyActionWhere; run: AgyActionRun; unavailable?: string };

export type AgyActionContext = {
  features: { interviews: boolean; contentRefresh: boolean; jobSearch: boolean };
  /** The job that is open or was opened last, with its actions (from `buildJobActions`). */
  job: { name: string; actions: Array<{ id: string; label: string; prompt: string }> } | null;
  /** Recordings and practice interviews not yet read into the story bank, voice, and role memory. */
  newRecordings: number;
  searchRunning: boolean;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function buildAgyActions(context: AgyActionContext): AgyAction[] {
  const actions: AgyAction[] = [];
  const { features, job } = context;

  if (job) {
    for (const action of job.actions.slice(0, 8)) {
      actions.push({ id: `job:${action.id}`, group: "This job", label: action.label, what: `Sends: “${action.prompt}”`, where: "Agy panel", run: { kind: "job-action", actionId: action.id } });
    }
  }

  if (features.interviews && features.contentRefresh) {
    actions.push({
      id: "recordings", group: "Interviews",
      label: context.newRecordings ? `Read ${plural(context.newRecordings, "new recording")}` : "Read new recordings and practice interviews",
      what: "Opens Your content, where Tune has Agy read the recordings and practice interviews you added and suggest updates to your story bank, interview voice, and role memory. You pick which ones to apply.",
      where: "In the app", run: { kind: "app", call: "open-recordings" },
    });
    actions.push({
      id: "story-bank", group: "Interviews", label: "Build or refresh the story bank",
      what: "Agy rewrites your 6–8 interview stories from your checked career files, keeping your edits.",
      where: "Agy panel", run: { kind: "prompt", text: "Build or refresh my story bank" },
    });
  }

  if (features.jobSearch) {
    const busy = context.searchRunning ? "A search is already running." : undefined;
    actions.push({ id: "search-run", group: "Job search", label: "Search for jobs now", what: "Checks the companies you watch, asks Agy for more companies hiring for your titles, and rates the closest matches.", where: "Background", run: { kind: "app", call: "search-run" }, unavailable: busy });
    actions.push({ id: "search-watched", group: "Job search", label: "Check watched companies", what: "Reads your watched companies' job boards for new postings. No AI, no quota.", where: "Background", run: { kind: "app", call: "search-watched" }, unavailable: busy });
    actions.push({ id: "search-open", group: "Job search", label: "Open matches", what: "Shows the matches found so far.", where: "In the app", run: { kind: "app", call: "open-job-search" } });
  }

  const command = (id: string, label: string, text: string, what: string): AgyAction => ({ id, group: "Agy", label, what, where: "Agy panel", run: { kind: "command", text } });
  actions.push(
    command("model", "Choose the model", "/model", "Opens Agy's model picker in the Console."),
    command("effort", "Set how hard Agy thinks", "/effort", "Lower is faster and uses less quota; higher is more careful."),
    command("usage", "Show quota left", "/usage", "Shows how much of your Agy quota is left."),
    command("resume", "Open an earlier conversation", "/resume", "Opens Agy's list of past conversations."),
    command("clear", "Start a new conversation", "/clear", "Agy forgets this conversation and starts fresh. Your files are not touched."),
  );
  return actions;
}

export const AGY_ACTION_GROUPS: AgyActionGroup[] = ["This job", "Interviews", "Job search", "Agy"];
