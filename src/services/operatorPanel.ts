import { WEBVIEW_READY_COMMAND, webviewActionPostScript } from './webviewSecurity';
import { escapeAttr, escapeHtml } from './webviewHtml';

export interface ActionButtonOptions {
  ticket?: string;
  runId?: string;
  planId?: string;
  itemId?: string;
  primary?: boolean;
}

export function actionButton(action: string, label: string, options: ActionButtonOptions = {}): string {
  const classes = `kronos-button${options.primary ? ' primary' : ''}`;
  const ticketAttr = options.ticket ? ` data-ticket="${escapeAttr(options.ticket)}"` : '';
  const runAttr = options.runId ? ` data-run-id="${escapeAttr(options.runId)}"` : '';
  const planAttr = options.planId ? ` data-plan-id="${escapeAttr(options.planId)}"` : '';
  const itemAttr = options.itemId ? ` data-item-id="${escapeAttr(options.itemId)}"` : '';
  return `<button type="button" class="${classes}" data-action="${escapeAttr(action)}"${ticketAttr}${runAttr}${planAttr}${itemAttr}>${escapeHtml(label)}</button>`;
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

export function kronosActionPanelScript(nonce: string, webviewName = 'Kronos action panel', readyDiagnostic = false): string {
  return `<script nonce="${escapeAttr(nonce)}">
${webviewActionPostScript(webviewName, [
  { messageKey: 'ticket', dataAttribute: 'data-ticket' },
  { messageKey: 'runId', dataAttribute: 'data-run-id' },
  { messageKey: 'planId', dataAttribute: 'data-plan-id' },
  { messageKey: 'itemId', dataAttribute: 'data-item-id' },
], readyDiagnostic ? { readyCommand: WEBVIEW_READY_COMMAND } : {})}
</script>`;
}
