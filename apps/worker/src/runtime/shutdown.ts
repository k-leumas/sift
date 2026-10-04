const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/**
 * Resolve with the first SIGTERM or SIGINT (D-53). Both listeners are removed
 * once one fires, so a second signal during shutdown gets Node's default
 * behaviour and forces the process to exit. Aborting `abort` removes them
 * too, for a shutdown that starts without a signal (IN-05); the promise then
 * never settles.
 */
export function waitForShutdownSignal(abort?: AbortSignal): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    const remove = () => {
      for (const name of SHUTDOWN_SIGNALS) process.off(name, onSignal);
    };
    const onSignal = (signal: NodeJS.Signals) => {
      remove();
      abort?.removeEventListener('abort', remove);
      resolve(signal);
    };
    if (abort?.aborted) return;
    for (const name of SHUTDOWN_SIGNALS) process.once(name, onSignal);
    abort?.addEventListener('abort', remove, { once: true });
  });
}
