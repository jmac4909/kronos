import type { EvidenceGateResult } from './evidenceGate';
import type { EvidenceHandoffPlan } from './evidenceHandoff';
import type { EvidencePublishDestination, EvidencePublishResult } from './evidencePublisher';
import { actionButton, actionRow, kronosActionPanelScript, kronosOperatorPanelCss, operatorCommandRow, operatorDecisionBrief } from './operatorPanel';
import { escapeClass, escapeHtml, safeHttpHref } from './webviewHtml';

export function buildEvidenceHandoffHtml(plan: EvidenceHandoffPlan, nonce?: string, actionScriptUri?: string): string {
  const destinations = plan.destinations.map(destination => {
    const href = safeHttpHref(destination.url);
    return `<tr class="${destination.available ? 'available' : 'missing'}">
      <td><span class="pill ${destination.available ? 'pass' : 'warn'}">${destination.available ? 'AVAILABLE' : 'MISSING'}</span></td>
      <td>${escapeHtml(destination.label)}</td>
      <td>${escapeHtml(destination.detail)}</td>
      <td>${href ? `<a href="${href}">Open</a>` : '-'}</td>
    </tr>`;
  }).join('');
  const steps = plan.manualSteps.map(step => `<li>${escapeHtml(step)}</li>`).join('');
  const comment = escapeHtml(plan.comment);
  const actions = operatorCommandRow([
    actionButton('viewTicket', 'View Ticket', { ticket: plan.ticketKey }),
    actionButton('evidenceGate', 'Evidence Gate', { ticket: plan.ticketKey }),
    actionButton('exportEvidence', 'Export', { ticket: plan.ticketKey }),
    actionButton('publishEvidence', 'Publish', { ticket: plan.ticketKey }),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">Evidence Handoff: ${escapeHtml(plan.ticketKey)}</h1><div class="kronos-subtitle">Manual posting packet with destinations, steps, and copied comment payload</div></div></div>
  ${actions}
  <div class="subtitle">${escapeHtml(plan.summary)}<br>Comment text has been copied to the clipboard. Kronos did not call a posting API.</div>
  <div class="operator-section"><h2>Destinations</h2>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Destination</th><th>Detail</th><th>Open</th></tr>${destinations}</table></div></div>
  <div class="operator-section"><h2>Manual Steps</h2>
  <ol>${steps}</ol>
  </div>
  <div class="operator-section"><h2>Comment Payload</h2>
  <pre>${comment}</pre></div>
  <p>Markdown artifact: ${escapeHtml(plan.exportPath)}</p>
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Evidence Handoff', actionScriptUri) : ''}</body></html>`;
}

export function buildEvidencePublishHtml(results: Array<EvidencePublishResult | EvidencePublishDestination>, ticketKey: string, nonce?: string, actionScriptUri?: string): string {
  const rows = results.map(result => {
    const href = safeHttpHref(result.endpoint);
    const httpStatus = 'httpStatus' in result && result.httpStatus ? `HTTP ${result.httpStatus}` : '';
    return `<tr class="${escapeClass(result.status)}">
      <td><span class="pill ${publishPillClass(result.status)}">${escapeHtml(result.status)}</span></td>
      <td>${escapeHtml(result.label)}</td>
      <td>${escapeHtml(result.detail)}${httpStatus ? `<div class="muted">${escapeHtml(httpStatus)}</div>` : ''}</td>
      <td>${href ? `<a href="${href}">Endpoint</a>` : '-'}</td>
    </tr>`;
  }).join('');
  const empty = results.length === 0 ? '<div class="empty">No publish destinations were evaluated.</div>' : '';
  const actions = operatorCommandRow([
    actionButton('viewTicket', 'View Ticket', { ticket: ticketKey }),
    actionButton('evidenceGate', 'Evidence Gate', { ticket: ticketKey }),
    actionButton('exportEvidence', 'Export', { ticket: ticketKey }),
    actionButton('evidenceHandoff', 'Handoff', { ticket: ticketKey }),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">Evidence Publish: ${escapeHtml(ticketKey)}</h1><div class="kronos-subtitle">External publish results and endpoint safety status</div></div></div>
  ${actions}
  <div class="subtitle">External publishing is safety-gated and credential values are never displayed.</div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Destination</th><th>Detail</th><th>Endpoint</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Evidence Publish', actionScriptUri) : ''}</body></html>`;
}

export function buildEvidenceGateHtml(gates: EvidenceGateResult[], title: string, nonce: string, actionScriptUri?: string): string {
  const summary = {
    fail: gates.filter(g => g.status === 'fail').length,
    warn: gates.filter(g => g.status === 'warn').length,
    pass: gates.filter(g => g.status === 'pass').length,
  };
  const brief = evidenceGateBrief(gates, summary);
  const rows = gates.flatMap(gate => gate.checks.map(check => `<tr class="${check.status}">
    <td><span class="pill ${check.status}">${escapeHtml(check.status.toUpperCase())}</span></td>
    <td>${escapeHtml(gate.ticketKey)}</td>
    <td>${escapeHtml(check.kind)}</td>
    <td>${escapeHtml(check.title)}</td>
    <td class="detail">${escapeHtml(check.detail)}</td>
    <td class="action-cell">${evidenceGateActionButtons(gate, check)}</td>
  </tr>`)).join('');
  const empty = gates.length === 0 ? '<div class="empty">No evidence gate items found.</div>' : '';
  const actions = operatorCommandRow([
    actionButton('refreshPanel', 'Refresh'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">${escapeHtml(title)}</h1><div class="kronos-subtitle">Evidence readiness by ticket and check</div></div></div>
  ${actions}
  ${operatorDecisionBrief({ tone: brief.status, headline: brief.headline, detail: brief.detail, nextStep: brief.nextStep })}
  <div class="operator-summary">
    <div class="summary-card"><div class="num">${summary.fail}</div><div class="lbl">Failing</div></div>
    <div class="summary-card"><div class="num">${summary.warn}</div><div class="lbl">Warnings</div></div>
    <div class="summary-card"><div class="num">${summary.pass}</div><div class="lbl">Passing</div></div>
  </div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Ticket</th><th>Check</th><th>Item</th><th>Detail</th><th class="action-cell">Actions</th></tr>${rows}</table></div>`}
</div>${kronosActionPanelScript(nonce, 'Kronos Evidence Gate', actionScriptUri)}</body></html>`;
}

function evidenceGateBrief(
  gates: EvidenceGateResult[],
  summary: { fail: number; warn: number; pass: number },
): { status: 'fail' | 'warn' | 'pass'; headline: string; detail: string; nextStep: string } {
  const failingGate = gates.find(gate => gate.status === 'fail');
  const warningGate = gates.find(gate => gate.status === 'warn');
  const targetGate = failingGate || warningGate || gates[0];
  if (failingGate) {
    const check = failingGate.checks.find(item => item.status === 'fail') || failingGate.checks[0];
    return {
      status: 'fail',
      headline: `${summary.fail} ticket${summary.fail === 1 ? '' : 's'} blocked by evidence`,
      detail: check ? `${failingGate.ticketKey}: ${check.title} - ${check.detail}` : `${failingGate.ticketKey}: ${failingGate.summary}`,
      nextStep: check ? evidenceGateNextStep(check) : 'Open the ticket and add the missing proof before review handoff.',
    };
  }
  if (warningGate) {
    const check = warningGate.checks.find(item => item.status === 'warn') || warningGate.checks[0];
    return {
      status: 'warn',
      headline: `${summary.warn} ticket${summary.warn === 1 ? ' has' : 's have'} evidence warnings`,
      detail: check ? `${warningGate.ticketKey}: ${check.title} - ${check.detail}` : `${warningGate.ticketKey}: ${warningGate.summary}`,
      nextStep: check ? evidenceGateNextStep(check) : 'Review the warning and add evidence if it affects readiness.',
    };
  }
  if (targetGate) {
    return {
      status: 'pass',
      headline: `${summary.pass} ticket${summary.pass === 1 ? '' : 's'} passing evidence gates`,
      detail: 'No failing evidence checks are blocking the current gate view.',
      nextStep: 'Open the ticket, handoff packet, or publish plan when review is ready.',
    };
  }
  return {
    status: 'pass',
    headline: 'No evidence gate items found',
    detail: 'There are no tickets in this gate view that require evidence action.',
    nextStep: 'Refresh after a run completes or open Dashboard for the next action.',
  };
}

function evidenceGateNextStep(check: EvidenceGateResult['checks'][number]): string {
  if (check.kind === 'notes' || check.kind === 'risk') { return 'Add an evidence note that explains what changed and how it was verified.'; }
  if (check.kind === 'test') { return 'Add a test evidence check with the command, result, and short outcome summary.'; }
  if (check.kind === 'acceptance') { return /not extracted/i.test(check.title) ? 'Extract acceptance criteria, then mark each verified item explicitly.' : 'Mark the verified acceptance item or add the missing proof.'; }
  if (check.kind === 'environment') { return 'Record the environment verification result or add a check that explains why it is deferred.'; }
  if (check.kind === 'build') { return 'Add the build evidence check or rerun the build before review handoff.'; }
  if (check.kind === 'project' || check.kind === 'mr') { return 'Fix the ticket project or merge request linkage before continuing.'; }
  return 'Use the primary row action, then refresh the evidence gate.';
}

function publishPillClass(status: string): string {
  if (status === 'posted' || status === 'ready') { return 'pass'; }
  if (status === 'failed') { return 'fail'; }
  return 'warn';
}

function evidenceGateActionButtons(gate: EvidenceGateResult, check: EvidenceGateResult['checks'][number]): string {
  if (check.status === 'pass') {
    return actionRow([actionButton('viewTicket', 'View Ticket', { ticket: gate.ticketKey })]);
  }

  const buttons: string[] = [];
  if (check.kind === 'notes' || check.kind === 'risk') {
    buttons.push(actionButton('addEvidence', 'Add Evidence', { ticket: gate.ticketKey, primary: true }));
  } else if (check.kind === 'test') {
    buttons.push(actionButton('addEvidenceCheck', 'Add Check', { ticket: gate.ticketKey, primary: true }));
    buttons.push(actionButton('addEvidence', 'Add Note', { ticket: gate.ticketKey }));
  } else if (check.kind === 'acceptance') {
    const isMissingExtraction = /not extracted/i.test(check.title);
    buttons.push(actionButton(isMissingExtraction ? 'extractAcceptanceCriteria' : 'updateAcceptanceCriteria', isMissingExtraction ? 'Extract AC' : 'Check AC', { ticket: gate.ticketKey, primary: true }));
  } else if (check.kind === 'environment') {
    buttons.push(actionButton('recordEnvironmentResult', 'Record Env', { ticket: gate.ticketKey, primary: true }));
    buttons.push(actionButton('addEvidenceCheck', 'Add Check', { ticket: gate.ticketKey }));
  } else if (check.kind === 'build') {
    buttons.push(actionButton('addEvidenceCheck', 'Add Build Check', { ticket: gate.ticketKey, primary: true }));
  } else if (check.kind === 'project' || check.kind === 'mr') {
    buttons.push(actionButton('viewTicket', 'Fix', { ticket: gate.ticketKey, primary: true }));
  }

  if (gate.ready) {
    buttons.push(actionButton('evidenceHandoff', 'Handoff', { ticket: gate.ticketKey }));
    buttons.push(actionButton('publishEvidence', 'Publish', { ticket: gate.ticketKey }));
  }
  return actionRow(buttons);
}
