// Page layout checks from the Bento and declutter passes (U78, U79, U82, U89). Moved from the Today Bento tests when
// Today was removed (#193). Fictional data only.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("job card status dot (U79)", () => {
  it("interviewing leaf, applied pine, a blocker while saved risk, otherwise none", async () => {
    const { jobDotOf: jobEdgeOf } = await import("../src/shared/job-organize");
    const job = (status: string | null, mustHaves: Array<{ requirement: string; status: "met" | "learnable" | "blocker" }> = []) => ({ tracker: status ? { status } : null, hasApplicationMaterials: false, mustHaves }) as unknown as Parameters<typeof jobEdgeOf>[0];
    expect(jobEdgeOf(job("interviewing"))).toBe("leaf");
    expect(jobEdgeOf(job("offer"))).toBe("leaf");
    expect(jobEdgeOf(job("applied"))).toBe("accent");
    expect(jobEdgeOf(job(null, [{ requirement: "License", status: "blocker" }]))).toBe("risk");
    expect(jobEdgeOf(job(null))).toBeNull();
    expect(jobEdgeOf(job("rejected", [{ requirement: "License", status: "blocker" }]))).toBeNull();
  });
});

describe("Profile page (U78)", () => {
  it("Setup and Career context are one page: Setup is its first tab, one sidebar item", async () => {
    const [app, context] = await Promise.all(["src/renderer/App.tsx", "src/renderer/SetupAndContext.tsx"].map((path) => readFile(path, "utf8")));
    expect(app).toContain('currentLocation.kind === "context-home" || currentLocation.kind === "setup-home" ? <ContextHome key={currentLocation.kind}');
    expect(app).toContain("setup={setupHomeBlock}");
    expect(app).toContain("const setupHomeBlock = <SetupHome embedded ");
    expect(context).toContain('...(setup ? [{ id: "setup" as const, label: "Setup" }] : [])');
    expect(context).toContain('<PageHead title={setup ? "Profile" : "Career context"}');
  });
});

describe("Jobs header and sidebar views (U79, #156)", () => {
  it("statuses move to the sidebar and a header menu; Add jobs is a header button; Sort and Group sit in View", async () => {
    const [jobs, app] = await Promise.all(["src/renderer/JobsHome.tsx", "src/renderer/App.tsx"].map((path) => readFile(path, "utf8")));
    expect(jobs).not.toContain("<SubTabs");
    expect(jobs).toContain('<PageHead title="Jobs"');
    expect(jobs).toContain('{addOpen ? "Close" : "Add jobs"}');
    expect(jobs).toContain("if (!open && !visible.length) return null;");
    expect(jobs).toMatch(/<summary>View<\/summary>[\s\S]*Sort jobs[\s\S]*Group jobs/);
    expect(app).toContain('className="side-sub"');
    expect(app).toContain("jobsTabsWithCounts(jobs)");
    expect(app).toContain("setJobsStatusGroup(view.id); void showPage(\"jobs-home\");");
  });

  it("the setup line can be hidden until its missing steps change, but not while setup blocks adding jobs", async () => {
    const jobs = await readFile("src/renderer/JobsHome.tsx", "utf8");
    expect(jobs).toContain("if (readiness.ready && dismissed === signature) return null;");
    expect(jobs).toContain("{readiness.ready && <button className=\"setup-banner-close\"");
  });
});

describe("The job page, compact (U79, #157)", () => {
  it("the job page's next step and check count sit in the header card, and the Fit card doesn't repeat the score", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    const head = page.slice(page.indexOf('<header className="job-head">'), page.indexOf("</header>", page.indexOf('<header className="job-head">')));
    // #221: the next step is a split button in the header's line, not a band.
    expect(head).toContain('className="next-split job-head-action"');
    // #225: the next step is the one primary action, on the title's line, under a breadcrumb.
    expect(head).toMatch(/<div className="job-head-title">\s*<h1>[\s\S]*next-split job-head-action/);
    expect(head).toContain('className="job-head-crumbs"');
    expect(head).toContain("check-chip");
    expect(page).not.toContain('className="review-line"');
    expect(page).not.toContain('className="next-bar"');
    expect(page.match(/className="next-split[ "]/g)).toHaveLength(1);
    expect(page).not.toContain("job.rating.toFixed(1)}</strong> of 5");
    expect(page).not.toContain('className="fit-bar"');
  });
});

