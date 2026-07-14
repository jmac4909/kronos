import { WEBVIEW_READY_COMMAND, webviewActionScriptTag } from './webviewSecurity';
import { escapeAttr, escapeHtml } from './webviewHtml';

interface TicketWorkspaceButtonOptions {
  ticket?: string;
  primary?: boolean;
}

export function ticketWorkspaceActionButton(
  action: string,
  label: string,
  options: TicketWorkspaceButtonOptions = {},
): string {
  const classes = `kronos-button${options.primary ? ' primary' : ''}`;
  const ticketAttribute = options.ticket ? ` data-ticket="${escapeAttr(options.ticket)}"` : '';
  return `<button type="button" class="${classes}" data-action="${escapeAttr(action)}"${ticketAttribute}>${escapeHtml(label)}</button>`;
}

export function ticketWorkspaceActionScript(
  nonce: string,
  scriptUri: string,
): string {
  return webviewActionScriptTag(nonce, 'Kronos Ticket Workspace', [
    { messageKey: 'ticket', dataAttribute: 'data-ticket' },
  ], { readyCommand: WEBVIEW_READY_COMMAND, scriptUri });
}
