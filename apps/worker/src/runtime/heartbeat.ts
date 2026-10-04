import { mkdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Heartbeat file location (D-54). A non-blank SIFT_HEARTBEAT_FILE wins;
 * otherwise `<os.tmpdir()>/sift/heartbeat`, which is /tmp/sift/heartbeat in
 * the container.
 */
export function defaultHeartbeatFile(env: Readonly<Record<string, string | undefined>>): string {
  const override = env.SIFT_HEARTBEAT_FILE?.trim();
  return override ? override : join(tmpdir(), 'sift', 'heartbeat');
}

/**
 * Returns a function that records liveness: it creates the parent directory
 * and replaces the file with the current ISO timestamp. The write goes to a
 * temp file first and is renamed into place, so a healthcheck never reads a
 * half-written file.
 */
export function createHeartbeat(file: string): () => Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  return async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(temp, `${new Date().toISOString()}\n`);
    await rename(temp, file);
  };
}
