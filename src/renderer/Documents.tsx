import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_PDF_TEXT_SIZE, type PdfFreshness, type ChallengeExercise, type ChallengePractice, type FilePreview, type PdfTextSize } from "../shared/schemas";
// pdfjs-dist ships the browser runtime without declarations for this subpath.
// @ts-expect-error The Vite browser bundle is intentionally imported directly.
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { filterChallengeExercises, parseChallengePractice, type ChallengeFilter } from "./challenge-practice";
import { evaluationCategoryLabels, evaluationCredits, evaluationLabel, evaluationSection, parseEvaluationRequirements } from "./evaluation-model";
import { parseQuestionBank, type QuestionEntry } from "./question-navigation";
import { inferCodeLanguage, markdownHtml, sanitizeHtml } from "./markdown";
import { formatBytes, messageOf, useAnnounce } from "./app-shared";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

/** Tells the app a job's resume or cover letter PDF was made (`jobs/<id>/…_Resume.md` or `cover_letter.md`). */
export function pdfsCreated(sourcePath: string): void {
  const [root, jobId, file] = sourcePath.split("/");
  if (root === "jobs" && jobId && file && (/_Resume\.md$/i.test(file) || file.toLowerCase() === "cover_letter.md")) window.dispatchEvent(new CustomEvent("sensei-pdfs-created", { detail: jobId }));
}

/** Tells open export controls that a document was saved or a PDF was made, so they re-check which PDFs are current. */
export function documentsChanged(): void { window.dispatchEvent(new CustomEvent("sensei-docs-changed")); }

/** A job's documents with each PDF's state (`electron/pdf-freshness.ts` owns the rule); re-read when documents change. */
export function usePdfFreshness(jobId: string | null): PdfFreshness[] {
  const [items, setItems] = useState<PdfFreshness[]>([]);
  useEffect(() => {
    if (!jobId) { setItems([]); return; }
    let cancelled = false;
    const load = () => void window.sensei.files.pdfFreshness(jobId).then((next) => { if (!cancelled) setItems(next); }, () => undefined);
    load();
    window.addEventListener("sensei-docs-changed", load);
    window.addEventListener("focus", load);
    return () => { cancelled = true; window.removeEventListener("sensei-docs-changed", load); window.removeEventListener("focus", load); };
  }, [jobId]);
  return items;
}

export function DocumentView({ preview, isBaseResume, focusAnchor, onExported, onDirtyChange, onSaved }: { preview: FilePreview; isBaseResume: boolean; focusAnchor?: string; onExported: () => void; onDirtyChange: (dirty: boolean) => void; onSaved: (preview: FilePreview) => Promise<void> }) {
  if (!preview.canPreview) return <div className="unsupported-state"><div className="file-badge">{preview.fileType.toUpperCase()}</div><h2>Preview unavailable</h2><p>{preview.message}</p><div className="file-meta"><span>{formatBytes(preview.sizeBytes)}</span><span>Modified {new Date(preview.modifiedAt).toLocaleString()}</span></div>{isBaseResume && <span className="label verified">Configured base resume</span>}</div>;
  if (preview.contentType === "data-url" && preview.dataUrl) return preview.fileType === "pdf" ? <PdfDocument preview={preview} /> : <div className="image-document"><img src={preview.dataUrl} alt={preview.name} /></div>;
  if (preview.contentType === "html" && preview.content) return <article className="document rich-document"><div className="document-meta"><span>{preview.relativePath}</span><span>{formatBytes(preview.sizeBytes)} · {new Date(preview.modifiedAt).toLocaleDateString()}</span>{isBaseResume && <span className="label verified">Configured base resume</span>}</div><div dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.content) }} />{preview.message && <p className="preview-note">{preview.message}</p>}</article>;
  const challengePractice = preview.name === "practice_labs.json" ? parseChallengePractice(preview.content) : null;
  if (challengePractice) return <ChallengePracticeDocument preview={preview} practice={challengePractice} focusAnchor={focusAnchor} />;
  const isMarkdown = preview.name.toLowerCase().endsWith(".md");
  if (isMarkdown) return <MarkdownDocument preview={preview} focusAnchor={focusAnchor} onExported={onExported} onDirtyChange={onDirtyChange} onSaved={onSaved} />;
  return <article className="document"><div className="document-meta"><span>{preview.relativePath}</span><span>{formatBytes(preview.sizeBytes)} · {new Date(preview.modifiedAt).toLocaleDateString()}</span>{isBaseResume && <span className="label verified">Configured base resume</span>}</div><pre>{preview.content}</pre></article>;
}

