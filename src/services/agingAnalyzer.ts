import { Ticket } from '../state/types';
import { isFailingBuildStatus } from './buildStatus';
import { toValidDate } from './dateValues';
import { mergeRequestReviewStatusLabel } from './mergeRequestLabels';
import { recordEntriesFromUnknown } from './records';
import { isOpenReviewTicket } from './reviewWork';
import { severityRank, severitySummary } from './severityRank';

type AgingSeverity = 'critical' | 'warning' | 'info';
type AgingKind = 'review' | 'build' | 'blocked' | 'verification' | 'ticket';

export interface AgingThresholds {
  reviewDays: number;
  buildFailureDays: number;
  blockedDays: number;
  verificationDays: number;
  ticketDays: number;
}

interface AgingItem {
  id: string;
  ticketKey: string;
  kind: AgingKind;
  severity: AgingSeverity;
  ageDays: number;
  thresholdDays: number;
  title: string;
  detail: string;
  url?: string;
}

export interface AgingReport {
  generatedAt: string;
  summary: Record<AgingSeverity, number> & { total: number };
  items: AgingItem[];
}

const DEFAULT_AGING_THRESHOLDS: AgingThresholds = {
  reviewDays: 3,
  buildFailureDays: 1,
  blockedDays: 2,
  verificationDays: 5,
  ticketDays: 14,
};

export function analyzeAging(input: {
  tickets: Record<string, Ticket>;
  now?: Date;
  thresholds?: Partial<AgingThresholds>;
}): AgingReport {
  const now = input.now || new Date();
  const thresholds = { ...DEFAULT_AGING_THRESHOLDS, ...(input.thresholds || {}) };
  const items: AgingItem[] = [];

  for (const [ticketKey, ticket] of recordEntriesFromUnknown(input.tickets)) {
    const reference = referenceDate(ticket);
    if (!reference) { continue; }

    if (isOpenReviewTicket(ticket)) {
      pushIfStale(items, {
        ticketKey,
        ticket,
        kind: 'review',
        now,
        reference,
        thresholdDays: thresholds.reviewDays,
        title: `${ticketKey} has been waiting for review`,
        detail: `MR !${ticket.mr.iid} is ${mergeRequestReviewStatusLabel(ticket.mr.review_status)}.`,
        url: ticket.mr.url,
      });
    }

    if (ticket.next_action === 'fix_build' || isFailedBuild(ticket)) {
      const buildInput = {
        ticketKey,
        ticket,
        kind: 'build',
        now,
        reference,
        thresholdDays: thresholds.buildFailureDays,
        title: `${ticketKey} has a stale build failure`,
        detail: ticket.build ? `Build #${ticket.build.number} is ${ticket.build.status}.` : 'Ticket is marked fix_build without a build record.',
      } as const;
      pushIfStale(items, ticket.build?.url ? { ...buildInput, url: ticket.build.url } : buildInput);
    }

    if (ticket.next_action === 'blocked') {
      pushIfStale(items, {
        ticketKey,
        ticket,
        kind: 'blocked',
        now,
        reference,
        thresholdDays: thresholds.blockedDays,
        title: `${ticketKey} has been blocked`,
        detail: ticket.last_action || ticket.summary,
      });
    }

    if (ticket.next_action === 'verify' || ticket.next_action === 'deploy_monitor') {
      pushIfStale(items, {
        ticketKey,
        ticket,
        kind: 'verification',
        now,
        reference,
        thresholdDays: thresholds.verificationDays,
        title: `${ticketKey} is waiting on verification`,
        detail: `Next action is ${ticket.next_action}.`,
      });
    }

    if (['implement', 'in_progress'].includes(ticket.next_action)) {
      const ticketInput = {
        ticketKey,
        ticket,
        kind: 'ticket',
        now,
        reference,
        thresholdDays: thresholds.ticketDays,
        title: `${ticketKey} has not moved recently`,
        detail: `Next action is ${ticket.next_action}.`,
      } as const;
      pushIfStale(items, ticket.jira_url ? { ...ticketInput, url: ticket.jira_url } : ticketInput);
    }
  }

  const sorted = items.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.ageDays - a.ageDays || a.ticketKey.localeCompare(b.ticketKey));
  return {
    generatedAt: now.toISOString(),
    summary: severitySummary(sorted),
    items: sorted,
  };
}

function pushIfStale(items: AgingItem[], input: {
  ticketKey: string;
  ticket: Ticket;
  kind: AgingKind;
  now: Date;
  reference: Date;
  thresholdDays: number;
  title: string;
  detail: string;
  url?: string;
}): void {
  const ageDays = daysBetween(input.reference, input.now);
  if (ageDays < input.thresholdDays) { return; }
  const item: AgingItem = {
    id: `${input.kind}:${input.ticketKey}`,
    ticketKey: input.ticketKey,
    kind: input.kind,
    severity: ageDays >= input.thresholdDays * 2 ? 'critical' : input.kind === 'ticket' ? 'info' : 'warning',
    ageDays,
    thresholdDays: input.thresholdDays,
    title: input.title,
    detail: input.detail,
  };
  if (input.url) { item.url = input.url; }
  items.push(item);
}

function referenceDate(ticket: Ticket): Date | null {
  const candidates = [
    ticket.last_action_at,
    ticket.evidence?.updated_at,
    ticket.updated,
  ];
  for (const candidate of candidates) {
    const parsed = toValidDate(candidate);
    if (parsed) { return parsed; }
  }
  return null;
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

function isFailedBuild(ticket: Ticket): boolean {
  return isFailingBuildStatus(ticket.build?.status);
}
