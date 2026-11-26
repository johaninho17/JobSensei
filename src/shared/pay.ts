// Pay as one readable line, shared by board data (electron/job-boards.ts) and fetched pages (electron/jd-fetch.ts).
/** Currencies shown with a symbol; any other code is written after the amount ("90,000 CHF"). */
export const PAY_SYMBOLS: Record<string, string> = { USD: "$", CAD: "CA$", AUD: "A$", EUR: "€", GBP: "£" };

/** "$145,000 – $175,000 a year" from numbers (any currency code; the period words only when known). */
export function formatPay(min: number | null, max: number | null, currency = "USD", interval: string | number | null = null): string | null {
  // A zero is a placeholder some sites fill in (iCIMS "$0 a year"), never real pay.
  if (min === 0) min = null;
  if (max === 0) max = null;
  if (min === null && max === null) return null;
  const code = currency.toUpperCase();
  const symbol = PAY_SYMBOLS[code];
  const money = (amount: number) => symbol ? `${symbol}${Math.round(amount).toLocaleString("en-US")}` : `${Math.round(amount).toLocaleString("en-US")} ${code}`;
  if (min !== null && max !== null && min === max) max = null;
  const unit = String(interval ?? "");
  const period = /hour/i.test(unit) ? " an hour" : /month/i.test(unit) ? " a month" : /year|annual/i.test(unit) ? " a year" : "";
  return `${[min, max].filter((amount): amount is number => amount !== null).map(money).join(" – ")}${period}`;
}

const SYMBOL_CODES: Record<string, string> = { "$": "USD", "£": "GBP", "€": "EUR" };

/**
 * Pay text as found ("$120K–$150K/year", "$25-$50/hour", "USD 142,350 - 251,160") in the one style formatPay writes
 * ("$120,000 – $150,000 a year"), or the text as it was when no amount can be read (#210).
 */
export function normalPayText(text: string | null | undefined): string | null {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  if (!value) return null;
  const found = [...value.matchAll(/([$£€])?\s?(\d[\d,]*(?:\.\d+)?)\s*([kK])?\b/g)]
    .map((match) => ({ symbol: match[1] ?? null, amount: Number(match[2]!.replace(/,/g, "")) * (match[3] ? 1000 : 1) }))
    .filter((entry) => entry.amount >= 5);
  if (!found.length) return value;
  const symbol = found.find((entry) => entry.symbol)?.symbol ?? null;
  const code = symbol ? SYMBOL_CODES[symbol]! : (/\b(USD|CAD|AUD|EUR|GBP|CHF)\b/i.exec(value)?.[1]?.toUpperCase() ?? "USD");
  const [min, max] = [found[0]!.amount, found.length > 1 ? found[1]!.amount : null];
  const period = /\b(?:hour|hr|hourly)\b/i.test(value) ? "hour" : /\b(?:month|mo)\b/i.test(value) ? "month" : /\b(?:year|yr|annum|annual)\b/i.test(value) || min >= 10000 ? "year" : min < 200 ? "hour" : null;
  return formatPay(min, max, code, period) ?? value;
}

/** Lever's salary range ({ min, max, currency, interval }) as one line. */
export function leverPay(value: unknown): string | null {
  const range = (value ?? {}) as { min?: unknown; max?: unknown; currency?: unknown; interval?: unknown };
  if (typeof range.min !== "number" && typeof range.max !== "number") return null;
  return formatPay(typeof range.min === "number" ? range.min : null, typeof range.max === "number" ? range.max : null, typeof range.currency === "string" ? range.currency : "USD", typeof range.interval === "string" ? range.interval : null);
}
