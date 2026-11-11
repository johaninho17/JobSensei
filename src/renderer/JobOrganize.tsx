// Jobs page organizing controls: filters, saved views, the company strip, and the tag editor.
// The logic lives in src/shared/job-organize.ts; these only draw it.
import { useState } from "react";
import { FIT_BANDS, WORK_MODES, companySummary, facetOptions, facetsActive, jobViewsSchema, normalizeTags, NO_FACETS, type JobFacets, type JobView } from "../shared/job-organize";
import type { JobFolderSummary } from "../shared/schemas";

const VIEWS_KEY = "sensei-job-views";
export function storedJobViews(): JobView[] {
  try { const parsed = jobViewsSchema.safeParse(JSON.parse(window.localStorage.getItem(VIEWS_KEY) ?? "[]")); return parsed.success ? parsed.data : []; } catch { return []; }
}
export function storeJobViews(views: JobView[]) { try { window.localStorage.setItem(VIEWS_KEY, JSON.stringify(views)); } catch { /* storage unavailable */ } }

const WORK_LABEL = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unknown: "Not stated" } as const;
const FIT_LABEL = { high: "4.0 and up", mid: "3.0 to 3.9", low: "Below 3.0", unrated: "Not rated" } as const;

function toggle<T>(list: T[], value: T): T[] { return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]; }

