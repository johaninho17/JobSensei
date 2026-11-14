/**
 * The one owner of "a link in the app opens in the user's browser". App windows never navigate away from the app and
 * never open windows of their own: a web link clicked anywhere (a plain link, a `target="_blank"` link, a link inside
 * rendered Markdown) goes to the browser; anything else is refused.
 */

/** The address to hand to the browser, or null when it is not a plain web link. */
export function externalLink(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url.trim());
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** The app's own pages: the dev server while developing, the packaged files otherwise. */
export function isAppPage(url: string, devUrl: string): boolean {
  return url.startsWith("file://") || sameOrigin(url, devUrl);
}

function sameOrigin(url: string, base: string): boolean {
  try { return new URL(url).origin === new URL(base).origin; } catch { return false; }
}

/** What a window does with a link: stay (the app's own page), open it in the browser, or refuse it. */
export function linkAction(url: string, devUrl: string): { kind: "stay" } | { kind: "open"; url: string } | { kind: "refuse" } {
  if (isAppPage(url, devUrl)) return { kind: "stay" };
  const link = externalLink(url);
  return link ? { kind: "open", url: link } : { kind: "refuse" };
}

/** The two hooks of an Electron window's contents this needs (declared here so the module loads without Electron). */
interface LinkContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
  on(event: "will-navigate", listener: (event: { preventDefault(): void }, url: string) => void): unknown;
}

/** Applies the rule to one app window. `open` is the browser opener (Electron's `shell.openExternal`). */
export function handleLinks(contents: LinkContents, devUrl: string, open: (url: string) => unknown): void {
  const send = (url: string): void => {
    const link = externalLink(url);
    if (link && !isAppPage(url, devUrl)) void Promise.resolve(open(link)).catch((error) => console.error(`Could not open ${link}: ${String(error)}`));
  };
  contents.setWindowOpenHandler(({ url }) => { send(url); return { action: "deny" }; });
  contents.on("will-navigate", (event, url) => {
    const action = linkAction(url, devUrl);
    if (action.kind === "stay") return;
    event.preventDefault();
    if (action.kind === "open") send(action.url);
  });
}