describe("One page header (U82, #165)", () => {
  it("every page uses PageHead, and no page keeps a help paragraph under its title", async () => {
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir("src/renderer")).filter((file) => file.endsWith(".tsx") && file !== "BentoPrimitives.tsx");
    for (const file of files) expect(await readFile(`src/renderer/${file}`, "utf8"), file).not.toContain('className="page-head');
    for (const file of ["JobsHome", "JobSearchView", "InterviewsHome", "SetupAndContext", "AgyView", "DocsView", "Pipeline", "Postings", "Reports", "Candidates", "CandidateProfile"]) expect(await readFile(`src/renderer/${file}.tsx`, "utf8"), file).toContain("<PageHead");
    expect(await readFile("src/renderer/layout.css", "utf8")).not.toContain(".page-head p {");
  });

  it("Favorites appears only when a job is starred", async () => {
    const app = await readFile("src/renderer/App.tsx", "utf8");
    expect(app).toContain("{!FEATURES.candidates && favoriteJobs.length > 0 && (() => {");
    expect(app).not.toContain("Star a job (☆) in Jobs to keep it here.");
  });
});

describe("Quieter job page (U82, #166)", () => {
  it("the header keeps status, ring and short location; the settings score is in the Fit card; the rest is in its menu (#221)", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    const head = page.slice(page.indexOf('<header className="job-head">'), page.indexOf("</header>", page.indexOf('<header className="job-head">')));
    expect(head).not.toContain("<StatusPill");
    expect(head).toContain("locationLine(job.location, job.role?.workMode ?? null)");
    expect(head).not.toContain("Settings <strong");
    const fit = page.slice(page.indexOf("<h2>Fit</h2>"), page.indexOf("</section>", page.indexOf("<h2>Fit</h2>")));
    expect(fit).toContain("Settings <strong");
    expect(head).toMatch(/<details className="jobs-more job-head-more">[\s\S]*Added \{formatJobDate[\s\S]*Edit details/);
    expect(page).toContain('<details className="jobs-more pdf-menu">');
    expect(page.match(/<PdfTextSizeSelect/g)).toHaveLength(1);
  });

  it("the job header's place line comes from posting-fields (#209)", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    expect(page).not.toContain("function shortLocation");
  });

  it("documents show file details as a tip, not a line", async () => {
    const docs = await readFile("src/renderer/Documents.tsx", "utf8");
    expect(docs).toContain('<InfoTip label="File details">');
    expect(docs).not.toContain("Local artifact");
  });
});


