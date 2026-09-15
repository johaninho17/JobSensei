import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deleteWorkspacePath, listFileTree, previewFile, getBaseResume, listResumePaths, saveMarkdownFile } from "../electron/files";
import { listJobFolders, listJobTree, readRating } from "../electron/job-folders";
import { assertInsideWorkspace, indexContext, summarizeWorkspace } from "../electron/workspace";
import { initializeWorkspace } from "../electron/workspace-init";
import { TerminalSession } from "../electron/terminal";
import { buildContextManifest } from "../electron/context";
import { exportMarkdownPdf } from "../electron/pdf-export";

async function makeWorkspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "sensei-viewer-"));
  await initializeWorkspace(path);
  return path;
}

describe("Sensei viewer workspace", () => {
  it("indexes the context count without changing source files", async () => {
    const workspace = await makeWorkspace();
    const source = "I led customer onboarding and built technical documentation for enterprise users.";
    const sourcePath = join(workspace, "context", "story.md");
    await writeFile(sourcePath, source, "utf8");
    await indexContext(workspace);
    const summary = await summarizeWorkspace(workspace);
    expect(summary.contextFileCount).toBe(1);
    expect(await readFile(sourcePath, "utf8")).toBe(source);
  });

  it("lists context and legacy job folders and previews text files", async () => {
    const workspace = await makeWorkspace();
    await writeFile(join(workspace, "context", "notes.md"), "A grounded career note.", "utf8");
    await mkdir(join(workspace, "jobs", "example-labs"), { recursive: true });
    await mkdir(join(workspace, "jobs", "example-labs", ".sensei"), { recursive: true });
    await writeFile(join(workspace, "jobs", "example-labs", ".sensei", "job.json"), JSON.stringify({ company: "Example Labs", title: "Developer Support Engineer" }), "utf8");
    await writeFile(join(workspace, "jobs", "example-labs", "mock_interview_1.txt"), "Question one.", "utf8");
    await writeFile(join(workspace, "jobs", "example-labs", "evaluation.md"), "## Weighted Fit Score\n84/100\n", "utf8");
    const tree = await listFileTree(workspace);
    expect(tree.map((node) => node.name)).toEqual(["context", "debrief"]);
    expect((await listJobFolders(workspace))[0]).toMatchObject({ id: "example-labs", rating: 4.2 });
    const preview = await previewFile(workspace, "jobs/example-labs/mock_interview_1.txt");
    expect(preview.canPreview).toBe(true);
    expect(preview.content).toBe("Question one.");
    expect(preview.jobCompany).toBe("Example Labs");
    expect(preview.jobTitle).toBe("Developer Support Engineer");
    expect((await listJobTree(workspace))[0]).toMatchObject({ displayName: "Example Labs", subtitle: "Developer Support Engineer", rating: 4.2 });
  });

  it("uses the original JD creation time instead of an AI-authored metadata date", async () => {
    const workspace = await makeWorkspace();
    const job = join(workspace, "jobs", "timestamp-test");
    await mkdir(join(job, ".sensei"), { recursive: true });
    await writeFile(join(job, "original_jd.md"), "# Original Job Description", "utf8");
    await writeFile(join(job, ".sensei", "job.json"), JSON.stringify({
      company: "Timestamp",
      title: "Test Engineer",
      createdAt: "2000-01-01T10:00:00.000Z",
    }), "utf8");

    const [listed] = await listJobFolders(workspace);
    expect(new Date(listed.createdAt).getFullYear()).not.toBe(2000);
  });

  it("reads real-world weighted, overall, and table rating labels", async () => {
    const workspace = await makeWorkspace();
    const job = join(workspace, "jobs", "rating-formats");
    await mkdir(job, { recursive: true });
    for (const [markdown, expected] of [
      ["- **Weighted Score:** 4.33 / 5.0", 4.33],
      ["- **Overall Rating**: 4.79 / 5.0", 4.79],
      ["| **Total / Final Score** | **100%** | — | **4.58 / 5.0** |", 4.58],
    ] as const) {
      await writeFile(join(job, "evaluation.md"), markdown, "utf8");
      expect(await readRating(job, {})).toBe(expected);
    }
  });

  it("derives company and role for legacy jobs without job metadata", async () => {
    const workspace = await makeWorkspace();
    const mendix = join(workspace, "jobs", "mendix-application-support-engineer");
    await mkdir(mendix, { recursive: true });
    await writeFile(join(mendix, "evaluation.md"), "# Evaluation: Mendix - Application Support Engineer\n", "utf8");
    const curri = join(workspace, "jobs", "curri-strategy-operations");
    await mkdir(curri, { recursive: true });
    await writeFile(join(curri, "original_jd.md"), "# Original Job Description\n\nCurri - Strategy & Operations Associate\nLocation: Remote\n", "utf8");
    const cascade = join(workspace, "jobs", "cascade-customer-ops-associate");
    await mkdir(cascade, { recursive: true });
    await writeFile(join(cascade, "evaluation.md"), "# Evaluation: Customer Ops Associate @ Cascade Labs\n", "utf8");
    const ramp = join(workspace, "jobs", "ramp-technical-consultant");
    await mkdir(ramp, { recursive: true });
    await writeFile(join(ramp, "evaluation.md"), "# Application Evaluation\n\n**Company:** Ramp\n**Job Title:** Technical Consultant, Mid-Market\n", "utf8");

    expect(await listJobFolders(workspace)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mendix-application-support-engineer", company: "Mendix", title: "Application Support Engineer" }),
      expect.objectContaining({ id: "curri-strategy-operations", company: "Curri", title: "Strategy & Operations Associate" }),
      expect.objectContaining({ id: "cascade-customer-ops-associate", company: "Cascade Labs", title: "Customer Ops Associate" }),
      expect.objectContaining({ id: "ramp-technical-consultant", company: "Ramp", title: "Technical Consultant, Mid-Market" }),
    ]));
  });

  it("returns metadata for unsupported documents and uses the configured resume", async () => {
    const workspace = await makeWorkspace();
    await mkdir(join(workspace, "resumes"), { recursive: true });
    await writeFile(join(workspace, "resumes", "base.pdf"), "%PDF-fake", "utf8");
    const preview = await previewFile(workspace, "resumes/base.pdf");
    expect(preview.canPreview).toBe(true);
    expect(preview.contentType).toBe("data-url");
    expect(preview.fileType).toBe("pdf");
    expect(await getBaseResume(workspace, "resumes/base.pdf")).toBe("resumes/base.pdf");
  });

  it("rejects traversal and absolute paths", async () => {
    const workspace = await makeWorkspace();
    expect(() => assertInsideWorkspace(workspace, join(workspace, "..", "outside.txt"))).toThrow(/outside/i);
    await expect(previewFile(workspace, "../outside.txt")).rejects.toThrow(/workspace-relative/i);
    await expect(previewFile(workspace, "/tmp/outside.txt")).rejects.toThrow(/outside/i);
  });

  it("moves files and nested folders through the Trash boundary and protects workspace roots", async () => {
    const workspace = await makeWorkspace();
    await writeFile(join(workspace, "context", "remove-me.md"), "temporary", "utf8");
    await mkdir(join(workspace, "jobs", "remove-job", "pdfs"), { recursive: true });
    await writeFile(join(workspace, "jobs", "remove-job", "original_jd.txt"), "job", "utf8");
    const trashItem = (path: string) => rm(path, { recursive: true });
    await deleteWorkspacePath(workspace, "context/remove-me.md", trashItem);
    await expect(stat(join(workspace, "context", "remove-me.md"))).rejects.toThrow();
    await deleteWorkspacePath(workspace, "jobs/remove-job", trashItem);
    await expect(stat(join(workspace, "jobs", "remove-job"))).rejects.toThrow();
    await expect(deleteWorkspacePath(workspace, "context")).rejects.toThrow(/root folders/i);
  });

  it("atomically edits job Markdown without permitting career-source changes", async () => {
    const workspace = await makeWorkspace();
    await mkdir(join(workspace, "jobs", "example"), { recursive: true });
    await writeFile(join(workspace, "jobs", "example", "cover_letter.md"), "First draft.", "utf8");
    await writeFile(join(workspace, "context", "truth.md"), "Source evidence.", "utf8");
    const preview = await previewFile(workspace, "jobs/example/cover_letter.md");
    const saved = await saveMarkdownFile(workspace, {
      relativePath: preview.relativePath,
      content: "Revised draft.",
      expectedContent: preview.content ?? "",
      expectedModifiedAt: preview.modifiedAt,
    });
    expect(saved.content).toBe("Revised draft.");
    expect(await readFile(join(workspace, "jobs", "example", "cover_letter.md"), "utf8")).toBe("Revised draft.");
    await expect(saveMarkdownFile(workspace, {
      relativePath: "context/truth.md",
      content: "Changed source.",
      expectedContent: "Source evidence.",
      expectedModifiedAt: (await previewFile(workspace, "context/truth.md")).modifiedAt,
    })).rejects.toThrow(/read-only/i);
  });

  it("refuses to overwrite Markdown changed by another process", async () => {
    const workspace = await makeWorkspace();
    const path = join(workspace, "debrief", "notes.md");
    await writeFile(path, "Original.", "utf8");
    const preview = await previewFile(workspace, "debrief/notes.md");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
    await writeFile(path, "External edit.", "utf8");
    await expect(saveMarkdownFile(workspace, {
      relativePath: preview.relativePath,
      content: "UI edit.",
      expectedContent: preview.content ?? "",
      expectedModifiedAt: preview.modifiedAt,
    })).rejects.toThrow(/changed on disk/i);
    expect(await readFile(path, "utf8")).toBe("External edit.");
  });

  it("validates terminal input and can stop an idle session", async () => {
    const workspace = await makeWorkspace();
    const session = new TerminalSession();
    expect(() => session.write("x".repeat(100_001))).toThrow(/invalid/i);
    expect(() => session.resize(1, 24)).toThrow(/invalid/i);
    expect(() => session.resize(80, 201)).toThrow(/invalid/i);
    session.stop();
    expect(workspace).toContain("sensei-viewer-");
  });

  it("keeps background context updates out of the live PTY", async () => {
    const terminalSource = await readFile(join(__dirname, "..", "electron", "terminal.ts"), "utf8");
    const setContextBody = /setContext\(manifest: ContextManifest\): void \{([\s\S]*?)\n  \}/.exec(terminalSource)?.[1] ?? "";
    expect(setContextBody).toContain("this.manifest = manifest");
    expect(setContextBody).not.toContain("this.write(");
    expect(setContextBody).not.toContain("export SENSEI_");
  });

  it("builds career-first context and includes only selected job folders", async () => {
    const workspace = await makeWorkspace();
    await mkdir(join(workspace, "resumes"), { recursive: true });
    await writeFile(join(workspace, "resumes", "base.pdf"), "%PDF-1.4", "utf8");
    await mkdir(join(workspace, "context", "structured"), { recursive: true });
    await mkdir(join(workspace, "context", "broad"), { recursive: true });
    await writeFile(join(workspace, "context", "structured", "story.md"), "Earlier project evidence.", "utf8");
    await writeFile(join(workspace, "context", "broad", "notes.txt"), "Raw supporting context.", "utf8");
    await mkdir(join(workspace, "jobs", "example-labs"), { recursive: true });
    await mkdir(join(workspace, "jobs", "example-labs", "emails"), { recursive: true });
    await mkdir(join(workspace, "jobs", "other-role"), { recursive: true });
    await writeFile(join(workspace, "jobs", "example-labs", "original_jd.txt"), "Example job description", "utf8");
    await writeFile(join(workspace, "jobs", "example-labs", "emails", "confirmation.md"), "Application received.", "utf8");
    await writeFile(join(workspace, "jobs", "other-role", "original_jd.txt"), "Other job description", "utf8");

    const manifest = await buildContextManifest(workspace, ["example-labs"], { baseResumePath: "resumes/base.pdf" });
    expect(manifest.baseResumePath).toBe("resumes/base.pdf");
    expect(manifest.contextRoots).toContain("context/structured");
    expect(manifest.selectedJobIds).toEqual(["example-labs"]);
    expect(manifest.selectionMode).toBe("explicit");
    expect(manifest.sourceFiles.map((source) => source.path)).toContain("context/structured/story.md");
    expect(manifest.sourceFiles.map((source) => source.path)).not.toContain("context/broad/notes.txt");
    expect(manifest.sourceFiles.map((source) => source.path)).toContain("jobs/example-labs/original_jd.txt");
    expect(manifest.sourceFiles.map((source) => source.path)).not.toContain("jobs/example-labs/emails/confirmation.md");
    expect(manifest.sourceFiles.map((source) => source.path)).not.toContain("jobs/other-role/original_jd.txt");
    const fileScoped = await buildContextManifest(workspace, { careerPaths: ["context/broad/notes.txt"], structuredPaths: [], broadPaths: ["context/broad/notes.txt"], jobPaths: ["jobs/example-labs/original_jd.txt"], jobIds: [] }, { baseResumePath: "resumes/base.pdf" });
    expect(fileScoped.selectedJobIds).toEqual(["example-labs"]);
    expect(fileScoped.sourceFiles.map((source) => source.path)).toEqual(["context/broad/notes.txt", "jobs/example-labs/original_jd.txt", "resumes/base.pdf"]);
  });

  it("advertises fallback references without treating them as career evidence or UI files", async () => {
    const workspace = await makeWorkspace();
    await mkdir(join(workspace, "fallback-references", "example_evals"), { recursive: true });
    await writeFile(join(workspace, "fallback-references", "example_evals", "cover_letter.md"), "Reference style only.", "utf8");
    await mkdir(join(workspace, "context", "example_evals"), { recursive: true });
    await writeFile(join(workspace, "context", "example_evals", "resume.md"), "Legacy reference style only.", "utf8");
    const manifest = await buildContextManifest(workspace);
    expect(manifest.fallbackReferenceRoots).toEqual(["fallback-references"]);
    expect(manifest.sourceFiles.map((source) => source.path)).not.toContain("fallback-references/example_evals/cover_letter.md");
    expect(manifest.sourceFiles.map((source) => source.path)).not.toContain("context/example_evals/resume.md");
    expect((await listFileTree(workspace)).map((node) => node.name)).not.toContain("fallback-references");
  });

  it("does not guess a base resume and keeps configured secondary resumes lower in the source list", async () => {
    const workspace = await makeWorkspace();
    await mkdir(join(workspace, "resumes"), { recursive: true });
    await writeFile(join(workspace, "resumes", "base.pdf"), "%PDF-1.4", "utf8");
    await writeFile(join(workspace, "resumes", "older.pdf"), "%PDF-1.4", "utf8");
    expect(await getBaseResume(workspace, "resumes/missing.pdf")).toBeNull();
    expect(await listResumePaths(workspace, "resumes/base.pdf", ["resumes/older.pdf", "resumes/missing-secondary.pdf"])).toEqual({ baseResumePath: "resumes/base.pdf", secondaryResumePaths: ["resumes/older.pdf"] });
  });

  it("treats broad project notes as ordinary selected context without conditional roots", async () => {
    const workspace = await makeWorkspace();
    await mkdir(join(workspace, "context", "structured"), { recursive: true });
    await mkdir(join(workspace, "context", "broad"), { recursive: true });
    await writeFile(join(workspace, "context", "broad", "client_work.md"), "Personal client work.", "utf8");
    await writeFile(join(workspace, "context", "structured", "client-work.md"), "Normalized evidence.", "utf8");
    await mkdir(join(workspace, "unapproved"), { recursive: true });
    await writeFile(join(workspace, "unapproved", "platform.md"), "Platform documentation.", "utf8");
    const manifest = await buildContextManifest(workspace);
    expect(manifest.primaryContextRoots).toEqual(["context/structured"]);
    expect(manifest.conditionalContextRoots).toEqual([]);
    expect(manifest.sourceFiles.map((source) => source.path)).toContain("context/structured/client-work.md");
    expect(manifest.sourceFiles.map((source) => source.path)).not.toContain("context/broad/client_work.md");
    expect(manifest.sourceFiles.map((source) => source.path)).not.toContain("unapproved/platform.md");
    const selected = await buildContextManifest(workspace, { careerPaths: ["context/broad/client_work.md"], structuredPaths: [], broadPaths: ["context/broad/client_work.md"], jobPaths: [], jobIds: [] });
    expect(selected.conditionalContextRoots).toEqual([]);
    expect(selected.selectionMode).toBe("explicit");
    expect(selected.selectedBroadPaths).toEqual(["context/broad/client_work.md"]);
    expect(selected.sourceFiles.map((source) => source.path)).not.toContain("unapproved/platform.md");
  });

  it("recognizes generic LinkedIn and project evidence families", async () => {
    const workspace = await makeWorkspace();
    await mkdir(join(workspace, "context", "structured"), { recursive: true });
    await mkdir(join(workspace, "context", "broad"), { recursive: true });
    await writeFile(join(workspace, "context", "structured", "linkedin-profile.md"), "linkedin:example:2023:title\nGraduate study\n", "utf8");
    await writeFile(join(workspace, "context", "structured", "project-highlights.md"), "source_family: project-highlights\n", "utf8");
    await writeFile(join(workspace, "context", "broad", "project_highlights.md"), "source_family: project-highlights\n", "utf8");
    const manifest = await buildContextManifest(workspace);
    expect(manifest.selectedStructuredPaths).toContain("context/structured/linkedin-profile.md");
    expect(manifest.sourceFiles.find((source) => source.path === "context/structured/linkedin-profile.md")?.sourceFamily).toBe("linkedin-profile");
    expect(manifest.sourceFiles.find((source) => source.path === "context/structured/project-highlights.md")?.sourceFamily).toBe("project-highlights");
    expect(manifest.sourceFiles.map((source) => source.path)).not.toContain("context/broad/project_highlights.md");
  });

  it("returns safe failures for malformed DOCX and detects PDF content by signature", async () => {
    const workspace = await makeWorkspace();
    await writeFile(join(workspace, "context", "broken.docx"), "not a zip", "utf8");
    await writeFile(join(workspace, "context", "resume.docx"), "%PDF-1.4 fake pdf", "utf8");
    const broken = await previewFile(workspace, "context/broken.docx");
    expect(broken.canPreview).toBe(false);
    expect(broken.message).toMatch(/DOCX preview unavailable/i);
    const pdf = await previewFile(workspace, "context/resume.docx");
    expect(pdf.fileType).toBe("pdf");
    expect(pdf.contentType).toBe("data-url");
  });

  it("only permits Markdown PDF export inside a job workspace", async () => {
    const workspace = await makeWorkspace();
    await expect(exportMarkdownPdf(workspace, "context/notes.md")).rejects.toThrow(/inside a job workspace/i);
    await expect(exportMarkdownPdf(workspace, "jobs/example/notes.txt")).rejects.toThrow(/Only Markdown/i);
  });
});
