export const WIDGET_FETCH_TIMEOUT_MS = 5000;

export class WidgetFetchTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WidgetFetchTimeoutError";
  }
}

/**
 * Runs a widget fetch under a hard timeout. The AbortSignal asks the widget
 * to cancel cooperatively, but the race guarantees the caller gets a
 * WidgetFetchTimeoutError even when the widget ignores its signal — an
 * abort alone would leave the request hanging on a non-cooperative fetch.
 */
export async function fetchWithHardTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMessage: string,
  timeoutMs: number = WIDGET_FETCH_TIMEOUT_MS
): Promise<T> {
  const ac = new AbortController();
  const task = run(ac.signal);
  // If the timeout wins the race, a later cooperative rejection from the
  // abandoned task would otherwise surface as an unhandled rejection.
  task.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          ac.abort(new Error(timeoutMessage));
          reject(new WidgetFetchTimeoutError(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
