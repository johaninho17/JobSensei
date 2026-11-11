// Pay as one readable line, shared by board data (electron/job-boards.ts) and fetched pages (electron/jd-fetch.ts).
/** "$145,000 – $175,000 a year" from numbers (any currency code; the period words only when known). */
export function formatPay(min: number | null, max: number | null, currency = "USD", interval: string | number | null = null): string | null {
  if (min === null && max === null) return null;
  const money = (amount: number) => currency.toUpperCase() === "USD" ? `$${Math.round(amount).toLocaleString("en-US")}` : `${Math.round(amount).toLocaleString("en-US")} ${currency.toUpperCase()}`;
  const unit = String(interval ?? "");
  const period = /hour/i.test(unit) ? " an hour" : /month/i.test(unit) ? " a month" : /year|annual/i.test(unit) ? " a year" : "";
  return `${[min, max].filter((amount): amount is number => amount !== null).map(money).join(" – ")}${period}`;
}
