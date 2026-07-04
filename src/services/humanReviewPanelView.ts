import type { Ticket } from '../state/types';
import type { HumanReviewInbox, HumanReviewItem } from './humanReviewInbox';
import { actionButton, actionRow, kronosActionPanelScript, kronosOperatorPanelCss, operatorCommandRow } from './operatorPanel';
import { escapeHtml } from './webviewHtml';

interface HumanReviewInboxHtmlOptions {
  tickets?: Record<string, Ticket>;
  nonce: string;
  actionScriptUri?: string | undefined;
}

export function buildHumanReviewInboxHtml(inbox: HumanReviewInbox, options: HumanReviewInboxHtmlOptions): string {
  const brief = humanReviewBrief(inbox);
  const rows = inbox.items.map(item => `<tr class="${item.severity}">
    <td><span class="pill ${item.severity}">${escapeHtml(item.severity.toUpperCase())}</span></td>
    <td>${escapeHtml(item.kind)}</td>
    <td>${escapeHtml(item.title)}</td>
    <td class="detail">${escapeHtml(item.detail)}</td>
    <td>${escapeHtml(item.ticketKey || item.runId || item.worktreePath || '')}</td>
    <td class="action-cell">${humanReviewActionButtons(item, options.tickets || {})}</td>
  </tr>`).join('');
  const empty = inbox.items.length === 0 ? '<div class="empty">No human-review items found.</div>' : '';
  const actions = operatorCommandRow([
    actionButton('refreshPanel', 'Refresh'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  .decision-brief { margin: 12px 0 16px; }
  .decision-brief strong { display: block; font-size: 15px; margin-bottom: 4px; }
  .decision-brief.critical { border-left-color: var(--k-danger); }
  .decision-brief.warning { border-left-color: var(--k-warn); }
  .decision-brief.info { border-left-color: var(--k-accent); }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">Kronos Human Review Inbox</h1><div class="kronos-subtitle">Items where an operator decision is safer than automation</div></div></div>
  ${actions}
  <div class="operator-note decision-brief ${brief.severity}">
    <strong>${escapeHtml(brief.headline)}</strong>
    <div>${escapeHtml(brief.detail)}</div>
    <div class="muted"><strong>Next:</strong> ${escapeHtml(brief.nextStep)}</div>
  </div>
  <div class="operator-summary">
    <div class="summary-card"><div class="num">${inbox.summary.critical}</div><div class="lbl">Critical</div></div>
    <div class="summary-card"><div class="num">${inbox.summary.warning}</div><div class="lbl">Warnings</div></div>
    <div class="summary-card"><div class="num">${inbox.summary.info}</div><div class="lbl">Info</div></div>
    <div class="summary-card"><div class="num">${inbox.summary.total}</div><div class="lbl">Total</div></div>
  </div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Severity</th><th>Kind</th><th>Item</th><th>Detail</th><th>Ref</th><th class="action-cell">Actions</th></tr>${rows}</table></div>`}
</div>${kronosActionPanelScript(options.nonce, 'Kronos Human Review Inbox', options.actionScriptUri)}</body></html>`;
}

function humanReviewBrief(inbox: HumanReviewInbox): { severity: 'critical' | 'warning' | 'info'; headline: string; detail: string; nextStep: string } {
  const first = inbox.items.find(item => item.severity === 'critical')
    || inbox.items.find(item => item.severity === 'warning')
    || inbox.items[0];
  if (!first) {
    return {
      severity: 'info',
      headline: 'No human decisions queued',
      detail: 'Automation has not surfaced any review, recovery, evidence, queue, or integration decisions.',
      nextStep: 'Refresh after active runs finish, or continue from the Dashboard.',
    };
  }
  const count = first.severity === 'critical'
    ? inbox.summary.critical
    : first.severity === 'warning'
      ? inbox.summary.warning
      : inbox.summary.info;
  return {
    severity: first.severity,
    headline: `${count} ${first.severity} decision${count === 1 ? ' needs' : 's need'} review`,
    detail: `${first.title}: ${first.detail}`,
    nextStep: humanReviewNextStep(first),
  };
}

function humanReviewNextStep(item: HumanReviewItem): string {
  if (item.kind === 'run') { return 'Open Run Center, inspect the log and diff, then resume, retry, or mark the run handled.'; }
  if (item.kind === 'evidence') { return 'Open the evidence gate and add the missing note, check, build, environment, or acceptance proof.'; }
  if (item.kind === 'ticket') { return 'Open the ticket, fix the project/blocker state, then queue or start the next safe action.'; }
  if (item.kind === 'worktree') { return 'Open Recovery Center and decide whether the worktree can be cleaned, resumed, or preserved.'; }
  if (item.kind === 'integration') { return 'Open Doctor and repair the missing script, auth, or provider configuration before dispatching.'; }
  if (item.kind === 'queue') { return 'Open Queue Planner and resolve the stale or unsafe queued item before more dispatches.'; }
  return 'Use the primary action in the row, then refresh the inbox.';
}

function humanReviewActionButtons(item: HumanReviewItem, tickets: Record<string, Ticket>): string {
  const ticket = item.ticketKey ? tickets[item.ticketKey] : undefined;
  const hasLinkedProject = Boolean(ticket?.projects?.length);
  const buttons: string[] = [];

  if (item.kind === 'evidence' && item.ticketKey) {
    if (/acceptance criteria not extracted/i.test(item.title)) {
      buttons.push(actionButton('extractAcceptanceCriteria', 'Extract AC', { ticket: item.ticketKey, primary: true }));
    } else if (/acceptance criterion item.*unchecked/i.test(item.title)) {
      buttons.push(actionButton('updateAcceptanceCriteria', 'Check AC', { ticket: item.ticketKey, primary: true }));
    } else if (/test evidence|evidence check|build/i.test(item.title)) {
      buttons.push(actionButton('addEvidenceCheck', 'Add Check', { ticket: item.ticketKey, primary: true }));
    } else {
      buttons.push(actionButton('addEvidence', 'Add Evidence', { ticket: item.ticketKey, primary: true }));
    }
    buttons.push(actionButton('evidenceGate', 'Gate', { ticket: item.ticketKey }));
  } else if (item.kind === 'ticket' && item.ticketKey) {
    if (hasLinkedProject && ticket?.next_action !== 'done') {
      buttons.push(actionButton('startTicket', 'Start', { ticket: item.ticketKey, primary: item.severity === 'critical' }));
      buttons.push(actionButton('addToQueue', 'Queue', { ticket: item.ticketKey }));
    }
    buttons.push(actionButton('viewTicket', item.title.includes('blocked') || !hasLinkedProject ? 'Fix' : 'View', { ticket: item.ticketKey, primary: !hasLinkedProject }));
  } else if (item.kind === 'run') {
    const runOptions = item.runId ? { runId: item.runId } : {};
    buttons.push(actionButton('runCenter', 'Open Run Center', { ...runOptions, primary: item.severity === 'critical' }));
    buttons.push(actionButton('recoveryCenter', 'Recovery', runOptions));
  } else if (item.kind === 'integration') {
    buttons.push(actionButton('doctor', 'Open Doctor', { primary: item.severity === 'critical' }));
  } else if (item.kind === 'worktree') {
    buttons.push(actionButton('recoveryCenter', 'Review Worktree', { itemId: item.id, primary: item.severity === 'critical' }));
    if (item.ticketKey) {
      buttons.push(actionButton('viewTicket', 'View Ticket', { ticket: item.ticketKey }));
    }
  } else if (item.kind === 'queue') {
    buttons.push(actionButton('queuePlanner', 'Open Queue', { primary: item.severity === 'critical' }));
    if (item.ticketKey) {
      buttons.push(actionButton('viewTicket', 'View Ticket', { ticket: item.ticketKey }));
    }
  }

  return actionRow(buttons);
}
