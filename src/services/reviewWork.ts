import { Ticket } from '../state/types';
import { recordEntriesFromUnknown } from './records';

type TicketWithOpenMergeRequest = Ticket & { mr: NonNullable<Ticket['mr']> };

interface ReviewBranchTicket {
  key: string;
  summary: string;
  mr: TicketWithOpenMergeRequest['mr'];
  projects: string[];
}

export function isOpenReviewTicket(ticket: Ticket): ticket is TicketWithOpenMergeRequest {
  return ticket.next_action === 'await_review' && ticket.mr?.state === 'opened';
}

export function openReviewTicketEntries(tickets: Record<string, Ticket> | null | undefined): Array<[string, TicketWithOpenMergeRequest]> {
  return recordEntriesFromUnknown(tickets)
    .filter((entry): entry is [string, TicketWithOpenMergeRequest] => isOpenReviewTicket(entry[1]));
}

export function reviewBranchTickets(tickets: Record<string, Ticket> | null | undefined): ReviewBranchTicket[] {
  return openReviewTicketEntries(tickets).map(([key, ticket]) => ({
    key,
    summary: ticket.summary,
    mr: ticket.mr,
    projects: ticket.projects,
  }));
}
