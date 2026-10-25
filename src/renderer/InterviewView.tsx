// One interview view for a job: round stepper, question cards, prep sidebar, and live mode.
// Content comes from the round's files (prep.md, question_bank.md, research) and profile/story_bank.md.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { InterviewOverview, InterviewRound, JobFolderSummary } from "../shared/schemas";
import { listItems, markdownSections, parseInterviewCards, storyTitles, type CardKind, type InterviewCard } from "./interview-cards";
import { markdownHtml } from "./markdown";

type Filter = CardKind | "all";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "question", label: "Questions" },
  { id: "gap", label: "Gaps" },
  { id: "followup", label: "Follow-ups" },
  { id: "ask", label: "Ask them" },
];
const STATUS_LABEL: Record<InterviewRound["status"], string> = { planned: "Not prepared", prep_ready: "Prep ready", completed: "Done", debriefed: "Debriefed" };
const LIVE_TARGET_SECONDS = 90;

async function readText(relativePath: string | null): Promise<string> {
  if (!relativePath) return "";
  try { return (await window.sensei.files.preview(relativePath)).content ?? ""; } catch { return ""; }
}

export function InterviewView({ job, overview, loading, initialRoundId, standalone = false, onRoundChange, onOpenFile, onInsertPrompt }: {
  job: JobFolderSummary;
  overview: InterviewOverview | null;
  loading: boolean;
  initialRoundId?: string;
  standalone?: boolean;
  onRoundChange?: (roundId: string) => void;
  onOpenFile: (relativePath: string) => void;
  onInsertPrompt?: (text: string, label: string) => void;
}) {
  const rounds = overview?.rounds ?? [];
  const [roundId, setRoundId] = useState(initialRoundId ?? overview?.currentRoundId ?? rounds[rounds.length - 1]?.id ?? "");
  const round = rounds.find((candidate) => candidate.id === roundId) ?? rounds.find((candidate) => candidate.id === overview?.currentRoundId) ?? rounds[rounds.length - 1] ?? null;
  const [files, setFiles] = useState<{ prep: string; bank: string; stories: Record<string, string> }>({ prep: "", bank: "", stories: {} });
  const [filesLoading, setFilesLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [liveIndex, setLiveIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (initialRoundId) setRoundId(initialRoundId); }, [initialRoundId]);
  useEffect(() => {
    let cancelled = false;
    setFilesLoading(true);
    setOpen(new Set());
    void Promise.all([readText(round?.artifactPaths.prep ?? null), readText(round?.artifactPaths.questionBank ?? null), readText("profile/story_bank.md")])
      .then(([prep, bank, stories]) => { if (!cancelled) setFiles({ prep, bank, stories: storyTitles(stories) }); })
      .finally(() => { if (!cancelled) setFilesLoading(false); });
    return () => { cancelled = true; };
  }, [round?.id, round?.artifactPaths.prep, round?.artifactPaths.questionBank]);

  const cards = useMemo(() => parseInterviewCards(files.bank), [files.bank]);
  const prepSections = useMemo(() => markdownSections(files.prep), [files.prep]);
  const keyPoints = listItems(prepSections.find((section) => /things to get across/i.test(section.title))?.body ?? "");
  const reminders = listItems(prepSections.find((section) => /before you start/i.test(section.title))?.body ?? "");
  const otherPrep = prepSections.filter((section) => !/things to get across|before you start/i.test(section.title));
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((item) => [item.id, item.id === "all" ? cards.length : cards.filter((card) => card.kind === item.id).length])) as Record<Filter, number>, [cards]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((card) => (filter === "all" || card.kind === filter)
      && (!needle || [card.question, card.why, card.example, card.landOn, card.gap, card.closest, ...card.cues].join(" ").toLowerCase().includes(needle)));
  }, [cards, filter, query]);
  const liveCards = visible.length ? visible : cards;

  function selectRound(nextId: string) {
    setRoundId(nextId);
    onRoundChange?.(nextId);
  }
  function toggle(id: string) {
    setOpen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function onListKeyDown(event: ReactKeyboardEvent<HTMLOListElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "j" && event.key !== "k") return;
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(".icard-toggle") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" || event.key === "j" ? 1 : -1)))]?.focus();
  }
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (liveIndex !== null || target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key.toLowerCase() === "l" && !event.metaKey && !event.ctrlKey && liveCards.length) { event.preventDefault(); setLiveIndex(0); }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [liveIndex, liveCards.length]);

  if (loading) return <p className="iv-empty">Reading interview rounds…</p>;
  const jobRef = `(job: ${job.id})`;
  const company = job.company ?? job.name;
  if (!round) {
    return <section className="iv-empty-state">
      <h2>No interview rounds yet</h2>
      <p>When you get an interview, ask Agy to prepare the recruiter round. It writes a question bank, prep notes, and company research for this job.</p>
      {onInsertPrompt && <button className="btn-primary" onClick={() => onInsertPrompt(`Prepare ${company} ${job.title ?? ""} recruiter interview ${jobRef}`.replace(/\s+/g, " "), "Prepare recruiter interview")}>Prepare recruiter round</button>}
    </section>;
  }
  const meta = [round.interviewer, round.format, round.scheduledDate].filter(Boolean);
  const artifacts: Array<[string, string | null]> = [["Prep notes", round.artifactPaths.prep], ["Question bank", round.artifactPaths.questionBank], ["Company research", round.artifactPaths.research], ["Challenge brief", round.artifactPaths.challengeBrief], ["Practice labs", round.artifactPaths.practiceLabs], ["Debrief", round.artifactPaths.debriefAnalysis]];
  const checklist: Array<[string, boolean]> = [["Question bank written", Boolean(round.artifactPaths.questionBank)], ["Prep notes written", Boolean(round.artifactPaths.prep)], ["Company research", Boolean(round.artifactPaths.research)], ["Key points chosen", keyPoints.length > 0], ["Debrief after the call", Boolean(round.artifactPaths.debriefAnalysis) || round.status === "debriefed"]];

  return <section className={`iv ${standalone ? "is-standalone" : ""}`}>
    <ol className="iv-stepper" aria-label="Interview rounds">
      {rounds.map((candidate, index) => <li key={candidate.id}>
        <button className={`iv-step is-${candidate.status} ${candidate.id === round.id ? "is-current" : ""}`} aria-current={candidate.id === round.id ? "step" : undefined} onClick={() => selectRound(candidate.id)}>
          <span className="iv-step-dot" aria-hidden="true">{candidate.status === "completed" || candidate.status === "debriefed" ? "✓" : index + 1}</span>
          <span className="iv-step-text"><strong>{candidate.label}</strong><small>{candidate.scheduledDate ?? STATUS_LABEL[candidate.status]}</small></span>
        </button>
      </li>)}
      {onInsertPrompt && <li><button className="iv-step is-add" onClick={() => onInsertPrompt(`Prepare ${company} ${job.title ?? ""} next interview round ${jobRef}`.replace(/\s+/g, " "), "Prepare next round")}><span className="iv-step-dot" aria-hidden="true">+</span><span className="iv-step-text"><strong>Next round</strong><small>Ask Agy to prepare it</small></span></button></li>}
    </ol>

    <header className="iv-head">
      <div>
        <h2>{round.label}</h2>
        <p>{meta.length ? meta.join(", ") : STATUS_LABEL[round.status]}</p>
      </div>
      <div className="iv-head-actions">
        {onInsertPrompt && <button className="btn-quiet" onClick={() => onInsertPrompt(`Refresh ${company} ${job.title ?? ""} ${round.label} interview prep with current research ${jobRef}`.replace(/\s+/g, " "), "Update research")}>Update research</button>}
        {!standalone && <button className="btn-quiet" onClick={() => void window.sensei.interviews.openWorkspaceWindow(job.id, round.id)}>Open in window</button>}
        <button className="btn-quiet" title="A small window that stays on top of your video call" onClick={() => void window.sensei.interviews.openWorkspaceWindow(job.id, round.id, true)}>Live window</button>
        <button className="btn-primary" disabled={!liveCards.length} onClick={() => setLiveIndex(0)} title="Shortcut: L">Start live mode</button>
      </div>
    </header>

    <div className="iv-layout">
      <div className="iv-main">
        <div className="iv-toolbar">
          <div className="segmented" role="group" aria-label="Show cards">
            {FILTERS.filter((item) => item.id === "all" || counts[item.id] > 0).map((item) => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{counts[item.id]}</span></button>)}
          </div>
          <label className="iv-search"><span className="sr-only">Search this round</span><input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this round  /" /></label>
          <button className="btn-link" onClick={() => setOpen(open.size ? new Set() : new Set(visible.map((card) => card.id)))}>{open.size ? "Collapse all" : "Expand all"}</button>
        </div>
        {filesLoading ? <p className="iv-empty">Reading the question bank…</p>
          : !cards.length ? <div className="iv-empty-state"><h3>No question bank for this round</h3><p>{round.artifactPaths.questionBank ? "The question bank has no question headings this view can read." : "Ask Agy to prepare this round to get questions, cues, and what to land on."}</p>{round.artifactPaths.questionBank && <button className="btn-quiet" onClick={() => onOpenFile(round.artifactPaths.questionBank!)}>Open question bank</button>}</div>
          : <ol className="icard-list" ref={listRef} onKeyDown={onListKeyDown} aria-label="Interview questions">
            {visible.map((card, index) => <InterviewCardItem key={card.id} card={card} index={index} open={open.has(card.id)} stories={files.stories} onToggle={() => toggle(card.id)} onLive={() => setLiveIndex(liveCards.indexOf(card))} />)}
            {!visible.length && <li className="iv-empty">Nothing matches “{query}”.</li>}
          </ol>}
        <p className="iv-hint">↑ ↓ to move between questions, Enter to open one, / to search, L for live mode.</p>
      </div>

      <aside className="iv-side" aria-label="Round preparation">
        {keyPoints.length > 0 && <section className="iv-panel is-key"><h3>3 things to get across</h3><ol>{keyPoints.map((point) => <li key={point}>{point}</li>)}</ol></section>}
        {reminders.length > 0 && <section className="iv-panel"><h3>Before you start</h3><ul>{reminders.map((item) => <li key={item}>{item}</li>)}</ul></section>}
        <section className="iv-panel"><h3>Ready for this round</h3><ul className="iv-checklist">{checklist.map(([label, done]) => <li key={label} className={done ? "is-done" : ""}><span aria-hidden="true">{done ? "✓" : "○"}</span>{label}<span className="sr-only">{done ? " (done)" : " (not yet)"}</span></li>)}</ul></section>
        {otherPrep.length > 0 && <section className="iv-panel"><h3>Prep notes</h3>{otherPrep.map((section) => <details key={section.title} className="iv-details"><summary>{section.title}</summary><div className="iv-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(section.body) }} /></details>)}</section>}
        <section className="iv-panel"><h3>Files</h3><ul className="iv-files">{artifacts.filter(([, path]) => path).map(([label, path]) => <li key={label}><button className="btn-link" onClick={() => onOpenFile(path!)}>{label}</button></li>)}</ul></section>
      </aside>
    </div>

    {liveIndex !== null && liveCards[liveIndex] && <LiveMode cards={liveCards} index={liveIndex} stories={files.stories} reminder={reminders[0] ?? null} title={`${company}: ${round.label}`} onIndex={setLiveIndex} onClose={() => setLiveIndex(null)} />}
  </section>;
}

const KIND_LABEL: Record<CardKind, string> = { question: "Question", gap: "Gap", followup: "Follow-up", ask: "Ask them" };

function storyLabel(value: string, stories: Record<string, string>): string {
  const id = /^(S\d{1,2})\b/.exec(value)?.[1];
  return id && stories[id] && !value.includes(stories[id]!) ? `${value} (${stories[id]})` : value;
}

function CardFields({ card, stories, large = false }: { card: InterviewCard; stories: Record<string, string>; large?: boolean }) {
  return <dl className={`icard-fields ${large ? "is-large" : ""}`}>
    {card.why && <div><dt>Why they ask</dt><dd>{card.why}</dd></div>}
    {card.gap && <div><dt>Requirement</dt><dd>{card.gap}</dd></div>}
    {card.example && <div><dt>Real example</dt><dd>{storyLabel(card.example, stories)}</dd></div>}
    {card.closest && <div><dt>Closest real experience</dt><dd>{storyLabel(card.closest, stories)}</dd></div>}
    {card.cues.length > 0 && <div><dt>Cues</dt><dd><ul className="cue-list">{card.cues.map((cue) => <li key={cue}>{cue}</li>)}</ul></dd></div>}
    {card.approach.length > 0 && <div><dt>Your approach</dt><dd><ol className="step-list">{card.approach.map((step) => <li key={step}>{step}</li>)}</ol></dd></div>}
    {card.ramp && <div><dt>Ramp plan</dt><dd>{card.ramp}</dd></div>}
    {card.landOn && <div className="is-land"><dt>Land on</dt><dd>{card.landOn}</dd></div>}
    {card.careful && <div className="is-careful"><dt>Careful</dt><dd>{card.careful}</dd></div>}
    {card.notes && !large && <div><dt>Notes</dt><dd className="iv-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(card.notes) }} /></div>}
  </dl>;
}

function InterviewCardItem({ card, index, open, stories, onToggle, onLive }: { card: InterviewCard; index: number; open: boolean; stories: Record<string, string>; onToggle: () => void; onLive: () => void }) {
  const hasDetail = Boolean(card.why || card.example || card.cues.length || card.approach.length || card.landOn || card.gap || card.notes);
  return <li className={`icard is-${card.kind} ${open ? "is-open" : ""}`}>
    <button className="icard-toggle" aria-expanded={hasDetail ? open : undefined} onClick={hasDetail ? onToggle : undefined}>
      <span className="icard-num">{index + 1}</span>
      <span className="icard-q">{card.question}</span>
      <span className="icard-kind">{KIND_LABEL[card.kind]}</span>
    </button>
    {!open && card.cues.length > 0 && <p className="icard-peek">{card.cues.join("  ·  ")}</p>}
    {open && <div className="icard-body"><CardFields card={card} stories={stories} /><button className="btn-link" onClick={onLive}>Practice in live mode</button></div>}
  </li>;
}

function LiveMode({ cards, index, stories, reminder, title, onIndex, onClose, compact = false }: { cards: InterviewCard[]; index: number; stories: Record<string, string>; reminder: string | null; title: string; onIndex: (index: number) => void; onClose: () => void; compact?: boolean }) {
  const [seconds, setSeconds] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    void window.sensei.interviews.setLiveCollapsed(next).catch(() => undefined);
  }
  const dialogRef = useRef<HTMLDivElement>(null);
  const card = cards[index]!;
  useEffect(() => { setSeconds(0); }, [index]);
  useEffect(() => { const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => opener?.focus?.();
  }, []);
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    else if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === " ") { event.preventDefault(); onIndex(Math.min(cards.length - 1, index + 1)); }
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); onIndex(Math.max(0, index - 1)); }
    else if (event.key.toLowerCase() === "r") setSeconds(0);
    else if (compact && event.key.toLowerCase() === "c") toggleCollapsed();
  }
  const over = seconds >= LIVE_TARGET_SECONDS;
  return <div className={`live ${compact ? "is-compact" : ""} ${collapsed ? "is-collapsed" : ""}`} role="dialog" aria-modal="true" aria-label={`Live mode, ${title}`} tabIndex={-1} ref={dialogRef} onKeyDown={onKeyDown}>
    <header className="live-head">
      <span>{title}</span>
      <span className="live-count">{index + 1} of {cards.length}</span>
      <span className={`live-timer ${over ? "is-over" : ""}`} aria-live="off" title={`Aim for under ${LIVE_TARGET_SECONDS} seconds. R resets.`}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
      {compact && <button className="btn-quiet" aria-pressed={collapsed} title="Shortcut: C" onClick={toggleCollapsed}>{collapsed ? "Expand" : "Collapse"}</button>}
      <button className="btn-quiet" onClick={onClose}>{compact ? "Close" : "Exit"}</button>
    </header>
    <div className="live-card">
      <p className="live-kind">{KIND_LABEL[card.kind]}</p>
      <h2>{card.question}</h2>
      {collapsed ? card.cues.length > 0 && <p className="live-strip-cues">{card.cues.join("  ·  ")}</p> : <CardFields card={card} stories={stories} large={!compact} />}
    </div>
    {!collapsed && <footer className="live-foot">
      <button className="btn-quiet" disabled={index === 0} onClick={() => onIndex(index - 1)}>Previous</button>
      {reminder && <p className="live-reminder">{reminder}</p>}
      <button className="btn-primary" disabled={index === cards.length - 1} onClick={() => onIndex(index + 1)}>Next</button>
    </footer>}
  </div>;
}

