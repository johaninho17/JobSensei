/**
 * One watcher for the latest pipeline run (application or interview), shared by the whole app: it reads the run status
 * once per interval and pushes it only when it changes. Replaces three renderer pollers (queue, run notifications,
 * status bar) that each scanned every job folder.
 */
export class RunWatcher<T> {
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: string | undefined;
  private value: T | null = null;
  private reading: Promise<T | null> | null = null;

  constructor(private readonly options: { read: () => Promise<T | null>; onChange: (value: T | null) => void; intervalMs?: number }) {}

  /** The latest value read (reads now if none yet). */
  async current(): Promise<T | null> {
    if (this.last === undefined) await this.check();
    return this.value;
  }

  /** Reads once; overlapping calls share one read. Pushes only when the value changed. */
  async check(): Promise<T | null> {
    this.reading ??= this.options.read().catch(() => null).finally(() => { this.reading = null; });
    const next = await this.reading;
    const json = JSON.stringify(next);
    if (json !== this.last) {
      const first = this.last === undefined;
      this.last = json;
      this.value = next;
      if (!first) this.options.onChange(next);
    }
    return this.value;
  }

  start(): void {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.options.intervalMs ?? 4000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Forget the last value (another workspace was opened). */
  reset(): void {
    this.last = undefined;
    this.value = null;
  }
}
