import type { MergeRequestComment } from '../state/types';
import { toValidDate } from './dateValues';
import { isRecord } from './records';

export function sortMergeRequestCommentsByCreated(comments: MergeRequestComment[]): MergeRequestComment[] {
  return comments
    .map((comment, index) => ({ comment, index, time: toValidDate(comment.created)?.getTime() }))
    .sort((a, b) => {
      const aTime = a.time;
      const bTime = b.time;
      const aHasTime = aTime !== undefined;
      const bHasTime = bTime !== undefined;
      if (aHasTime && bHasTime && aTime !== bTime) {
        return aTime - bTime;
      }
      if (aHasTime !== bHasTime) {
        return aHasTime ? 1 : -1;
      }
      return a.index - b.index;
    })
    .map(item => item.comment);
}

export function mergeRequestCommentsFromRecord(record: object | null | undefined): MergeRequestComment[] {
  if (!record) { return []; }
  const value = Reflect.get(record, 'comments');
  return Array.isArray(value)
    ? value.filter((item): item is MergeRequestComment => isRecord(item) && typeof item['body'] === 'string')
    : [];
}
