import type { KronosState } from '../state/KronosState';
import type { MergeRequestChangedFile } from '../state/types';
import { mrFileHintCandidateKeys, type MrFileHintTarget } from './collisionDetector';
import { gitlabAdapter } from './integrationAdapters';
import { unknownErrorMessage } from './errorUtils';

export const LIVE_MR_DIFF_LIMIT = 4;
export const LIVE_MR_DIFF_TIMEOUT_MS = 8000;

export interface MergeRequestFileHintOptions {
  limit?: number;
  timeoutMs?: number;
  loadDiff?: MergeRequestDiffLoader;
  logWarning?: (message: string) => void;
}

interface MergeRequestDiffLoader {
  (state: KronosState, ticketKey: string, options: { timeoutMs: number }): Promise<{ files: MergeRequestChangedFile[] }>;
}

export async function loadMrFileHints(
  state: KronosState,
  targets: MrFileHintTarget[],
  options: MergeRequestFileHintOptions = {},
): Promise<Record<string, MergeRequestChangedFile[]>> {
  const tickets = state.state?.tickets || {};
  const candidateKeys = mrFileHintCandidateKeys({
    targets,
    tickets,
    limit: options.limit ?? LIVE_MR_DIFF_LIMIT,
  });
  if (candidateKeys.length === 0) { return {}; }

  const timeoutMs = options.timeoutMs ?? LIVE_MR_DIFF_TIMEOUT_MS;
  const loadDiff = options.loadDiff || defaultMergeRequestDiffLoader;
  const logWarning = options.logWarning || console.warn;
  const hints: Record<string, MergeRequestChangedFile[]> = {};
  for (const ticketKey of candidateKeys) {
    try {
      const diff = await loadDiff(state, ticketKey, { timeoutMs });
      const files = diff.files;
      if (files.length > 0) {
        hints[ticketKey] = files;
      }
    } catch (e: unknown) {
      logWarning(unknownErrorMessage(e, `Failed to load MR diff hints for ${ticketKey}.`));
    }
  }
  return hints;
}

async function defaultMergeRequestDiffLoader(
  state: KronosState,
  ticketKey: string,
  options: { timeoutMs: number },
): Promise<{ files: MergeRequestChangedFile[] }> {
  return gitlabAdapter.mergeRequestDiff(state, ticketKey, { timeout: options.timeoutMs });
}
