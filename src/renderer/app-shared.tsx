import { useEffect, useRef } from "react";
import { type TrackerStatus, type FileTreeNode, type JobFolderSummary } from "../shared/schemas";
import { TRACKER_LABELS, readyToSend, statusLabel } from "../shared/tracker";
import { FIT_GATE } from "../shared/fit-credit";

export const IS_MAC = /mac/i.test(navigator.platform);
export type PromptRequest = { id: number; text: string; label: string };
export type JobWorkspaceTab = "overview" | "application" | "interview" | "files";

export const JOB_FAVORITES_KEY = "sensei-job-favorites";

export function storedFavoriteJobIds(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(JOB_FAVORITES_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

const FAVORITES_EVENT = "sensei-favorites-changed";

/** Saves the starred jobs (Jobs ☆) and tells the rest of the window, so the sidebar's Favorites list follows at once. */
export function saveFavoriteJobIds(ids: Set<string>): void {
  try { window.localStorage.setItem(JOB_FAVORITES_KEY, JSON.stringify([...ids])); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(FAVORITES_EVENT));
}

export function onFavoritesChanged(callback: (ids: Set<string>) => void): () => void {
  const listener = () => callback(storedFavoriteJobIds());
  window.addEventListener(FAVORITES_EVENT, listener);
  return () => window.removeEventListener(FAVORITES_EVENT, listener);
}

/** Job links waiting for Agy. With "Run automatically" on, the next link is sent (and run) when Agy is idle. */
/** `batch`: this link is one of several pasted together (index from 0), so a recruiter can choose candidates once. */
export type QueueJob = (input: { kind: "link"; url: string; batch?: { index: number; size: number } } | { kind: "paste"; text: string; note?: string }, manual: boolean) => Promise<number>;

export function TrackerPill({ status, job }: { status: TrackerStatus; job?: JobFolderSummary }) {
  const ready = job ? readyToSend(job) : false;
  return <span className={`tracker-pill is-${ready ? "ready" : status}`}>{job ? statusLabel(job) : TRACKER_LABELS[status]}</span>;
}

export function formatTrackerDate(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function StatusPill({ value }: { value: string }) {
  const spaced = value.replaceAll("_", " ");
  const normalized = spaced.charAt(0).toUpperCase() + spaced.slice(1);
  const tone = /interview|ready|validated|applied/i.test(value) ? "positive" : /review|pending|stale|invalid/i.test(value) ? "warning" : "neutral";
  return <span className={`status-pill is-${tone}`}>{normalized}</span>;
}

export function FitBadge({ rating, gate = FIT_GATE }: { rating: number | null; /** The job's own gate (its stamped settings). */ gate?: number }) {
  if (rating === null) return <span className="fit-badge is-none">—</span>;
  const tone = rating >= 4 ? "high" : rating >= gate ? "mid" : "low";
  return <span className={`fit-badge is-${tone}`} title={`${rating.toFixed(1)} of 5 fit`}><span className="tabular">{rating.toFixed(1)}</span></span>;
}

/** A pop-up for something that just finished ("Saved."): a toast, never a label that stays on the page (U89). */
export function toast(message: string): void { window.dispatchEvent(new CustomEvent("sensei-announce", { detail: message })); }

/** A result for a page the user may have left: shown in place while it's open, as an app toast once it's gone. */
export function useAnnounce() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return (message: string) => { if (!mounted.current) window.dispatchEvent(new CustomEvent("sensei-announce", { detail: message })); };
}

export function displayJobName(value: string): string {
  return value.replaceAll(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function formatJobDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
export function plural(count: number, noun: string): string { return `${count} ${noun}${count === 1 ? "" : "s"}`; }
export function messageOf(caught: unknown, fallback: string): string { return caught instanceof Error ? caught.message : fallback; }
export function workspaceLabel(path: string): string { return path.split("/").filter(Boolean).pop() ?? "data"; }
export function filePaths(nodes: FileTreeNode[]): string[] { return nodes.flatMap((node) => node.kind === "directory" ? filePaths(node.children ?? []) : [node.relativePath]); }
export function fileNodes(nodes: FileTreeNode[]): FileTreeNode[] { return nodes.flatMap((node) => node.kind === "directory" ? fileNodes(node.children ?? []) : [node]); }
export function findNode(nodes: FileTreeNode[], path: string): FileTreeNode | null { for (const node of nodes) { if (node.relativePath === path) return node; const found = node.children ? findNode(node.children, path) : null; if (found) return found; } return null; }
