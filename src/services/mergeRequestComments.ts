import type { MergeRequestComment } from '../state/types';
import { toValidDate } from './dateValues';

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
