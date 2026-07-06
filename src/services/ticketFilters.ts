import type { Ticket } from '../state/types';
import { toValidDate } from './dateValues';
import { recordKeysFromUnknown } from './records';
import { ticketStringArray } from './ticketFields';

export type TicketGroupBy = 'none' | 'action' | 'project' | 'priority';
export type TicketFilterPromptFieldId =
  | 'query'
  | 'project'
  | 'action'
  | 'priority'
  | 'label'
  | 'mrState'
  | 'buildStatus'
  | 'staleDays'
  | 'linked'
  | 'groupBy'
  | 'clear';
export type TicketFilterFacet = 'project' | 'action' | 'priority' | 'label' | 'mrState' | 'buildStatus';

export interface TicketFilter {
  query?: string;
  project?: string;
  action?: string;
  priority?: string;
  label?: string;
  mrState?: string;
  buildStatus?: string;
  staleDays?: number;
  linked?: 'linked' | 'unlinked';
}

export interface TicketFilterPromptField {
  label: string;
  id: TicketFilterPromptFieldId;
}

export interface TicketFilterChoiceItem {
  label: string;
  description?: string;
}

interface TicketViewState {
  filter: TicketFilter;
  groupBy: TicketGroupBy;
}

interface TicketFilterPreset {
  id: string;
  label: string;
  view: TicketViewState;
}

export const TICKET_FILTER_PRESETS: TicketFilterPreset[] = [
  { id: 'active', label: 'Active Work', view: { filter: { action: 'in_progress' }, groupBy: 'project' } },
  { id: 'build_failed', label: 'Build Failed', view: { filter: { action: 'fix_build' }, groupBy: 'project' } },
  { id: 'review_pending', label: 'Review Pending', view: { filter: { action: 'await_review', mrState: 'pending_review' }, groupBy: 'project' } },
  { id: 'stale_week', label: 'Stale 7+ Days', view: { filter: { staleDays: 7 }, groupBy: 'action' } },
  { id: 'unlinked', label: 'Unlinked Tickets', view: { filter: { linked: 'unlinked' }, groupBy: 'action' } },
];

export function filterTickets(entries: Array<[string, Ticket]>, filter: TicketFilter, now = new Date()): Array<[string, Ticket]> {
  return entries.filter(([key, ticket]) => ticketMatchesFilter(key, ticket, filter, now));
}

export function ticketMatchesFilter(key: string, ticket: Ticket, filter: TicketFilter = {}, now = new Date()): boolean {
  if (!hasTicketFilter(filter)) { return true; }
  if (filter.query && !searchText(key, ticket).includes(normalize(filter.query))) { return false; }
  const projects = ticketStringArray(ticket.projects);
  const labels = ticketStringArray(ticket.labels);
  if (filter.project && !projects.some(project => normalize(project) === normalize(filter.project))) { return false; }
  if (filter.action && normalize(ticket.next_action) !== normalize(filter.action)) { return false; }
  if (filter.priority && normalize(ticket.priority) !== normalize(filter.priority)) { return false; }
  if (filter.label && !labels.some(label => normalize(label) === normalize(filter.label))) { return false; }
  if (filter.linked === 'linked' && projects.length === 0) { return false; }
  if (filter.linked === 'unlinked' && projects.length > 0) { return false; }
  if (filter.mrState && !matchesMrState(ticket, filter.mrState)) { return false; }
  if (filter.buildStatus && !matchesBuildStatus(ticket, filter.buildStatus)) { return false; }
  if (filter.staleDays && !isStale(ticket.updated, filter.staleDays, now)) { return false; }
  return true;
}

export function hasTicketFilter(filter: TicketFilter = {}): boolean {
  return Boolean(
    filter.query ||
    filter.project ||
    filter.action ||
    filter.priority ||
    filter.label ||
    filter.mrState ||
    filter.buildStatus ||
    filter.staleDays ||
    filter.linked
  );
}

export function describeTicketFilter(filter: TicketFilter = {}): string {
  const parts: string[] = [];
  if (filter.query) { parts.push(`search "${filter.query}"`); }
  if (filter.project) { parts.push(`project ${filter.project}`); }
  if (filter.action) { parts.push(`action ${filter.action}`); }
  if (filter.priority) { parts.push(`priority ${filter.priority}`); }
  if (filter.label) { parts.push(`label ${filter.label}`); }
  if (filter.mrState) { parts.push(`MR ${filter.mrState}`); }
  if (filter.buildStatus) { parts.push(`build ${filter.buildStatus}`); }
  if (filter.staleDays) { parts.push(`stale ${filter.staleDays}+ days`); }
  if (filter.linked) { parts.push(filter.linked); }
  return parts.length > 0 ? parts.join(', ') : 'all tickets';
}

export type TicketFilterStringField = 'query' | 'project' | 'action' | 'priority' | 'label' | 'mrState' | 'buildStatus';

export function setTicketFilterString<K extends TicketFilterStringField>(
  filter: TicketFilter,
  key: K,
  value: string | undefined,
): void {
  const trimmed = value?.trim();
  if (trimmed) { filter[key] = trimmed; }
  else { delete filter[key]; }
}

