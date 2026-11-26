// The one fetcher the app reads job links with (issue #171). It uses Node's fetch, and when a site refuses it
// (403, 429, 503, or a dropped connection) it asks again through Chromium's network stack (Electron's net.fetch),
// which careers sites that block scripted clients usually serve. Main turns the fallback on at startup; code that
// runs as plain Node (the scheduled search runner, scripts, tests) has no fallback. Manual-redirect requests never
// fall back: net.fetch cancels them instead of returning the redirect. Modules take `fetcher = appFetch`, so tests can
// still inject their own.

/** Statuses that mean "this site refused a scripted client", worth one try through Chromium. */
export const REFUSED_STATUSES: ReadonlySet<number> = new Set([403, 429, 503]);

let chromium: typeof fetch | null = null;

/** Main calls this once at startup with net.fetch; null turns the fallback off. */
export function useChromiumFallback(fetcher: typeof fetch | null): void { chromium = fetcher; }

/** Node's fetch, then Chromium's when the site refused Node and a fallback is set. */
export const appFetch: typeof fetch = async (input, init) => {
  const fallback = init?.redirect === "manual" ? null : chromium;
  let response: Response;
  try {
    response = await globalThis.fetch(input, init);
  } catch (error) {
    if (!fallback || init?.signal?.aborted) throw error;
    return fallback(input, init);
  }
  if (!fallback || !REFUSED_STATUSES.has(response.status)) return response;
  return fallback(input, init).catch(() => response);
};
