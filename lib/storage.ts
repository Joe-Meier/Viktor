import { createSampleThread } from "./sample";
import { threadSchema } from "./schema";
import type { Thread } from "./types";
import { z } from "zod";

export const STORAGE_KEY = "per-my-last-uncle:v1";
export const STORAGE_VERSION = 1;

export interface AppState {
  threads: Thread[];
  activeId: string | null;
}

const storedSchema = z.object({
  version: z.literal(STORAGE_VERSION),
  activeId: z.string().nullable(),
  threads: z.array(z.unknown()),
});

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export function initialState(): AppState {
  const sample = createSampleThread();
  return { threads: [sample], activeId: sample.id };
}

/**
 * Read saved threads. Anything unreadable falls back to the sample thread; a single
 * corrupt thread is skipped rather than discarding the rest.
 */
export function loadState(store: KeyValueStore | undefined | null): AppState {
  if (!store) return initialState();
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return initialState();
  }
  if (!raw) return initialState();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return initialState();
  }
  const parsed = storedSchema.safeParse(json);
  if (!parsed.success) return initialState();
  const threads: Thread[] = [];
  for (const t of parsed.data.threads) {
    const thread = threadSchema.safeParse(t);
    if (thread.success) threads.push(thread.data);
  }
  if (threads.length === 0 && parsed.data.threads.length > 0) return initialState();
  const activeId = threads.some((t) => t.id === parsed.data.activeId)
    ? parsed.data.activeId
    : (threads[0]?.id ?? null);
  return { threads, activeId };
}

export function saveState(store: KeyValueStore | undefined | null, state: AppState): boolean {
  if (!store) return false;
  try {
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, activeId: state.activeId, threads: state.threads }),
    );
    return true;
  } catch {
    return false;
  }
}