export function cleanTicketFilter(filter: TicketFilter): TicketFilter {
  const cleaned: TicketFilter = {};
  if (filter.query?.trim()) { cleaned.query = filter.query.trim(); }
  if (filter.project?.trim()) { cleaned.project = filter.project.trim(); }
  if (filter.action?.trim()) { cleaned.action = filter.action.trim(); }
  if (filter.priority?.trim()) { cleaned.priority = filter.priority.trim(); }
  if (filter.label?.trim()) { cleaned.label = filter.label.trim(); }
  if (filter.mrState?.trim()) { cleaned.mrState = filter.mrState.trim(); }
  if (filter.buildStatus?.trim()) { cleaned.buildStatus = filter.buildStatus.trim(); }
  if (filter.staleDays && filter.staleDays > 0) { cleaned.staleDays = filter.staleDays; }
  if (filter.linked) { cleaned.linked = filter.linked; }
  return cleaned;
}

export function ticketFilterPromptFields(reviewOnly: boolean): TicketFilterPromptField[] {
  return [
    { label: 'Search text', id: 'query' },
    { label: 'Project', id: 'project' },
    { label: 'Action status', id: 'action' },
    { label: 'Priority', id: 'priority' },
    { label: 'Label', id: 'label' },
    { label: 'MR state', id: 'mrState' },
    { label: 'Build status', id: 'buildStatus' },
    { label: 'Stale age', id: 'staleDays' },
    ...(reviewOnly ? [] : [
      { label: 'Link state', id: 'linked' as const },
      { label: 'Group by', id: 'groupBy' as const },
    ]),
    { label: 'Clear filters', id: 'clear' },
  ];
}

export function ticketFilterChoiceItems(values: string[], current?: string): TicketFilterChoiceItem[] {
  return ['Any', ...values].map(value => {
    const item: TicketFilterChoiceItem = { label: value };
    if (value === current) { item.description = 'current'; }
    return item;
  });
}

export function ticketFilterFacetValues(
  facet: TicketFilterFacet,
  tickets: Ticket[],
  projects?: Record<string, unknown>,
): string[] {
  if (facet === 'project') {
    return uniqueTicketFilterValues([
      ...recordKeysFromUnknown(projects),
      ...tickets.flatMap(ticket => ticketStringArray(ticket.projects)),
    ]);
  }
  if (facet === 'action') {
    return uniqueTicketFilterValues(tickets.map(ticket => ticket.next_action));
  }
  if (facet === 'priority') {
    return uniqueTicketFilterValues(tickets.map(ticket => ticket.priority));
  }
  if (facet === 'label') {
    return uniqueTicketFilterValues(tickets.flatMap(ticket => ticketStringArray(ticket.labels)));
  }
  if (facet === 'mrState') {
    return uniqueTicketFilterValues([
      'none',
      'opened',
      'merged',
      'closed',
      'pending_review',
      'approved',
      'changes_requested',
      ...tickets.flatMap(ticket => ticket.mr ? [ticket.mr.state, ticket.mr.review_status] : []),
    ]);
  }
  return uniqueTicketFilterValues([
    'none',
    ...tickets.map(ticket => ticket.build?.status || ''),
  ]);
}

export function uniqueTicketFilterValues(values: string[]): string[] {
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function groupTicketEntries(entries: Array<[string, Ticket]>, groupBy: TicketGroupBy): Array<[string, Array<[string, Ticket]>]> {
  if (groupBy === 'none') {
    return [['Tickets', entries]];
  }
  const groups = new Map<string, Array<[string, Ticket]>>();
  for (const entry of entries) {
    const group = ticketGroupLabel(entry[1], groupBy);
    const items = groups.get(group) || [];
    items.push(entry);
    groups.set(group, items);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function ticketGroupLabel(ticket: Ticket, groupBy: TicketGroupBy): string {
  if (groupBy === 'action') { return ticket.next_action || 'No action'; }
  if (groupBy === 'priority') { return ticket.priority || 'No priority'; }
  if (groupBy === 'project') { return ticketStringArray(ticket.projects)[0] || 'Unlinked'; }
  return 'Tickets';
}

function matchesMrState(ticket: Ticket, state: string): boolean {
  const expected = normalize(state);
  if (expected === 'none') { return !ticket.mr; }
  return normalize(ticket.mr?.state) === expected || normalize(ticket.mr?.review_status) === expected;
}

function matchesBuildStatus(ticket: Ticket, status: string): boolean {
  const expected = normalize(status);
  if (expected === 'none') { return !ticket.build; }
  return normalize(ticket.build?.status) === expected;
}

function isStale(updated: string | undefined, staleDays: number, now: Date): boolean {
  const parsed = toValidDate(updated);
  if (!parsed) { return false; }
  return now.getTime() - parsed.getTime() >= staleDays * 24 * 60 * 60 * 1000;
}

function searchText(key: string, ticket: Ticket): string {
  return [
    key,
    ticket.summary,
    ticket.description,
    ticket.type,
    ticket.priority,
    ticket.jira_status,
    ticket.next_action,
    ...ticketStringArray(ticket.labels),
    ...ticketStringArray(ticket.projects),
  ].map(value => normalize(value)).join(' ');
}

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}
