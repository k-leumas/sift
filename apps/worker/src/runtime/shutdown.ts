const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/**
 * Resolve with the first SIGTERM or SIGINT (D-53). Both listeners are removed
 * once one fires, so a second signal during shutdown gets Node's default
 * behaviour and forces the process to exit.
 */
export function waitForShutdownSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    const onSignal = (signal: NodeJS.Signals) => {
      for (const name of SHUTDOWN_SIGNALS) process.off(name, onSignal);
      resolve(signal);
    };
    for (const name of SHUTDOWN_SIGNALS) process.once(name, onSignal);
  });
}
