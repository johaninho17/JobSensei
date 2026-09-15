import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchResult, SearchResultKind } from "../shared/schemas";

export type PaletteAction = {
  id: string;
  title: string;
  subtitle: string;
  keywords: string;
  run: () => void;
};

type PaletteEntry =
  | { type: "result"; result: SearchResult }
  | { type: "action"; action: PaletteAction };

const resultGroups: Array<[SearchResultKind, string]> = [
  ["job", "Jobs"],
  ["career", "Career Context"],
  ["application", "Application Artifacts"],
  ["interview", "Interview & Challenge Material"],
];

export function SearchPalette({ open, actions, onClose, onOpenResult }: { open: boolean; actions: PaletteAction[]; onClose: () => void; onOpenResult: (result: SearchResult) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setError("");
    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open || !query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setResults([]);
    setError("");
    const timer = window.setTimeout(() => {
      void window.sensei.search.query({ query, limit: 60 })
        .then((response) => { if (!cancelled) setResults(response.results); })
        .catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Search could not run."); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const matchingActions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return actions.filter((action) => !normalized || `${action.title} ${action.subtitle} ${action.keywords}`.toLowerCase().includes(normalized));
  }, [actions, query]);
  const orderedResults = useMemo(() => resultGroups.flatMap(([kind]) => results.filter((result) => result.kind === kind)), [results]);
  const entries = useMemo<PaletteEntry[]>(() => [
    ...orderedResults.map((result) => ({ type: "result" as const, result })),
    ...matchingActions.map((action) => ({ type: "action" as const, action })),
  ], [orderedResults, matchingActions]);

  useEffect(() => setActiveIndex((index) => Math.max(0, Math.min(index, Math.max(0, entries.length - 1)))), [entries.length]);

  if (!open) return null;

  function choose(entry: PaletteEntry) {
    if (entry.type === "result") onOpenResult(entry.result);
    else entry.action.run();
    onClose();
  }

  function indexForResult(id: string): number {
    return entries.findIndex((entry) => entry.type === "result" && entry.result.id === id);
  }

  function indexForAction(id: string): number {
    return entries.findIndex((entry) => entry.type === "action" && entry.action.id === id);
  }

  return <div className="search-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="search-palette" role="dialog" aria-modal="true" aria-label="Search Sensei workspace">
      <div className="search-input-row">
        <span aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          value={query}
          placeholder="Search jobs, context, artifacts, and actions…"
          aria-label="Search jobs, context, artifacts, and actions"
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(entries.length - 1, index + 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
            if (event.key === "Enter" && entries[activeIndex]) { event.preventDefault(); choose(entries[activeIndex]); }
            if (event.key === "Escape") onClose();
          }}
        />
        <kbd>ESC</kbd>
      </div>
      <div className="search-results" role="listbox" aria-label="Search results">
        {loading && <p className="search-state">Searching local workspace…</p>}
        {error && <p className="search-state is-error">{error}</p>}
        {!loading && !error && resultGroups.map(([kind, label]) => {
          const grouped = results.filter((result) => result.kind === kind);
          if (!grouped.length) return null;
          return <section className="search-group" key={kind}><h2>{label}<span>{grouped.length}</span></h2>{grouped.map((result) => {
            const index = indexForResult(result.id);
            return <button key={result.id} className={index === activeIndex ? "is-active" : ""} role="option" aria-selected={index === activeIndex} disabled={!result.relativePath} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose({ type: "result", result })}>
              <span className="search-result-icon">{kind === "job" ? "JOB" : kind === "career" ? "CTX" : kind === "interview" ? "INT" : "APP"}</span>
              <span className="search-result-copy"><strong>{result.title}</strong><small>{[result.subtitle, result.relativePath].filter(Boolean).join(" · ")}</small>{result.excerpt && <em>{result.excerpt}</em>}</span>
            </button>;
          })}</section>;
        })}
        {!loading && matchingActions.length > 0 && <section className="search-group"><h2>Actions<span>{matchingActions.length}</span></h2>{matchingActions.map((action) => {
          const index = indexForAction(action.id);
          return <button key={action.id} className={index === activeIndex ? "is-active" : ""} role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose({ type: "action", action })}>
            <span className="search-result-icon">ACT</span>
            <span className="search-result-copy"><strong>{action.title}</strong><small>{action.subtitle}</small></span>
          </button>;
        })}</section>}
        {!loading && !error && query.trim() && results.length === 0 && matchingActions.length === 0 && <p className="search-state">No matching workspace results.</p>}
      </div>
      <footer className="search-footer"><span>↑↓ Navigate</span><span>↵ Open</span><span>Ctrl/⌘ K Toggle</span></footer>
    </section>
  </div>;
}
