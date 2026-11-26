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