describe("Lists that repeat themselves (U82, #167)", () => {
  it("Agy action rows show the label; the prompt opens on request and 'Agy panel' is not repeated per row", async () => {
    const agy = await readFile("src/renderer/AgyView.tsx", "utf8");
    expect(agy).toContain('<details className="agy-action-more" title={action.what}><summary><strong>{action.label}</strong></summary>');
    expect(agy).toContain('action.where !== "Agy panel"');
    expect(agy).not.toContain("<p>{action.unavailable ?? action.what}</p>");
  });

  it("done setup steps are one line and a fully done group starts folded", async () => {
    const setup = await readFile("src/renderer/SetupAndContext.tsx", "utf8");
    expect(setup).toContain('item.state === "done" ? <details className="setup-text setup-done">');
    expect(setup).toContain("defaultOpen={done < items.length}");
  });

  it("Job Search keeps the Quick fit note as a tip and has no notices or per-match explanations (#201)", async () => {
    const search = await readFile("src/renderer/JobSearchView.tsx", "utf8");
    const css = await readFile("src/renderer/layout.css", "utf8");
    expect(search).toContain('<InfoTip label="About fit scores">');
    expect(search).not.toContain("find-note");
    expect(css).not.toContain(".find-callout");
    for (const gone of ["find-callout", "find-why", "find-tab-note", "Quick check:", "Ranked by", "To learn:"]) expect(search, gone).not.toContain(gone);
    expect(css.match(/\.find-actions \{[^}]*\}/)?.[0]).toContain("flex-wrap: nowrap");
  });

  it("Settings tabs are a vertical list", async () => {
    const modal = await readFile("src/renderer/SettingsModal.tsx", "utf8");
    const css = await readFile("src/renderer/layout.css", "utf8");
    expect(modal).toContain('role="tablist" aria-label="Settings sections" aria-orientation="vertical"');
    expect(css).toMatch(/\.settings-nav \{ grid-area: nav; flex-direction: column;/);
  });
});

describe("Show less, reveal on demand: job page (U89, #184)", () => {
  it("has one tab row: no second tablist for the application's documents", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    const dashboard = page.slice(page.indexOf("export function JobWorkspaceDashboard"), page.indexOf("type ApplicationView"));
    expect(dashboard.match(/role="tablist"/g)).toHaveLength(1);
    expect(dashboard).not.toContain("<SubTabs<ApplicationView>");
    for (const label of ['"Overview"', '"Resume"', '"Cover letter"', '"Posting"', '"Checks"', '"Files"']) expect(dashboard).toContain(`label: ${label}`);
  });

  it("finished PDFs are a check on the button and a toast, not a sentence; PDF file actions live in its menu", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    expect(page).not.toContain("PDFs saved\"");
    expect(page).not.toContain("Resume and cover letter PDFs saved");
    expect(page).not.toContain("function JobPdfFiles");
    expect(page).not.toContain('className="job-pdf-files"');
    const button = page.slice(page.indexOf("function JobPdfExportButton"), page.indexOf("function ArtifactTableLocation"));
    expect(button).toContain('className="pdf-state"');
    expect(button).toContain('toast(coverLetterPath ? "PDFs saved." : "Resume PDF saved.")');
    expect(button).toContain("startPdfDrag");
    expect(button).toContain("copyPdfPath");
    expect(button).not.toContain("export-message");
  });
});

describe("Show less, reveal on demand: Agy panel (U89, #186)", () => {
  it("a finished run is one line that opens; a failed run opens by itself", async () => {
    const panel = await readFile("src/renderer/TerminalPanel.tsx", "utf8");
    const bar = panel.slice(panel.indexOf("function RunStatusBar"), panel.indexOf("export function TerminalPanel"));
    expect(bar).toContain('<details className={`run-status is-${run.state}`} aria-label="Latest run" open={run.state === "failed"}>');
    expect(bar).toContain('<summary className="run-status-line">');
    expect(bar).not.toContain("Top ${run.issues.length} issues");
  });

  it("a finished run is one Done line (#212), Clear and Restart sit in a menu, and one suggestion chip shows", async () => {
    const panel = await readFile("src/renderer/TerminalPanel.tsx", "utf8");
    expect(panel).toContain('className="chat-done"');
    expect(panel).toContain('<details className="jobs-more terminal-more">');
    expect(panel).not.toContain('aria-label="Hide terminal panel" onClick={onClose}>Hide</button>');
    expect(panel).toContain("jobActions.slice(0, 1)");
  });
});