/** The Filters menu: company, work setup, fit, interviews, and tags, each with how many jobs it has. */
export function JobFilters({ jobs, facets, onChange }: { jobs: JobFolderSummary[]; facets: JobFacets; onChange: (next: JobFacets) => void }) {
  const options = facetOptions(jobs);
  const active = facetsActive(facets);
  return <details className="jobs-filters">
    <summary className="filter-toggle" aria-label={`Filters${active ? `, ${active} on` : ""}`}>Filters{active > 0 && <span>{active}</span>}</summary>
    <div className="jobs-filters-menu">
      <label className="jobs-filter-row"><span>Company</span>
        <select value={facets.company ?? ""} onChange={(event) => onChange({ ...facets, company: event.target.value || null })}>
          <option value="">Any company</option>
          {options.companies.map((company) => <option key={company.name} value={company.name}>{company.name}{company.count > 1 ? ` (${company.count})` : ""}</option>)}
        </select>
      </label>
      <div className="jobs-filter-row"><span>Work setup</span><div className="pill-group">{WORK_MODES.filter((mode) => options.work[mode] > 0 || facets.work.includes(mode)).map((mode) => <button key={mode} type="button" className="pill" aria-pressed={facets.work.includes(mode)} onClick={() => onChange({ ...facets, work: toggle(facets.work, mode) })}>{WORK_LABEL[mode]} <small>{options.work[mode]}</small></button>)}</div></div>
      <div className="jobs-filter-row"><span>Fit</span><div className="pill-group">{FIT_BANDS.filter((band) => options.fit[band] > 0 || facets.fit.includes(band)).map((band) => <button key={band} type="button" className="pill" aria-pressed={facets.fit.includes(band)} onClick={() => onChange({ ...facets, fit: toggle(facets.fit, band) })}>{FIT_LABEL[band]} <small>{options.fit[band]}</small></button>)}</div></div>
      {FEATURES.interviews && <label className="jobs-filter-row"><span>Interview</span>
        <select value={facets.interview} onChange={(event) => onChange({ ...facets, interview: event.target.value as JobFacets["interview"] })}>
          <option value="any">Any</option><option value="yes">Went to interview</option><option value="no">No interview</option>
        </select>
      </label>}
      {(options.tags.length > 0 || facets.tags.length > 0) && <div className="jobs-filter-row"><span>Tags</span><div className="pill-group">{options.tags.map((tag) => <button key={tag.name} type="button" className="pill" aria-pressed={facets.tags.some((own) => own.toLowerCase() === tag.name.toLowerCase())} onClick={() => onChange({ ...facets, tags: facets.tags.some((own) => own.toLowerCase() === tag.name.toLowerCase()) ? facets.tags.filter((own) => own.toLowerCase() !== tag.name.toLowerCase()) : [...facets.tags, tag.name] })}>{tag.name} <small>{tag.count}</small></button>)}</div></div>}
      {options.tags.length === 0 && <p className="muted jobs-filter-hint">Add tags on a job's Overview (Tracking) to filter by them here.</p>}
      {active > 0 && <button type="button" className="btn-link" onClick={() => onChange(NO_FACETS)}>Clear filters</button>}
    </div>
  </details>;
}

/** Saved views: one click brings back a status tab, search, filters, grouping, and sort. */
export function SavedViews({ views, current, onApply, onChange }: { views: JobView[]; current: Omit<JobView, "name">; onApply: (view: JobView) => void; onChange: (views: JobView[]) => void }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const same = (view: JobView) => JSON.stringify({ ...view, name: undefined }) === JSON.stringify({ ...current, name: undefined });
  const worthSaving = current.query.trim() !== "" || facetsActive(current.facets) > 0 || current.group !== "none";
  if (!views.length && !worthSaving) return null;
  function save() {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    onChange([...views.filter((view) => view.name.toLowerCase() !== trimmed.toLowerCase()), { ...current, name: trimmed }].slice(-20));
    setNaming(false);
    setName("");
  }
  return <div className="saved-views" role="group" aria-label="Saved views">
    {views.length > 0 && <span className="muted">Views</span>}
    {views.map((view) => <span key={view.name} className="saved-view" data-current={same(view) || undefined}>
      <button type="button" onClick={() => onApply(view)} aria-pressed={same(view)}>{view.name}</button>
      <button type="button" className="saved-view-remove" aria-label={`Remove the view ${view.name}`} onClick={() => onChange(views.filter((other) => other.name !== view.name))}>×</button>
    </span>)}
    {worthSaving && !views.some(same) && (naming
      ? <form className="saved-view-form" onSubmit={(event) => { event.preventDefault(); save(); }}><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Name this view" aria-label="View name" maxLength={40} /><button type="submit" className="btn-quiet btn-small" disabled={!name.trim()}>Save</button><button type="button" className="btn-link" onClick={() => setNaming(false)}>Cancel</button></form>
      : <button type="button" className="btn-link" onClick={() => setNaming(true)}>Save this view</button>)}
  </div>;
}

/** Shown while one company is filtered: everything the user has with that company. */
export function CompanyStrip({ jobs, company, onOpenJob, onClear }: { jobs: JobFolderSummary[]; company: string; onOpenJob: (jobId: string, tab?: "interview") => void; onClear: () => void }) {
  const summary = companySummary(jobs, company);
  if (!summary.jobs) return null;
  return <div className="company-strip">
    <strong>{summary.name}</strong>
    <span>{summary.jobs} job{summary.jobs === 1 ? "" : "s"}: {summary.statuses.map((entry) => `${entry.count} ${entry.label.toLowerCase()}`).join(", ")}</span>
    {summary.averageFit !== null && <span>average fit {summary.averageFit.toFixed(1)}</span>}
    <span>{summary.interviewed ? `${summary.interviewed} went to interview` : "no interviews yet"}</span>
    {summary.researchJobId && <button type="button" className="btn-link" onClick={() => onOpenJob(summary.researchJobId!, "interview")}>Company research and prep</button>}
    <button type="button" className="btn-link" onClick={onClear}>Show all companies</button>
  </div>;
}

/** Tags on one job (Overview → Tracking). Enter or comma adds; × removes. */
export function TagEditor({ tags, suggestions, onChange }: { tags: string[]; suggestions: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (value: string) => { const next = normalizeTags([...tags, ...value.split(",")]); if (next.length !== tags.length) onChange(next); setText(""); };
  const unused = suggestions.filter((tag) => !tags.some((own) => own.toLowerCase() === tag.toLowerCase())).slice(0, 6);
  return <div className="tag-editor">
    <span className="tag-editor-label">Tags</span>
    <div className="tag-list">
      {tags.map((tag) => <span key={tag} className="tag-chip">{tag}<button type="button" aria-label={`Remove the tag ${tag}`} onClick={() => onChange(tags.filter((own) => own !== tag))}>×</button></span>)}
      <input value={text} onChange={(event) => setText(event.target.value)} placeholder={tags.length ? "Add a tag" : "Add a tag, e.g. referral"} aria-label="Add a tag" maxLength={30}
        onKeyDown={(event) => { if ((event.key === "Enter" || event.key === ",") && text.trim()) { event.preventDefault(); add(text); } }} onBlur={() => { if (text.trim()) add(text); }} />
    </div>
    {unused.length > 0 && <div className="tag-suggestions">{unused.map((tag) => <button key={tag} type="button" className="btn-link" onClick={() => add(tag)}>+ {tag}</button>)}</div>}
  </div>;
}
