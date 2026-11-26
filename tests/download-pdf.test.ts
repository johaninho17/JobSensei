// Issue #236: one document's PDF can be downloaded on its own; an out-of-date or missing PDF is made first.
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

function sensei(state: "current" | "stale" | "none") {
  const calls: string[] = [];
  vi.stubGlobal("window", {
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => true,
    sensei: { files: {
      pdfFreshness: async () => [{ source: "jobs/northwind/Alex_Northwind_Resume.md", kind: "resume", pdf: state === "none" ? null : "jobs/northwind/pdfs/Alex_Northwind_Resume.pdf", state }],
      exportMarkdownPdf: async (source: string) => { calls.push(`export ${source}`); return { relativePath: "jobs/northwind/pdfs/Alex_Northwind_Resume.pdf" }; },
      savePdfAs: async (pdf: string) => { calls.push(`save ${pdf}`); return "/Downloads/Alex_Northwind_Resume.pdf"; },
    } },
  });
  vi.stubGlobal("CustomEvent", class { constructor(public type: string, public init?: unknown) {} });
  return calls;
}

describe("Download PDF (#236)", () => {
  it("saves a current PDF as it is", async () => {
    const calls = sensei("current");
    const { downloadDocumentPdf } = await import("../src/renderer/Documents");
    expect(await downloadDocumentPdf("jobs/northwind/Alex_Northwind_Resume.md")).toBe("/Downloads/Alex_Northwind_Resume.pdf");
    expect(calls).toEqual(["save jobs/northwind/pdfs/Alex_Northwind_Resume.pdf"]);
  });
  it("makes an out-of-date or missing PDF first", async () => {
    for (const state of ["stale", "none"] as const) {
      const calls = sensei(state);
      const { downloadDocumentPdf } = await import("../src/renderer/Documents");
      await downloadDocumentPdf("jobs/northwind/Alex_Northwind_Resume.md");
      expect(calls).toEqual(["export jobs/northwind/Alex_Northwind_Resume.md", "save jobs/northwind/pdfs/Alex_Northwind_Resume.pdf"]);
      vi.resetModules();
    }
  });
});
