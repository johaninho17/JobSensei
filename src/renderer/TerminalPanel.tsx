import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { type RunStatus } from "../shared/schemas";
import { type JobAction } from "./job-actions";
import "@xterm/xterm/css/xterm.css";
import { type PromptRequest, type QueueJob, formatBytes, formatRelativeDate, messageOf } from "./app-shared";

// What the Agy chat says first: the Recruiter Edition works for the open candidate, not for the person at the keyboard.
const AGY_GREETING = FEATURES.candidates
  ? "Working on the open candidate's folder only. Paste a job description or link to tailor their application, or choose an action below."
  : "Connected to local career evidence and job workspace. Paste a job description to screen and tailor your application, choose a recommended action, or enter a prompt below.";

type PastedBlock = {
  id: string;
  lineCount: number;
  byteCount: number;
  content: string;
  preview: string;
};

type ChatEntry = {
  id: string;
  sender: "user" | "assistant" | "system";
  title?: string;
  content: string;
  pastedBlock?: PastedBlock;
  steps?: string[];
  rawOutput?: string[];
  status?: "pending" | "running" | "success" | "error";
  startTime?: number;
  durationMs?: number;
  timestamp: string;
};

function stripAnsi(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[()][AB012]/g, "")
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r+/g, "\n");
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${seconds}.${tenths}s`;
}

export const RUN_KIND_LABEL: Record<RunStatus["kind"], string> = { fetch: "Job posting read", application: "Application", interview: "Interview prep" };
export const RUN_STATE_LABEL: Record<RunStatus["state"], string> = { running: "Running", passed: "Passed", warnings: "Passed with warnings", failed: "Needs fixes" };

/** The latest pipeline run, refreshed every few seconds while the Agy panel is open. */
function RunStatusBar({ run, onOpen }: { run: RunStatus | null; onOpen: (run: RunStatus) => void }) {
  // The run comes from the app's one run watcher; only the elapsed time ticks here, and only while a run is going.
  const [now, setNow] = useState(Date.now());
  const running = run?.state === "running";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!run) return null;
  const elapsed = Math.max(0, Math.round((now - Date.parse(run.at)) / 1000));
  const duration = run.state === "running" ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}` : run.durationSeconds !== null ? `${run.durationSeconds}s` : null;
  const when = run.state === "running" ? null : formatRelativeDate(run.at);
  return <section className={`run-status is-${run.state}`} aria-label="Latest run" aria-live="polite">
    <div className="run-status-line">
      <span className="run-dot" aria-hidden="true" />
      <strong>{RUN_KIND_LABEL[run.kind]}</strong>
      <span className="run-label">{run.label}</span>
      {run.jobId && run.kind !== "fetch" && <button className="btn-link" onClick={() => onOpen(run)}>Open</button>}
    </div>
    <p className="run-status-meta">{[RUN_STATE_LABEL[run.state], duration, run.fitScore !== null ? `fit ${run.fitScore.toFixed(1)}` : null, run.gate, when].filter(Boolean).join(", ")}</p>
    {run.issues.length > 0 && <details className="run-issues"><summary>{run.issues.length === 1 ? "1 issue" : `Top ${run.issues.length} issues`}</summary><ul>{run.issues.map((issue, index) => <li key={`${issue.code}-${index}`} className={`is-${issue.severity}`}><code>{issue.code}</code> {issue.message}</li>)}</ul></details>}
  </section>;
}

