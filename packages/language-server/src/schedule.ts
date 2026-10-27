// Runs `run` once changes stop for `delayMs`; never two at once, and at most one more queued behind a running one.
export function debounced(run: () => Promise<void>, delayMs: number, onError: (error: unknown) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let dirty = false;

  async function drain(): Promise<void> {
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    do {
      dirty = false;
      try {
        await run();
      } catch (error) {
        onError(error);
      }
    } while (dirty);
    running = false;
  }

  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => void drain(), delayMs);
  };
}
