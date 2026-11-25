import { promises as fs } from "node:fs";
import * as path from "node:path";
import { gitCommonDir } from "./worktrees";
import type { StackState } from "./types";

const STATE_DIRNAME = "stackmaestro";
const STATE_FILENAME = "state.json";
const LOCK_FILENAME = "state.lock";
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 50;

const EMPTY_STATE: StackState = { version: 1, claims: [], layerNotes: {}, agents: {} };

async function statePaths(cwd: string) {
  const dir = path.join(await gitCommonDir(cwd), STATE_DIRNAME);
  return { dir, file: path.join(dir, STATE_FILENAME), lock: path.join(dir, LOCK_FILENAME) };
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  const start = Date.now();
  for (;;) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.close();
      return () => fs.unlink(lockPath).catch(() => undefined);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        // Almost certainly a stale lock left by a crashed process — clear it and retry.
        await fs.unlink(lockPath).catch(() => undefined);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

export async function readState(cwd: string): Promise<StackState> {
  const { file } = await statePaths(cwd);
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    // A state.json written before a field existed (agents, most recently) just won't have it —
    // merge onto the empty shape rather than letting every reader guard against undefined.
    return { ...structuredClone(EMPTY_STATE), ...parsed, agents: parsed.agents ?? {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY_STATE);
    throw err;
  }
}

/** Read-modify-write under an exclusive lock, so two agent processes editing
 *  claims at once can't stomp on each other. `mutate` may throw to abort. */
export async function updateState(
  cwd: string,
  mutate: (state: StackState) => StackState
): Promise<StackState> {
  const { dir, file, lock } = await statePaths(cwd);
  await fs.mkdir(dir, { recursive: true });
  const release = await acquireLock(lock);
  try {
    const next = mutate(await readState(cwd));
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2));
    await fs.rename(tmp, file);
    return next;
  } finally {
    await release();
  }
}