function ChallengePracticeDocument({ preview, practice, focusAnchor }: { preview: FilePreview; practice: ChallengePractice; focusAnchor?: string }) {
  const articleRef = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState<ChallengeFilter>("all");
  const [currentId, setCurrentId] = useState(practice.exercises[0]?.id ?? "");
  const [revealedHints, setRevealedHints] = useState<string[]>([]);
  const [solutionOpen, setSolutionOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const exercises = filterChallengeExercises(practice, filter);
  useEffect(() => {
    if (!focusAnchor) return;
    const target = practice.exercises.find((exercise) => exercise.id === focusAnchor || exercise.title === focusAnchor);
    if (target) { setFilter("all"); setCurrentId(target.id); }
  }, [focusAnchor, practice.exercises]);
  const current = exercises.find((exercise) => exercise.id === currentId) ?? exercises[0] ?? null;
  const currentIndex = current ? exercises.findIndex((exercise) => exercise.id === current.id) : -1;

  useEffect(() => {
    if (!exercises.some((exercise) => exercise.id === currentId)) setCurrentId(exercises[0]?.id ?? "");
  }, [filter, currentId, exercises]);

  useEffect(() => {
    setRevealedHints([]);
    setSolutionOpen(false);
  }, [current?.id]);

  useEffect(() => {
    const viewer = articleRef.current?.closest(".viewer-panel") as HTMLElement | null;
    if (!viewer) return;
    const sync = () => setShowBackToTop(viewer.scrollTop > 420);
    viewer.addEventListener("scroll", sync, { passive: true });
    sync();
    return () => viewer.removeEventListener("scroll", sync);
  }, []);

  function chooseExercise(id: string) {
    setCurrentId(id);
    const viewer = articleRef.current?.closest(".viewer-panel");
    viewer?.scrollTo({ top: Math.max(0, articleRef.current!.offsetTop - 18), behavior: "smooth" });
  }

  function step(direction: -1 | 1) {
    const next = exercises[Math.max(0, Math.min(exercises.length - 1, currentIndex + direction))];
    if (next) chooseExercise(next.id);
  }

  function resetReveals() {
    setRevealedHints([]);
    setSolutionOpen(false);
  }

  return <article ref={articleRef} className="document challenge-practice">
    <div className="document-meta">
      <span>{preview.relativePath}</span>
      <span>{formatBytes(preview.sizeBytes)} · {new Date(preview.modifiedAt).toLocaleDateString()}</span>
      <span className="label verified">Practice mode</span>
    </div>
    <header className="challenge-hero">
      <div><span className="eyebrow">Technical challenge</span><h2>{practice.title}</h2><p>{practice.company} · {practice.role}</p></div>
      <div className="challenge-mode"><small>Assessment mode</small><strong>{practice.assessmentMode.replaceAll("_", " ")}</strong><span>{practice.sourceBasis.replaceAll("_", " ")}</span></div>
    </header>
    {!practice.realPromptSupplied && <p className="challenge-notice"><strong>Practice approximation.</strong> {practice.approximationNotice ?? "These exercises are based on the known process and role, not an employer-supplied assessment prompt."}</p>}
    <div className="challenge-toolbar">
      <div className="challenge-filters" aria-label="Filter challenge exercises">
        {([["all", "All"], ["coding", "Coding labs"], ["verbal", "Verbal scenarios"]] as Array<[ChallengeFilter, string]>).map(([value, label]) => <button key={value} className={filter === value ? "is-active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      <div className="challenge-navigation">
        <label><span>Jump to exercise</span><select aria-label="Jump to challenge exercise" value={current?.id ?? ""} onChange={(event) => chooseExercise(event.target.value)}>{exercises.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.title}</option>)}</select></label>
        <div className="challenge-stepper">
          <button disabled={currentIndex <= 0} onClick={() => step(-1)} aria-label="Previous exercise">←</button>
          <span>{exercises.length ? `${currentIndex + 1} of ${exercises.length}` : "No exercises"}</span>
          <button disabled={currentIndex < 0 || currentIndex >= exercises.length - 1} onClick={() => step(1)} aria-label="Next exercise">→</button>
        </div>
        <button className="challenge-reset" disabled={!revealedHints.length && !solutionOpen} onClick={resetReveals}>Reset reveals</button>
      </div>
    </div>
    {current ? <ChallengeExerciseCard exercise={current} revealedHints={revealedHints} solutionOpen={solutionOpen} onRevealHint={(key) => setRevealedHints((currentHints) => currentHints.includes(key) ? currentHints.filter((item) => item !== key) : [...currentHints, key])} onToggleSolution={() => setSolutionOpen((open) => !open)} /> : <div className="viewer-state">No exercises match this filter.</div>}
    {showBackToTop && <button className="question-back-top challenge-back-top" onClick={() => articleRef.current?.closest(".viewer-panel")?.scrollTo({ top: 0, behavior: "smooth" })}>↑ Top</button>}
  </article>;
}

function ChallengeExerciseCard({ exercise, revealedHints, solutionOpen, onRevealHint, onToggleSolution }: { exercise: ChallengeExercise; revealedHints: string[]; solutionOpen: boolean; onRevealHint: (key: string) => void; onToggleSolution: () => void }) {
  return <section className="challenge-card">
    <div className="challenge-card-heading">
      <div><span className={`challenge-type is-${exercise.type}`}>{exercise.type === "coding" ? "Coding / implementation" : "Verbal scenario"}</span><h3>{exercise.title}</h3></div>
      <div className="challenge-card-meta"><span>{exercise.difficulty}</span><strong>{exercise.timeboxMinutes} min</strong></div>
    </div>
    <p className="challenge-relevance"><strong>Why this fits the role</strong>{exercise.jobRelevance}</p>
    <ChallengeSection title="Challenge" content={exercise.prompt} />
    {exercise.starterContext && <ChallengeSection title={exercise.type === "coding" ? "Starter context" : "Answer setup"} content={exercise.starterContext} code={exercise.type === "coding"} />}
    <ChallengeList title="Requirements" items={exercise.requirements} />
    {exercise.expectedOutput && <ChallengeSection title="Expected output" content={exercise.expectedOutput} />}
    <ChallengeList title="Acceptance tests" items={exercise.acceptanceTests} />
    <div className="challenge-reveals">
      <h4>Progressive help</h4>
      {exercise.hints.map((hint, index) => {
        const key = `${exercise.id}-hint-${index}`;
        const open = revealedHints.includes(key);
        return <div className="challenge-reveal" key={key}><button aria-expanded={open} onClick={() => onRevealHint(key)}><span>{open ? "Hide" : "Reveal"} hint {index + 1}</span><span>{open ? "−" : "+"}</span></button>{open && <div className="challenge-reveal-content" dangerouslySetInnerHTML={{ __html: markdownHtml(hint) }} />}</div>;
      })}
      <div className="challenge-reveal is-solution"><button aria-expanded={solutionOpen} onClick={onToggleSolution}><span>{solutionOpen ? "Hide solution" : "Show solution"}</span><span>{solutionOpen ? "−" : "+"}</span></button>{solutionOpen && <div className="challenge-reveal-content"><div dangerouslySetInnerHTML={{ __html: markdownHtml(exercise.solution) }} /><h5>Why it works</h5><div dangerouslySetInnerHTML={{ __html: markdownHtml(exercise.explanation) }} /></div>}</div>
    </div>
    <div className="challenge-review-grid">
      <ChallengeList title="What the interviewer evaluates" items={exercise.evaluationCriteria} />
      <ChallengeList title="Common mistakes" items={exercise.commonMistakes} />
      <ChallengeList title="Likely follow-ups" items={exercise.followUpProbes} />
    </div>
    <div className="challenge-score"><h4>Self-scoring rubric</h4>{exercise.scoringRubric.map((item) => <div key={item.criterion}><strong>{item.points} pts</strong><span>{item.criterion}</span><p>{item.strongPerformance}</p></div>)}</div>
  </section>;
}

function ChallengeSection({ title, content, code = false }: { title: string; content: string; code?: boolean }) {
  const codeLanguage = inferCodeLanguage(content);
  return <section className="challenge-section"><h4>{title}</h4>{code
    ? <div dangerouslySetInnerHTML={{ __html: markdownHtml(`\`\`\`${codeLanguage}\n${content}\n\`\`\``) }} />
    : <div dangerouslySetInnerHTML={{ __html: markdownHtml(content) }} />}</section>;
}

function ChallengeList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <section className="challenge-section"><h4>{title}</h4><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}

function MarkdownDocument({ preview, focusAnchor, onExported, onDirtyChange, onSaved }: { preview: FilePreview; focusAnchor?: string; onExported: () => void; onDirtyChange: (dirty: boolean) => void; onSaved: (preview: FilePreview) => Promise<void> }) {
  const articleRef = useRef<HTMLElement>(null);
  const initialContent = preview.content ?? "";
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [baseline, setBaseline] = useState(initialContent);
  const [draft, setDraft] = useState(initialContent);
  const [expectedModifiedAt, setExpectedModifiedAt] = useState(preview.modifiedAt);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [questionFilter, setQuestionFilter] = useState<QuestionFilter>("all");
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null);
  const [backButtonPosition, setBackButtonPosition] = useState<{ left: number; top: number } | null>(null);
  const editable = /^(jobs|debrief|resumes)\//.test(preview.relativePath);
  const isQuestionBank = preview.name === "question_bank.md";
  const isEvaluation = preview.name.toLowerCase() === "evaluation.md";
  const dirty = draft !== baseline;
  const canExport = /_Resume\.md$/i.test(preview.name) || preview.name === "cover_letter.md" || preview.name === "submission_checklist.md" || (preview.relativePath.startsWith("resumes/") && preview.name.toLowerCase().endsWith(".md"));
  const visibleMarkdown = isQuestionBank ? filterQuestionBank(draft, questionFilter) : draft;
  const questions = isQuestionBank ? parseQuestionBank(visibleMarkdown) : [];
  const questionKey = questions.map((question) => question.id).join("|");

  useEffect(() => {
    if (!focusAnchor || mode !== "view" || !articleRef.current) return;
    const normalized = focusAnchor.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 54);
    const target = articleRef.current.querySelector<HTMLElement>(`#question-${normalized}, #question-${normalized}-1, #heading-${normalized}`);
    const viewer = articleRef.current.closest(".viewer-panel") as HTMLElement | null;
    if (!target || !viewer) return;
    window.requestAnimationFrame(() => {
      const top = viewer.scrollTop + target.getBoundingClientRect().top - viewer.getBoundingClientRect().top - 92;
      viewer.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      target.classList.add("is-question-target");
      window.setTimeout(() => target.classList.remove("is-question-target"), 1300);
    });
  }, [focusAnchor, mode, questionKey]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  async function save() {
    if (!editable || !dirty || state === "saving") return;
    setState("saving");
    setMessage("");
    let saved: FilePreview;
    try {
      if (typeof window.sensei.files.saveMarkdown !== "function") throw new Error("The editor bridge is out of date. Fully quit Sensei and run npm run dev again.");
      saved = await window.sensei.files.saveMarkdown({ relativePath: preview.relativePath, content: draft, expectedContent: baseline, expectedModifiedAt });
      const content = saved.content ?? draft;
      setBaseline(content);
      setDraft(content);
      setExpectedModifiedAt(saved.modifiedAt);
      setState("saved");
      setMessage("Saved locally");
      documentsChanged();
    } catch (caught) {
      setState("error");
      setMessage(messageOf(caught, "Unable to save this Markdown file."));
      return;
    }
    try { await onSaved(saved); }
    catch { setMessage("Saved locally. Rescan to refresh the sidebar."); }
  }

  async function reloadFromDisk() {
    if (dirty && !window.confirm("Discard your unsaved changes and reload this file?")) return;
    try {
      const latest = await window.sensei.files.preview(preview.relativePath);
      const content = latest.content ?? "";
      setBaseline(content);
      setDraft(content);
      setExpectedModifiedAt(latest.modifiedAt);
      setState("idle");
      setMessage("");
      await onSaved(latest);
    } catch (caught) {
      setState("error");
      setMessage(messageOf(caught, "Unable to reload this Markdown file."));
    }
  }

  useEffect(() => {
    if (mode !== "edit") return;
    const saveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", saveShortcut);
    return () => window.removeEventListener("keydown", saveShortcut);
  });

  useEffect(() => {
    if (!isQuestionBank || mode !== "view" || !articleRef.current) {
      setBackButtonPosition(null);
      return;
    }
    const viewer = articleRef.current.closest(".viewer-panel") as HTMLElement | null;
    if (!viewer) return;
    const syncNavigation = () => {
      const viewerRect = viewer.getBoundingClientRect();
      setBackButtonPosition(viewer.scrollTop > 420 ? { left: viewerRect.right - 82, top: viewerRect.bottom - 56 } : null);
      const threshold = viewerRect.top + 145;
      let active = questions[0]?.id ?? null;
      for (const question of questions) {
        const element = articleRef.current?.querySelector<HTMLElement>(`#${question.id}`);
        if (element && element.getBoundingClientRect().top <= threshold) active = question.id;
      }
      setCurrentQuestionId((current) => current === active ? current : active);
    };
    const observer = new ResizeObserver(syncNavigation);
    observer.observe(viewer);
    viewer.addEventListener("scroll", syncNavigation, { passive: true });
    window.addEventListener("resize", syncNavigation);
    syncNavigation();
    return () => {
      observer.disconnect();
      viewer.removeEventListener("scroll", syncNavigation);
      window.removeEventListener("resize", syncNavigation);
    };
  }, [isQuestionBank, mode, questionKey]);

  function jumpToQuestion(questionId: string) {
    const article = articleRef.current;
    const viewer = article?.closest(".viewer-panel") as HTMLElement | null;
    const target = article?.querySelector<HTMLElement>(`#${questionId}`);
    if (!article || !viewer || !target) return;
    const toolbarHeight = article.querySelector<HTMLElement>(".question-toolbar")?.offsetHeight ?? 72;
    const top = viewer.scrollTop + target.getBoundingClientRect().top - viewer.getBoundingClientRect().top - toolbarHeight - 18;
    viewer.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    setCurrentQuestionId(questionId);
    target.classList.add("is-question-target");
    window.setTimeout(() => target.classList.remove("is-question-target"), 1100);
  }

  function stepQuestion(direction: -1 | 1) {
    if (!questions.length) return;
    const currentIndex = Math.max(0, questions.findIndex((question) => question.id === currentQuestionId));
    const nextIndex = Math.max(0, Math.min(questions.length - 1, currentIndex + direction));
    jumpToQuestion(questions[nextIndex].id);
  }

  function backToTop() {
    const viewer = articleRef.current?.closest(".viewer-panel");
    viewer?.scrollTo({ top: 0, behavior: "smooth" });
  }

  return <article ref={articleRef} className={`document markdown-document markdown-workspace ${isQuestionBank ? "question-bank-document" : ""}`}>
    <div className="document-meta">
      <span>{preview.relativePath}</span>
      <span>{formatBytes(new Blob([draft]).size)} · {new Date(expectedModifiedAt).toLocaleDateString()}</span>
      <span className={`edit-status ${dirty ? "is-dirty" : ""}`}>{dirty ? "Unsaved changes" : state === "saved" ? "Saved" : editable ? "Local artifact" : "Source locked"}</span>
      <span className="markdown-actions">
        {editable && <button className={`editor-button ${mode === "edit" ? "is-active" : ""}`} onClick={() => setMode(mode === "view" ? "edit" : "view")}>{mode === "view" ? "Edit Markdown" : "View document"}</button>}
        {mode === "edit" && <button className="editor-button" disabled={!dirty || state === "saving"} onClick={() => void save()}>{state === "saving" ? "Saving…" : "Save"}</button>}
        {mode === "edit" && <button className="editor-button" onClick={() => void reloadFromDisk()}>Reload</button>}
        {mode === "view" && canExport && <MarkdownExportButton relativePath={preview.relativePath} onExported={onExported} />}
      </span>
    </div>
    {message && <p className={`editor-message ${state === "error" ? "is-error" : ""}`} role="status">{message}</p>}
    {mode === "view" && isQuestionBank && <QuestionBankToolbar value={questionFilter} onChange={setQuestionFilter} questions={questions} currentQuestionId={currentQuestionId} onJump={jumpToQuestion} onStep={stepQuestion} />}
    {mode === "edit"
      ? <div className="markdown-editor-grid"><div className="editor-pane"><div className="editor-pane-title">Markdown <span>Ctrl/⌘ S to save</span></div><textarea aria-label={`Edit ${preview.name}`} value={draft} spellCheck="true" onChange={(event) => { setDraft(event.target.value); setState("idle"); setMessage(""); }} /></div><div className="editor-preview"><div className="editor-pane-title">Live preview</div><div dangerouslySetInnerHTML={{ __html: markdownHtml(draft) }} /></div></div>
      : isEvaluation
        ? <EvaluationDocument markdown={visibleMarkdown} />
        : <div className={isQuestionBank ? "question-bank-content" : undefined} dangerouslySetInnerHTML={{ __html: markdownHtml(visibleMarkdown, questions) }} />}
    {isQuestionBank && backButtonPosition && createPortal(<button className="question-back-top" style={backButtonPosition} onClick={backToTop} aria-label="Back to top of question bank">↑ Top</button>, document.body)}
  </article>;
}

