import { isRecord, recordsFromUnknown, recordString } from './records';

export type RunLikeRecord = Record<string, unknown>;

export function runLikeRecordsFromUnknown(value: unknown): RunLikeRecord[] {
  return recordsFromUnknown(value);
}

export function hasRetryMetadata(run: RunLikeRecord): boolean {
  const promptMetadata = run['promptMetadata'];
  return isRecord(promptMetadata) && recordString(promptMetadata, 'retryOfRunId').length > 0;
}