export function TerminalPanel({ latestRun, cwd, selectedJobFiles, selectedCareerPaths, theme, visible, onClose, jobActions, promptRequest, onPromptHandled, onInsertPrompt, onOpenRun, onQueueJob, busyLabel }: { latestRun: RunStatus | null; onOpenRun: (run: RunStatus) => void; onQueueJob: QueueJob; busyLabel: string | null; cwd: string; selectedJobFiles: string[]; selectedCareerPaths: string[]; theme: "dark" | "light"; visible: boolean; onClose: () => void; jobActions: JobAction[]; promptRequest: PromptRequest | null; onPromptHandled: (id: number) => void; onInsertPrompt: (action: JobAction) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState("Starting terminal…");
  const [terminalReady, setTerminalReady] = useState(false);
  const terminalReadyRef = useRef(false);
  const [agyActive, setAgyActive] = useState(false);
  const [promptNotice, setPromptNotice] = useState("");
  const handledPromptId = useRef(0);
  const [viewMode, setViewMode] = useState<"chat" | "console">("chat");
  // Agy's own screens (first-run colour scheme and terms, sign-in, trust, file approvals) only show in Console; when
  // Agy is waiting on one, the panel switches there and says why, so nobody answers a screen they can't see.
  const [consoleNote, setConsoleNote] = useState<string | null>(null);
  // Once per waiting screen: switching back to Chat while it waits keeps Chat.
  const switchedForBlock = useRef(false);
  useEffect(() => {
    if (viewMode !== "chat") return;
    const timer = window.setInterval(() => {
      void window.sensei.terminal.status().then((state) => {
        if (!state.running || state.screen !== "blocked") { switchedForBlock.current = false; return; }
        if (switchedForBlock.current) return;
        switchedForBlock.current = true;
        setViewMode("console");
        setConsoleNote("Agy is waiting for you on its own screen (setup, sign-in, or an approval). Answer it here, then switch back to Chat.");
        window.setTimeout(() => fitRef.current?.fit(), 60);
      }).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [viewMode]);
  const [chatInput, setChatInput] = useState("");
  const [pastedAttachment, setPastedAttachment] = useState<PastedBlock | null>(null);
  const [expandedPastes, setExpandedPastes] = useState<Record<string, boolean>>({});
  const [expandedRawLogs, setExpandedRawLogs] = useState<Record<string, boolean>>({});
  const [liveNow, setLiveNow] = useState(Date.now());
  const chatStreamRef = useRef<HTMLDivElement>(null);
  const activeAsstIdRef = useRef<string | null>(null);
  const quietTimerRef = useRef<number | null>(null);
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([
    {
      id: "welcome",
      sender: "system",
      title: "JobSensei Copilot",
      content: AGY_GREETING,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (activeAsstIdRef.current) {
        setLiveNow(Date.now());
      }
    }, 200);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 38), 160);
    textarea.style.height = `${nextHeight}px`;
  }, [chatInput]);

  const executeCommand = (text: string, label?: string, attachedPaste?: PastedBlock) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const now = Date.now();
    const userContent = label ? `⚡ ${label}` : text;
    const userMsg: ChatEntry = {
      id: `user-${now}`,
      sender: "user",
      content: userContent,
      pastedBlock: attachedPaste,
      timestamp: time,
    };

    let payload = text;
    if (attachedPaste) {
      payload = text.trim() ? `${text.trim()}\n${attachedPaste.content}` : attachedPaste.content;
    }

    const asstId = `asst-${now}`;
    activeAsstIdRef.current = asstId;
    const commandSummary = label || (text.trim() ? (text.length > 40 ? `${text.slice(0, 40)}…` : text) : (attachedPaste ? `Pasted JD (${attachedPaste.lineCount} lines)` : "Task"));

    const asstMsg: ChatEntry = {
      id: asstId,
      sender: "assistant",
      title: label || "Task execution",
      content: "",
      steps: [`Starting: ${commandSummary}…`],
      status: "running",
      startTime: now,
      timestamp: time,
    };

    setChatEntries((prev) => [...prev, userMsg, asstMsg]);
    if (attachedPaste) {
      // A long paste that is not a job description goes to Agy as one bracketed paste.
      void window.sensei.terminal.write(`\x1b[200~${payload.replace(/\x1b\[20[01]~/g, "")}\x1b[201~`)
        .then(() => window.setTimeout(() => void window.sensei.terminal.write("\r"), 80));
    } else {
      void window.sensei.terminal.write(payload.endsWith("\n") ? payload : `${payload}\r`);
    }
  };

  /** Sends a message to Agy, after asking first if a queued job is running (a new message would interrupt it). */
  const sendToAgy = (text: string, label?: string, attachedPaste?: PastedBlock) => {
    if (busyLabel && !window.confirm(`Agy is working on ${busyLabel}. Send this now? It interrupts that run. Choose Cancel to keep your message and send it when the run is done.`)) {
      setChatInput(text);
      if (attachedPaste) setPastedAttachment(attachedPaste);
      return;
    }
    executeCommand(text, label, attachedPaste);
  };

  /**
   * A pasted JD or a bare job link goes to the job queue, so it never replaces a job that is running.
   * A long paste that is not a job description is sent to Agy as before.
   */
  const queueFromChat = async (text: string, attachedPaste?: PastedBlock) => {
    let ahead: number;
    try {
      ahead = await onQueueJob(attachedPaste ? { kind: "paste", text: attachedPaste.content, note: text } : { kind: "link", url: text }, true);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "NotQueued") return;
      // A link the app couldn't read: say why and ask for a paste (Agy can't fetch it either).
      if (!attachedPaste) {
        const now = Date.now();
        const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        setChatEntries((prev) => [...prev,
          { id: `user-${now}`, sender: "user", content: text, timestamp: time },
          { id: `queue-failed-${now}`, sender: "system", title: "Couldn't add this job", content: messageOf(caught, "This posting couldn't be read. Paste the job description instead."), timestamp: time },
        ]);
        return;
      }
      sendToAgy(text, undefined, attachedPaste);
      return;
    }
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const now = Date.now();
    setChatEntries((prev) => [...prev,
      { id: `user-${now}`, sender: "user", content: text, pastedBlock: attachedPaste, timestamp: time },
      { id: `queued-${now}`, sender: "system", title: "Added to the job queue", content: ahead ? `${ahead} ${ahead === 1 ? "job is" : "jobs are"} ahead of it. Agy starts it when the current run finishes.` : "Agy starts it as soon as it is free.", timestamp: time },
    ]);
  };

  const handleChatSubmit = (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    const prompt = chatInput.trim();
    if (!prompt && !pastedAttachment) return;
    const pasteToSend = pastedAttachment ?? undefined;
    setPastedAttachment(null);
    setChatInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    if (pasteToSend || /^https?:\/\/\S+$/i.test(prompt)) void queueFromChat(prompt, pasteToSend);
    else sendToAgy(prompt);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleChatSubmit();
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData("text");
    if (!text) return;
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length >= 3 || text.length > 250) {
      event.preventDefault();
      const id = `paste-${Date.now()}`;
      const preview = lines.filter((l) => l.trim().length > 0).slice(0, 3).join("\n") || text.slice(0, 150);
      setPastedAttachment({
        id,
        lineCount: lines.length,
        byteCount: new Blob([text]).size,
        content: text,
        preview,
      });
    }
  };

  const handleClear = () => {
    if (viewMode === "chat") {
      setChatEntries([
        {
          id: `welcome-${Date.now()}`,
          sender: "system",
          title: "JobSensei Copilot",
          content: AGY_GREETING,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } else {
      terminalRef.current?.clear();
      void window.sensei.terminal.write("\x0c");
    }
  };

  const toggleExpandPaste = (id: string) => {
    setExpandedPastes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleExpandRaw = (id: string) => {
    setExpandedRawLogs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    if (!hostRef.current) return;
    if (!window.sensei?.terminal) {
      setStatus("Terminal bridge unavailable; restart the app.");
      return;
    }
    const terminal = new Terminal({ cursorBlink: true, convertEol: true, fontFamily: "DM Mono, monospace", fontSize: 12, theme: terminalTheme(theme), scrollback: 4000 });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    const focusTerminal = () => terminal.focus();
    hostRef.current.addEventListener("click", focusTerminal);
    terminalRef.current = terminal;
    fitRef.current = fit;
    const removeData = window.sensei.terminal.onData((data) => {
      terminal.write(data);
      const clean = stripAnsi(data).trim();
      if (!clean) return;

      const rawLines = clean.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      const meaningfulLines = rawLines.filter((l) => l.length > 3 && !l.endsWith("%") && !l.endsWith("$") && !l.startsWith("]0;"));

      if (meaningfulLines.length && activeAsstIdRef.current) {
        const activeId = activeAsstIdRef.current;
        setChatEntries((prev) => prev.map((entry) => {
          if (entry.id !== activeId) return entry;
          const currentSteps = entry.steps ?? [];
          const newSteps = [...currentSteps];
          for (const line of meaningfulLines) {
            if (/(?:✓|done|complete|created|wrote|screening|snapshott|evaluat|prepar|finaliz|tailor|warn|error|building|analyz)/i.test(line)) {
              const stepText = line.replace(/^[✓\-*•→]\s*/, "");
              if (!newSteps.includes(stepText) && newSteps.length < 12) {
                newSteps.push(stepText);
              }
            }
          }
          const existingRaw = entry.rawOutput ?? [];
          const updatedRaw = [...existingRaw, ...meaningfulLines].slice(-60);
          const lastLine = meaningfulLines[meaningfulLines.length - 1];
          return {
            ...entry,
            steps: newSteps,
            rawOutput: updatedRaw,
            content: entry.content || (lastLine && !newSteps.includes(lastLine) ? lastLine : entry.content),
          };
        }));
      }

      if (quietTimerRef.current !== null) window.clearTimeout(quietTimerRef.current);
      quietTimerRef.current = window.setTimeout(() => {
        if (activeAsstIdRef.current) {
          const finishedId = activeAsstIdRef.current;
          const finishTime = Date.now();
          setChatEntries((prev) => prev.map((entry) => {
            if (entry.id === finishedId) {
              const duration = entry.startTime ? finishTime - entry.startTime : undefined;
              return { ...entry, status: "success", durationMs: duration };
            }
            return entry;
          }));
          activeAsstIdRef.current = null;
        }
      }, 2500);
    });
    const removeExit = window.sensei.terminal.onExit((code) => setStatus(`Terminal exited (${code})`));
    let resizeFrame: number | null = null;
    let lastSize = "";
    const resize = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        try {
          if (!terminalReadyRef.current || !hostRef.current || hostRef.current.clientWidth < 2 || hostRef.current.clientHeight < 2 || !terminal.element) return;
          fit.fit();
          terminal.refresh(0, Math.max(0, terminal.rows - 1));
          const size = `${terminal.cols}x${terminal.rows}`;
          if (terminal.cols >= 2 && terminal.rows >= 2 && terminal.cols <= 500 && terminal.rows <= 200 && size !== lastSize) {
            lastSize = size;
            void window.sensei.terminal.resize({ cols: terminal.cols, rows: terminal.rows }).catch(() => undefined);
          }
        } catch { /* The panel can be between layout states during window resize. */ }
      });
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(hostRef.current);
    window.addEventListener("resize", resize);
    terminal.onData((data) => void window.sensei.terminal.write(data));
    terminalReadyRef.current = false;
    setTerminalReady(false);
    void window.sensei.terminal.start({}).then(({ cwd: startedCwd, agyStarted }) => {
      terminalReadyRef.current = true;
      setAgyActive(Boolean(agyStarted));
      setStatus(`${startedCwd} · ${agyStarted ? "⚡ agy ready" : "shell ready"}`);
      setTerminalReady(true);
      resize();
      terminal.focus();
    }).catch((caught: unknown) => {
      terminalReadyRef.current = false;
      setTerminalReady(false);
      const problem = messageOf(caught, "Agy failed to start");
      setStatus(problem);
      // Said in the panel itself, not only the status line, so a failed start is never a blank panel.
      terminal.write(`\r\n\x1b[31mAgy didn't start: ${problem}\x1b[0m\r\nUse Restart to try again. The app's log (Docs → Troubleshooting) has the details.\r\n`);
    });
    const initialResize = window.setTimeout(resize, 80);
    return () => { terminalReadyRef.current = false; resizeObserver.disconnect(); window.removeEventListener("resize", resize); hostRef.current?.removeEventListener("click", focusTerminal); window.clearTimeout(initialResize); if (resizeFrame !== null) cancelAnimationFrame(resizeFrame); removeData(); removeExit(); void window.sensei.terminal.stop(); terminal.dispose(); terminalRef.current = null; fitRef.current = null; };
  }, [cwd]);

  useEffect(() => { if (terminalRef.current) terminalRef.current.options.theme = terminalTheme(theme); }, [theme]);

  useEffect(() => {
    if (!visible) return;
    const resizeTimer = window.setTimeout(() => {
      const terminal = terminalRef.current;
      try {
        if (!terminalReadyRef.current || !terminal?.element) return;
        fitRef.current?.fit();
        if (terminal && terminal.cols >= 2 && terminal.rows >= 2 && terminal.cols <= 500 && terminal.rows <= 200) {
          terminal.refresh(0, Math.max(0, terminal.rows - 1));
          void window.sensei.terminal.resize({ cols: terminal.cols, rows: terminal.rows }).catch(() => undefined);
        }
      } catch { /* The panel may still be settling after it is reopened. */ }
    }, 60);
    return () => window.clearTimeout(resizeTimer);
  }, [visible]);

  useEffect(() => {
    if (viewMode === "chat" && chatStreamRef.current) {
      chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
    }
  }, [chatEntries, viewMode, expandedPastes, expandedRawLogs]);

  useEffect(() => {
    if (!visible || !terminalReady || !promptRequest || handledPromptId.current === promptRequest.id) return;
    handledPromptId.current = promptRequest.id;
    if (viewMode === "chat") {
      sendToAgy(promptRequest.text, promptRequest.label);
      onPromptHandled(promptRequest.id);
    } else {
      void window.sensei.terminal.insertPrompt(promptRequest.text)
        .then(() => {
          setPromptNotice(`Prompt ready: ${promptRequest.label} · Press Enter to run`);
          terminalRef.current?.focus();
          window.setTimeout(() => setPromptNotice(""), 4500);
        })
        .catch((caught: unknown) => setPromptNotice(messageOf(caught, "Unable to insert that prompt.")))
        .finally(() => onPromptHandled(promptRequest.id));
    }
  }, [visible, terminalReady, promptRequest?.id, viewMode]);

  useEffect(() => {
    if (!cwd) return;
    void window.sensei.terminal.setContext({ careerPaths: selectedCareerPaths, structuredPaths: selectedCareerPaths.filter((path) => path.startsWith("context/structured/")), broadPaths: selectedCareerPaths.filter((path) => path.startsWith("context/broad/")), jobPaths: selectedJobFiles, jobIds: [] })
      .then((manifest) => setStatus(`${cwd} · ${manifest.scope} context ready`))
      .catch(() => setStatus(`${cwd} · context update failed`));
  }, [cwd, selectedCareerPaths.join(","), selectedJobFiles.join(",")]);

  return (
    <aside className={`terminal-panel ${visible ? "" : "is-collapsed"}`}>
      <div className="terminal-header">
        <div className="terminal-header-title-group">
          <div className="terminal-brand-badge">
            <div className="terminal-title">Agy</div>
            <span className={`terminal-engine-tag ${agyActive ? "is-agy" : "is-shell"}`}>
              {agyActive ? "⚡ agy" : "🐚 shell"}
            </span>
          </div>
          <div className="terminal-header-view-toggle" role="group" aria-label="Command center view mode">
            <button
              className={`view-toggle-btn ${viewMode === "chat" ? "is-active" : ""}`}
              onClick={() => setViewMode("chat")}
              type="button"
              aria-pressed={viewMode === "chat"}
            >
              💬 Chat
            </button>
            <button
              className={`view-toggle-btn ${viewMode === "console" ? "is-active" : ""}`}
              onClick={() => {
                setViewMode("console");
                window.setTimeout(() => fitRef.current?.fit(), 60);
              }}
              type="button"
              aria-pressed={viewMode === "console"}
            >
              🖥️ Console
            </button>
          </div>
        </div>
        <div className="terminal-header-actions">
          <JobActionsMenu actions={jobActions} onInsert={onInsertPrompt} />
          <button className="terminal-action" onClick={handleClear} title="Clear conversation or console output">Clear</button>
          <button className="terminal-action" onClick={() => void window.sensei.terminal.restart().then((res) => { if (res?.agyStarted !== undefined) setAgyActive(Boolean(res.agyStarted)); })} title="Restart session">Restart</button>
          <button className="terminal-action" aria-label="Hide terminal panel" onClick={onClose}>Hide</button>
        </div>
      </div>

      {visible && <RunStatusBar run={latestRun} onOpen={onOpenRun} />}
      <div className="terminal-body">
        {viewMode === "chat" ? (
          <div className="chat-container">
            <div className="chat-stream" ref={chatStreamRef}>
              {chatEntries.map((entry) => (
                <div key={entry.id} className={`chat-bubble is-${entry.sender}`}>
                  <div className="chat-bubble-header">
                    <div className="chat-sender-group">
                      <span className="chat-sender-name">
                        {entry.sender === "user" ? "You" : entry.sender === "assistant" ? "Sensei Copilot" : "System"}
                      </span>
                      {entry.status === "running" && entry.startTime && (
                        <span className="chat-timer-badge is-running">
                          <span className="chat-pulse-dot" /> {formatDuration(liveNow - entry.startTime)}
                        </span>
                      )}
                      {entry.status === "success" && entry.durationMs !== undefined && (
                        <span className="chat-timer-badge is-completed">
                          ✓ {formatDuration(entry.durationMs)}
                        </span>
                      )}
                    </div>
                    <span className="chat-timestamp">{entry.timestamp}</span>
                  </div>
                  {entry.title && <div className="chat-bubble-title">{entry.title}</div>}
                  {entry.content && <div className="chat-bubble-content">{entry.content}</div>}
                  {entry.pastedBlock && (
                    <div className="chat-pasted-card">
                      <div className="chat-pasted-header">
                        <div className="chat-pasted-title-row">
                          <span className="chat-pasted-icon">📄</span>
                          <span className="chat-pasted-title">
                            Pasted text [lines 1–{entry.pastedBlock.lineCount} · {formatBytes(entry.pastedBlock.byteCount)}]
                          </span>
                        </div>
                        <button
                          type="button"
                          className="chat-pasted-toggle-btn"
                          onClick={() => toggleExpandPaste(entry.id)}
                        >
                          {expandedPastes[entry.id] ? "Collapse ▴" : "Preview ▾"}
                        </button>
                      </div>
                      {expandedPastes[entry.id] ? (
                        <pre className="chat-pasted-full-content">{entry.pastedBlock.content}</pre>
                      ) : (
                        <div className="chat-pasted-preview-snippet" onClick={() => toggleExpandPaste(entry.id)}>
                          <div className="chat-pasted-preview-text">{entry.pastedBlock.preview}</div>
                          <div className="chat-pasted-fade" />
                        </div>
                      )}
                    </div>
                  )}
                  {entry.steps && entry.steps.length > 0 && (
                    <div className="chat-steps">
                      {entry.steps.map((step, idx) => (
                        <div key={idx} className="chat-step-item">
                          <span className="chat-step-check">✓</span>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {entry.status === "running" && (
                    <div className="chat-running-status">
                      <span className="chat-pulse-dot" /> Executing steps…
                    </div>
                  )}
                  {entry.rawOutput && entry.rawOutput.length > 0 && (
                    <div className="chat-raw-output-container">
                      <button
                        type="button"
                        className="chat-raw-toggle-btn"
                        onClick={() => toggleExpandRaw(entry.id)}
                      >
                        {expandedRawLogs[entry.id]
                          ? "Hide CLI log ▴"
                          : `Show CLI log (${entry.rawOutput.length} lines) ▾`}
                      </button>
                      {expandedRawLogs[entry.id] && (
                        <pre className="chat-raw-content">
                          {entry.rawOutput.join("\n")}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="chat-footer">
              {pastedAttachment && (
                <div className="chat-staged-attachment">
                  <div className="chat-staged-body">
                    <span className="chat-staged-icon">📄</span>
                    <div className="chat-staged-info">
                      <span className="chat-staged-label">
                        Pasted text [lines 1–{pastedAttachment.lineCount} · {formatBytes(pastedAttachment.byteCount)}]
                      </span>
                      <span className="chat-staged-snippet">{pastedAttachment.preview.replace(/\n/g, " · ").slice(0, 75)}…</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="chat-staged-remove"
                    onClick={() => setPastedAttachment(null)}
                    title="Remove pasted attachment"
                  >
                    ✕
                  </button>
                </div>
              )}
              {jobActions.length > 0 && (
                <div className="chat-quick-actions">
                  {jobActions.slice(0, 3).map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="chat-action-pill"
                      onClick={() => sendToAgy(action.prompt, action.label)}
                      title={action.prompt}
                    >
                      ⚡ {action.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="chat-input-bar">
                <textarea
                  ref={textareaRef}
                  className="chat-textarea"
                  value={chatInput}
                  rows={1}
                  onChange={(e) => setChatInput(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    pastedAttachment
                      ? "Add prompt instruction or press Enter to run…"
                      : "Ask Sensei or paste a job description… (Shift+Enter for newline)"
                  }
                />
                <button
                  type="button"
                  className="chat-send-btn"
                  onClick={() => handleChatSubmit()}
                  disabled={!chatInput.trim() && !pastedAttachment}
                  aria-label="Send prompt"
                  title="Send (Enter)"
                >
                  ↑
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {viewMode === "console" && consoleNote && <p className="console-note" role="status">{consoleNote} <button className="btn-link" onClick={() => setConsoleNote(null)}>OK</button></p>}
        <div
          className="terminal-host"
          ref={hostRef}
          style={{ display: viewMode === "console" ? "block" : "none" }}
        />
      </div>

      <div className="terminal-status">
        <span className={`status-dot ${terminalReady ? "is-ready" : ""}`} />
        <span>{promptNotice || status}</span>
      </div>
    </aside>
  );
}

function JobActionsMenu({ actions, onInsert }: { actions: JobAction[]; onInsert: (action: JobAction) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const recommended = actions.find((action) => action.recommended) ?? actions[0] ?? null;
  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", escape); };
  }, [open]);
  function insert(action: JobAction) {
    onInsert(action);
    setOpen(false);
  }
  const groups: JobAction["group"][] = ["Recommended", "Interview", "Application"];
  return <div className="job-actions" ref={rootRef}>
    <div className="job-actions-split">
      <button className="terminal-action job-actions-primary" disabled={!recommended} title={recommended ? `Insert without running: ${recommended.prompt}` : "View a job or select one job to enable actions"} onClick={() => recommended && insert(recommended)}>Job Actions</button>
      <button className="terminal-action job-actions-toggle" disabled={!actions.length} aria-haspopup="menu" aria-expanded={open} aria-label="Show Job Actions" onClick={() => setOpen((value) => !value)}>▾</button>
    </div>
    {open && <div className="job-actions-menu" role="menu" aria-label={`Actions for ${actions[0]?.company ?? "this job"}`}>{actions[0] && <p className="job-actions-for">For {actions[0].company} <code>(job: {actions[0].jobId})</code></p>}{groups.map((group) => {
      const grouped = actions.filter((action) => action.group === group);
      if (!grouped.length) return null;
      return <section key={group}><span>{group}</span>{grouped.map((action) => <button key={action.id} role="menuitem" onClick={() => insert(action)}><strong>{action.label}</strong><small>Inserts the request; you press Enter to run it</small></button>)}</section>;
    })}</div>}
  </div>;
}
function terminalTheme(_theme: "dark" | "light") { return { background: "#0b0f0d", foreground: "#e4ece3", cursor: "#b5db63", selectionBackground: "#354b35", black: "#172019", brightBlack: "#718073", green: "#a7d66b", brightGreen: "#c7ed89" }; }