/** Body of the compact always-on-top live window (`?live=1`). */
export function LiveWindow({ jobId, roundId }: { jobId: string; roundId: string }) {
  const [state, setState] = useState<{ cards: InterviewCard[]; stories: Record<string, string>; reminder: string | null; title: string } | null>(null);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  useEffect(() => {
    void (async () => {
      const [overview, jobs] = await Promise.all([window.sensei.interviews.getOverview(jobId), window.sensei.jobs.list()]);
      const round = overview?.rounds.find((candidate) => candidate.id === roundId);
      if (!round) { setError("This interview round could not be found."); return; }
      const job = jobs.find((candidate) => candidate.id === jobId);
      const [prep, bank, stories] = await Promise.all([readText(round.artifactPaths.prep), readText(round.artifactPaths.questionBank), readText("profile/story_bank.md")]);
      const reminders = listItems(markdownSections(prep).find((section) => /before you start/i.test(section.title))?.body ?? "");
      setState({ cards: parseInterviewCards(bank), stories: storyTitles(stories), reminder: reminders[0] ?? null, title: `${job?.company ?? overview?.company ?? jobId}: ${round.label}` });
    })().catch(() => setError("Unable to load this round."));
  }, [jobId, roundId]);
  useEffect(() => { document.title = state ? `Live: ${state.title}` : "Sensei Live"; }, [state]);
  useEffect(() => { document.documentElement.dataset.theme = window.localStorage.getItem("sensei-theme-v2") === "dark" ? "dark" : "light"; }, []);
  if (error) return <p className="iv-empty live-window-message">{error}</p>;
  if (!state) return <p className="iv-empty live-window-message">Loading…</p>;
  if (!state.cards.length) return <p className="iv-empty live-window-message">This round has no question bank yet.</p>;
  return <LiveMode compact cards={state.cards} index={index} stories={state.stories} reminder={state.reminder} title={state.title} onIndex={setIndex} onClose={() => window.close()} />;
}