function EvaluationDocument({ markdown }: { markdown: string }) {
  const requirements = parseEvaluationRequirements(markdown);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  if (!requirements.length) return <div dangerouslySetInnerHTML={{ __html: markdownHtml(markdown) }} />;
  const score = evaluationLabel(markdown, /(?:Weighted Fit Score|Total\s*\/\s*Final Score)/i) ?? "Not recorded";
  const recommendation = evaluationLabel(markdown, /Apply Recommendation/i) ?? evaluationLabel(markdown, /Gate Status/i) ?? "Review the evidence breakdown";
  const confidence = evaluationLabel(markdown, /Fit Confidence/i) ?? "Not recorded";
  const insightSections = [
    ["Direct matches", /Direct Matches/i],
    ["Transferable evidence", /Transferable Evidence/i],
    ["Gaps and risks", /(?:Important Gaps|Gaps and Risks|Hard Blockers)/i],
    ["Tailoring rationale", /Tailoring Rationale/i],
  ] as const;
  const insights = insightSections
    .map(([title, pattern]) => ({ title, content: evaluationSection(markdown, pattern) }))
    .filter((section) => section.content);
  const audit = /<!-- jobsensei-application-audit:start -->([\s\S]*?)<!-- jobsensei-application-audit:end -->/i.exec(markdown)?.[1]?.trim() ?? "";
  const categories = Object.keys(evaluationCategoryLabels).map((category) => {
    const rows = requirements.filter((row) => row.category === category);
    const available = rows.reduce((sum, row) => sum + row.weight, 0);
    const earned = rows.reduce((sum, row) => sum + row.weight * (evaluationCredits[row.classification] ?? 0), 0);
    return { category, rows, available, earned };
  }).filter((group) => group.rows.length);
  const narrative = markdown
    .replace(/###\s+Requirement Scoring\s*\n[\s\S]*?(?=\n#{1,3}\s+|<!-- jobsensei-application-audit:start -->|$)/i, "")
    .replace(/<!-- jobsensei-application-audit:start -->[\s\S]*?<!-- jobsensei-application-audit:end -->/i, "")
    .trim();
  const activeCategory = openCategory ?? categories[0]?.category ?? null;
  function openCategoryDetails(category: string) {
    setOpenCategory(category);
    window.requestAnimationFrame(() => document.getElementById(`evaluation-category-${category}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }
  return <div className="evaluation-document">
    <section className="evaluation-summary" aria-label="Evaluation summary">
      <div className="evaluation-score-card"><span>Fit score</span><strong>{score.replace(/^.*?(\d(?:\.\d+)?\s*\/\s*5).*$/i, "$1")}</strong><small>Direct 100% · strong 75% · adjacent 55%</small></div>
      <div><span>Apply recommendation</span><strong>{recommendation}</strong></div>
      <div><span>Confidence</span><strong>{confidence}</strong></div>
    </section>
    <section className="evaluation-category-section">
      <div className="evaluation-section-heading"><div><span className="eyebrow">Category coverage</span><h2>Where the score comes from</h2></div><small>{requirements.length} scored requirements</small></div>
      <div className="evaluation-category-grid">{categories.map((group) => {
        const percent = group.available ? Math.round(group.earned / group.available * 100) : 0;
        return <button className={`evaluation-category-card ${activeCategory === group.category ? "is-active" : ""}`} type="button" key={group.category} aria-controls={`evaluation-category-${group.category}`} aria-expanded={activeCategory === group.category} onClick={() => openCategoryDetails(group.category)}><span>{evaluationCategoryLabels[group.category]}</span><strong>{group.earned.toFixed(1)} <small>/ {group.available}%</small></strong><span className="evaluation-category-bar" aria-label={`${percent}% credit`}><i style={{ width: `${percent}%` }} /></span><small>{percent}% of available credit · View requirements</small></button>;
      })}</div>
    </section>
    {insights.length > 0 && <section className="evaluation-insights"><div className="evaluation-section-heading"><div><span className="eyebrow">Decision context</span><h2>What matters most</h2></div></div><div>{insights.map((section) => <article key={section.title}><h3>{section.title}</h3><div dangerouslySetInnerHTML={{ __html: markdownHtml(section.content) }} /></article>)}</div></section>}
    <section className="evaluation-requirements">
      <div className="evaluation-section-heading"><div><span className="eyebrow">Requirement breakdown</span><h2>Evidence by requirement</h2></div><small>Open a category to inspect its evidence</small></div>
      {categories.map((group) => <details id={`evaluation-category-${group.category}`} key={group.category} open={activeCategory === group.category} onToggle={(event) => { if (event.currentTarget.open) setOpenCategory(group.category); }}><summary><span>{evaluationCategoryLabels[group.category]}</span><small>{group.rows.length} requirements · {group.earned.toFixed(1)} / {group.available}%</small></summary><div className="evaluation-requirement-list">{group.rows.map((row, rowIndex) => <article className="evaluation-requirement" key={`${row.requirement}-${rowIndex}`}><div><span className={`evaluation-classification is-${row.classification}`}>{row.classification.replaceAll("_", " ")}</span>{row.material && <span className="evaluation-material">Material</span>}<strong>{row.requirement}</strong></div><dl><div><dt>Weight</dt><dd>{row.weight}%</dd></div><div><dt>Evidence</dt><dd><code>{row.evidence || "No eligible evidence"}</code></dd></div></dl></article>)}</div></details>)}
    </section>
    {audit && <details className="evaluation-audit"><summary><span>Application audits and review warnings</span><small>Resume, cover letter, and grounding details</small></summary><div dangerouslySetInnerHTML={{ __html: markdownHtml(audit) }} /></details>}
    <details className="evaluation-source-notes"><summary>Full evaluation notes</summary><div dangerouslySetInnerHTML={{ __html: markdownHtml(narrative) }} /></details>
  </div>;
}

type QuestionFilter = "all" | "primary" | "followups" | "later" | "ask";

function QuestionBankToolbar({ value, onChange, questions, currentQuestionId, onJump, onStep }: { value: QuestionFilter; onChange: (value: QuestionFilter) => void; questions: QuestionEntry[]; currentQuestionId: string | null; onJump: (questionId: string) => void; onStep: (direction: -1 | 1) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const options: Array<[QuestionFilter, string]> = [["all", "All"], ["primary", "Primary"], ["followups", "Follow-ups"], ["later", "Later round"], ["ask", "Questions to ask"]];
  const normalizedQuery = query.trim().toLowerCase();
  const matches = questions.filter((question) => !normalizedQuery || `${question.text} ${question.section}`.toLowerCase().includes(normalizedQuery));
  const currentIndex = questions.findIndex((question) => question.id === currentQuestionId);
  function choose(question: QuestionEntry) {
    onJump(question.id);
    setQuery("");
    setOpen(false);
  }
  return <div className="question-toolbar">
    <div className="question-filters" aria-label="Filter interview questions">{options.map(([id, label]) => <button key={id} className={value === id ? "is-active" : ""} aria-pressed={value === id} onClick={() => { onChange(id); setQuery(""); setOpen(false); }}>{label}</button>)}</div>
    <div className="question-navigation">
      <div className="question-jump" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
        <input
          aria-label="Jump to an interview question"
          aria-autocomplete="list"
          aria-controls="question-jump-results"
          aria-expanded={open}
          placeholder="Jump to question…"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.max(0, Math.min(matches.length - 1, index + 1))); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
            if (event.key === "Enter" && open && matches[activeIndex]) { event.preventDefault(); choose(matches[activeIndex]); }
            if (event.key === "Escape") setOpen(false);
          }}
        />
        {open && <div className="question-jump-results" id="question-jump-results" role="listbox">
          {matches.length === 0 && <span className="question-jump-empty">No matching questions</span>}
          {matches.map((question, index) => <div key={question.id}>
            {(index === 0 || matches[index - 1].section !== question.section) && <span className="question-result-section">{question.section}</span>}
            <button className={index === activeIndex ? "is-active" : ""} role="option" aria-selected={question.id === currentQuestionId} title={question.text} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(question)}>{question.text}</button>
          </div>)}
        </div>}
      </div>
      <div className="question-stepper">
        <button disabled={currentIndex <= 0} onClick={() => onStep(-1)} aria-label="Previous question">←</button>
        <span>{questions.length ? `Question ${Math.max(0, currentIndex) + 1} of ${questions.length}` : "No questions"}</span>
        <button disabled={currentIndex < 0 || currentIndex >= questions.length - 1} onClick={() => onStep(1)} aria-label="Next question">→</button>
      </div>
    </div>
  </div>;
}

function filterQuestionBank(markdown: string, filter: QuestionFilter): string {
  if (filter === "all") return markdown;
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const preamble: string[] = [];
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      current = { heading: heading[1].toLowerCase(), lines: [line] };
      sections.push(current);
    } else if (current) current.lines.push(line);
    else preamble.push(line);
  }
  const matches = (heading: string): boolean => {
    if (filter === "primary") return /primary(?:.*round)?|recruiter|hiring.manager|customer.facing|behavioral/i.test(heading);
    if (filter === "followups") return /follow.?up/i.test(heading);
    if (filter === "later") return /secondary|later.round|technical|domain/i.test(heading);
    return /questions to ask|reverse/i.test(heading);
  };
  const selected = sections.filter((section) => matches(section.heading));
  if (!selected.length) return `${preamble.join("\n")}\n\n## No matching section\n\nThis legacy question bank does not label questions for this filter.`;
  return [...preamble, ...selected.flatMap((section) => ["", ...section.lines])].join("\n");
}

export function PdfTextSizeSelect({ value, onChange, disabled }: { value: PdfTextSize; onChange: (value: PdfTextSize) => void; disabled: boolean }) {
  return <label className="pdf-text-size"><span>PDF text</span><select aria-label="PDF text size" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as PdfTextSize)}><option value="auto">Auto fit</option><option value="large">5% larger</option><option value="largest">10% larger</option></select></label>;
}

function MarkdownExportButton({ relativePath, onExported }: { relativePath: string; onExported: () => void }) {
  const stale = usePdfFreshness(relativePath.startsWith("jobs/") ? relativePath.split("/")[1] ?? null : null).some((item) => item.source === relativePath && item.state === "stale");
  const announce = useAnnounce();
  const [state, setState] = useState<"idle" | "working" | "done" | "warning" | "error">("idle");
  const [message, setMessage] = useState("");
  const [textSize, setTextSize] = useState<PdfTextSize>(DEFAULT_PDF_TEXT_SIZE);
  // Recruiter Edition: start from the recruiter's default PDF text size (Settings → Defaults for every candidate).
  useEffect(() => { if (FEATURES.candidates) void window.sensei.candidates.recruiterSettings().then((settings) => setTextSize(settings.defaults.pdfTextSize), () => undefined); }, []);
  async function exportPdf() {
    setState("working");
    try {
      const result = await window.sensei.files.exportMarkdownPdf(relativePath, textSize);
      const pageUse = result.pageFillRatio === null ? "" : `, ${Math.round(result.pageFillRatio * 100)}% page use`;
      setState(result.validationStatus === "warning" ? "warning" : "done");
      setMessage(`Saved ${result.relativePath} (${result.pageCount} page${result.pageCount === 1 ? "" : "s"}${pageUse})`);
      announce(`PDF saved: ${result.relativePath}${result.validationStatus === "warning" ? " (review: 2 pages)" : ""}.`);
      pdfsCreated(relativePath);
      documentsChanged();
      onExported();
    } catch (caught) {
      setState("error");
      setMessage(messageOf(caught, "PDF export failed."));
      announce(`PDF export failed: ${messageOf(caught, "unknown error")}`);
    }
  }
  return <span className="markdown-actions"><PdfTextSizeSelect value={textSize} onChange={setTextSize} disabled={state === "working"} /><button className="export-button" disabled={state === "working"} onClick={() => void exportPdf()}>{state === "working" ? "Creating PDF…" : stale ? "Update PDF" : "Approve & Export PDF"}</button>{stale && state !== "working" ? <span className="export-message is-stale" role="status">PDF out of date</span> : message && <span className={`export-message ${state === "error" ? "is-error" : ""}`} title={message}>{state === "done" ? "PDF saved" : state === "warning" ? "PDF saved - review 2 pages" : message}</span>}</span>;
}

function PdfDocument({ preview }: { preview: FilePreview }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!hostRef.current || !preview.dataUrl) return;
    hostRef.current.replaceChildren();
    const bytes = Uint8Array.from(atob(preview.dataUrl.split(",")[1] ?? ""), (char) => char.charCodeAt(0));
    void pdfjsLib.getDocument({ data: bytes }).promise.then(async (pdf: any) => {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        if (cancelled || !hostRef.current) return;
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.25 });
        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page";
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        hostRef.current.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
      }
    }).catch((caught: unknown) => { if (!cancelled) setError(messageOf(caught, "Unable to render this PDF.")); });
    return () => { cancelled = true; };
  }, [preview.dataUrl]);
  return <div className="pdf-document">{error ? <div className="unsupported-state"><h2>PDF preview unavailable</h2><p>{error}</p></div> : <div className="pdf-pages" ref={hostRef} />}</div>;
}
