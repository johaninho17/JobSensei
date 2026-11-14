import { describe, expect, it, vi } from "vitest";
import { externalLink, handleLinks, linkAction } from "../electron/open-link";

const DEV = "http://127.0.0.1:5173";

describe("links open in the browser", () => {
  it("accepts web links only", () => {
    expect(externalLink("https://jobs.example.com/acme/123")).toBe("https://jobs.example.com/acme/123");
    expect(externalLink(" http://example.com ")).toBe("http://example.com/");
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "mailto:a@example.com", "smb://host/share", "not a link", "", null, 42]) expect(externalLink(bad)).toBeNull();
  });

  it("keeps the app's own pages in the window and sends web links out", () => {
    expect(linkAction(`${DEV}/?interviewWorkspace=1`, DEV)).toEqual({ kind: "stay" });
    expect(linkAction("file:///Applications/App/index.html", DEV)).toEqual({ kind: "stay" });
    expect(linkAction("https://jobs.example.com/acme/123", DEV)).toEqual({ kind: "open", url: "https://jobs.example.com/acme/123" });
    expect(linkAction("http://127.0.0.1:9999/other", DEV)).toEqual({ kind: "open", url: "http://127.0.0.1:9999/other" });
    expect(linkAction("javascript:alert(1)", DEV)).toEqual({ kind: "refuse" });
  });

  it("opens clicked links and new-window links, and never lets the window leave the app", () => {
    const open = vi.fn();
    let onOpen: (details: { url: string }) => { action: string } = () => ({ action: "" });
    let onNavigate: (event: { preventDefault: () => void }, url: string) => void = () => undefined;
    handleLinks({
      setWindowOpenHandler: (handler: never) => { onOpen = handler; },
      on: (_name: string, handler: never) => { onNavigate = handler; return undefined as never; },
    } as never, DEV, open);

    expect(onOpen({ url: "https://jobs.example.com/acme/123" })).toEqual({ action: "deny" });
    expect(onOpen({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
    expect(open.mock.calls).toEqual([["https://jobs.example.com/acme/123"]]);

    const stay = { preventDefault: vi.fn() };
    onNavigate(stay, `${DEV}/`);
    expect(stay.preventDefault).not.toHaveBeenCalled();

    const leave = { preventDefault: vi.fn() };
    onNavigate(leave, "https://example.com/posting");
    expect(leave.preventDefault).toHaveBeenCalled();
    expect(open).toHaveBeenLastCalledWith("https://example.com/posting");

    const refused = { preventDefault: vi.fn() };
    onNavigate(refused, "file-evil://x");
    expect(refused.preventDefault).toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(2);
  });
});
