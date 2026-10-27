export interface Debounced {
  (): void;
  // Resolves once no run is waiting on its delay or running.
  settled(): Promise<void>;
}

// Runs `run` once changes stop for `delayMs`; never two at once, and at most one more queued behind a running one.
export function debounced(run: () => Promise<void>, delayMs: number, onError: (error: unknown) => void): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let dirty = false;
  const waiting: (() => void)[] = [];

  const idle = () => timer === undefined && !running;

  async function attempt(): Promise<void> {
    try {
      await run();
    } catch (error) {
      onError(error);
    }
  }

  async function drain(): Promise<void> {
    timer = undefined;
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      do {
        dirty = false;
        await attempt();
      } while (dirty);
    } finally {
      running = false;
      if (dirty) schedule();
      else if (idle()) for (const done of waiting.splice(0)) done();
    }
  }

  function schedule(): void {
    clearTimeout(timer);
    // A failing onError has nowhere left to report to.
    timer = setTimeout(() => void drain().catch(() => {}), delayMs);
  }
  return Object.assign(schedule, {
    settled: () => (idle() ? Promise.resolve() : new Promise<void>((done) => waiting.push(done))),
  });
}
