import { WEBVIEW_READY_COMMAND, webviewActionScriptTag } from './webviewSecurity';
import { escapeAttr, escapeClass, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';
export { normalizeActionPanelMessage, type ActionPanelMessage } from './webviewMessages';

export interface OperatorDecisionBrief {
  tone: string;
  headline: string;
  detail: string;
  nextStep: string;
}

interface ActionButtonOptions {
  ticket?: string;
  runId?: string;
  planId?: string;
  itemId?: string;
  recoveryAction?: string;
  primary?: boolean;
}

export function actionButton(action: string, label: string, options: ActionButtonOptions = {}): string {
  const classes = `kronos-button${options.primary ? ' primary' : ''}`;
  const ticketAttr = options.ticket ? ` data-ticket="${escapeAttr(options.ticket)}"` : '';
  const runAttr = options.runId ? ` data-run-id="${escapeAttr(options.runId)}"` : '';
  const planAttr = options.planId ? ` data-plan-id="${escapeAttr(options.planId)}"` : '';
  const itemAttr = options.itemId ? ` data-item-id="${escapeAttr(options.itemId)}"` : '';
  const recoveryActionAttr = options.recoveryAction ? ` data-recovery-action="${escapeAttr(options.recoveryAction)}"` : '';
  return `<button type="button" class="${classes}" data-action="${escapeAttr(action)}"${ticketAttr}${runAttr}${planAttr}${itemAttr}${recoveryActionAttr}>${escapeHtml(label)}</button>`;
}

export function actionRow(buttons: string[]): string {
  return buttons.length > 0
    ? `<div class="kronos-action-row inline-actions">${buttons.join('')}</div>`
    : '<span class="muted">No action</span>';
}

export function operatorCommandRow(buttons: string[]): string {
  return buttons.length > 0
    ? `<div class="kronos-action-row operator-command-row">${buttons.join('')}</div>`
    : '';
}

export function operatorDecisionBrief(brief: OperatorDecisionBrief): string {
  return `<div class="operator-note decision-brief ${escapeClass(brief.tone)}">
    <strong>${escapeHtml(brief.headline)}</strong>
    <div>${escapeHtml(brief.detail)}</div>
    <div class="muted"><strong>Next:</strong> ${escapeHtml(brief.nextStep)}</div>
  </div>`;
}

export function kronosActionPanelScript(nonce: string, webviewName = 'Kronos action panel', scriptUri?: string): string {
  if (!scriptUri) {
    throw new Error('Kronos action panel requires a packaged webview script URI.');
  }
  return webviewActionScriptTag(nonce, webviewName, [
    { messageKey: 'ticket', dataAttribute: 'data-ticket' },
    { messageKey: 'runId', dataAttribute: 'data-run-id' },
    { messageKey: 'planId', dataAttribute: 'data-plan-id' },
    { messageKey: 'itemId', dataAttribute: 'data-item-id' },
    { messageKey: 'recoveryAction', dataAttribute: 'data-recovery-action' },
  ], { readyCommand: WEBVIEW_READY_COMMAND, scriptUri });
}

export function kronosOperatorPanelCss(): string {
  return `${kronosWebviewBaseCss()}
  .operator-shell { max-width: 1280px; }
  .operator-card .subtitle { margin-bottom: 10px; }
  .decision-brief { margin: 12px 0 16px; }
  .plan-list { display: grid; gap: 10px; }
  .plan-card { display: grid; grid-template-columns: 34px 1fr; gap: 10px; }
  .rank { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--k-border); border-radius: 999px; background: var(--k-surface-soft); font-weight: 700; }
  .score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px; margin-top: 8px; }
  .score-part { border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); padding: 7px 8px; font-size: 11px; background: var(--k-surface-soft); }
  .score-part span { display: block; color: var(--k-muted); font-weight: 650; text-transform: uppercase; }
  .score-part strong { display: inline-block; margin-right: 6px; font-size: 16px; }
  .score-part small { color: var(--k-muted); }`;
}