describe("Show less, reveal on demand: documents (U89, #185)", () => {
  it("flagged lines open from a review chip instead of a card above the document", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    const framing = page.slice(page.indexOf("function FramingLines"), page.indexOf("const STRETCH_LABEL"));
    expect(framing).toContain('<details className="framing-review"');
    expect(framing).toContain("to review</span>");
    expect(framing).not.toContain('<section className="framing-lines"');
  });

  it("the job page's documents have no second export control, and Saved is a toast", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    const docs = await readFile("src/renderer/Documents.tsx", "utf8");
    expect(page).toContain("isBaseResume={false} exportHere={false}");
    expect(docs).toContain("canExport && exportHere && <MarkdownExportButton");
    expect(docs).not.toContain('setMessage("Saved locally")');
    expect(docs).not.toContain('state === "saved" ? "Saved"');
  });
});

describe("Show less, reveal on demand: sidebar and saved messages (U89, #187)", () => {
  it("Favorites fold, remembered, and start folded past three", async () => {
    const app = await readFile("src/renderer/App.tsx", "utf8");
    expect(app).toContain("favoritesOpenPick ?? favoriteJobs.length <= 3");
    expect(app).toContain('window.localStorage.setItem("sensei-side-favorites"');
    expect(app).toContain('className="side-recent-toggle" aria-expanded={favoritesOpen}');
  });

  it("finished saves are a toast, not a label that stays", async () => {
    const shared = await readFile("src/renderer/app-shared.tsx", "utf8");
    expect(shared).toContain("export function toast(message: string)");
    for (const file of ["AgyView", "BrowserSetting", "CandidateProfile", "RecruiterSettings"]) {
      const source = await readFile(`src/renderer/${file}.tsx`, "utf8");
      expect(source, file).toContain("toast(");
      expect(source, file).not.toMatch(/role="status">Saved\.?</);
    }
    const agy = await readFile("src/renderer/AgyView.tsx", "utf8");
    expect(agy).not.toContain('state === "saved" ? "Saved. Jobs drafted');
  });
});

describe("Application documents in one dropdown tab (#222)", () => {
  it("the job page has Overview, Application, Interview and Files; the documents are menu items", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    expect(page).toContain("<ApplicationTabMenu");
    expect(page).toMatch(/role="tab" id="job-tab-application"[^>]*aria-haspopup="menu"/);
    expect(page).toMatch(/role="menuitem" id=\{`job-tab-\$\{item\.id\}`\}/);
    // Document tabs are never drawn as tabs of their own.
    expect(page).toMatch(/tabItems\.filter\(\(item\) => item\.tab !== "application" && item\.id !== "overview"\)/);
  });
});

describe("Overview and Checks say it once (#223)", () => {
  it("Tracking folds to one summary line, the empty Interviews card hides, Checks has no files table, the empty Interview tab is one line", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    expect(page).toMatch(/<details className="tracker-fold">\s*<summary><h2>Tracking<\/h2>/);
    expect(page).toContain("(interviewLoading || rounds.length > 0) && <section");
    expect(page).not.toContain("<h2>Application files</h2>");
    const interview = await readFile("src/renderer/InterviewView.tsx", "utf8");
    expect(interview).not.toContain("It writes a question bank, prep notes, and company research for this job.");
  });
});

describe("Jobs page: one View menu, and sidebar counts that agree (#224)", () => {
  it("layout sits in View, Select in the more menu, and the sidebar hides a zero Jobs count", async () => {
    const jobs = await readFile("src/renderer/JobsHome.tsx", "utf8");
    const toolbar = jobs.slice(jobs.indexOf('<div className="jobs-toolbar">'), jobs.indexOf("{facets.company && <CompanyStrip"));
    const view = toolbar.slice(toolbar.indexOf('jobs-view-menu'), toolbar.indexOf("</details>"));
    expect(view).toContain('aria-label="Layout"');
    expect(toolbar).not.toMatch(/className="filter-toggle" aria-pressed=\{selecting\}/);
    expect(toolbar).toContain('"Select jobs"');
    expect(jobs).toMatch(/<button className="btn-link" onClick=\{exitSelect\}>Done<\/button>/);
    const app = await readFile("src/renderer/App.tsx", "utf8");
    expect(app).toContain("liveApplicationCount(jobs) > 0 && <span");
  });
});
