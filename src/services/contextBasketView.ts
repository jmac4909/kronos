import type { ContextBasketItem } from './contextBasketStore';
import { escapeAttr, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';
import { webviewRuntimeScriptTag, webviewRuntimeScriptUri } from './webviewSecurity';

export const CONTEXT_BASKET_SCRIPT = 'kronos-context-basket.js';

export interface ContextBasketViewInput {
  items: readonly ContextBasketItem[];
  conflictIds: ReadonlySet<string>;
  nonce: string;
  scriptUri: string;
  focus?: string;
}

export function buildContextBasketHtml(input: ContextBasketViewInput): string {
  const totalBytes = input.items.reduce((total, item) => total + item.sizeBytes, 0);
  const partial = input.items.filter(item => !item.complete).length;
  const conflicts = input.items.filter(item => input.conflictIds.has(item.id)).length;
  const rows = input.items.map(item => `<article class="basket-item${input.conflictIds.has(item.id) ? ' conflict' : ''}">
    <div class="basket-item-heading"><div><span class="kronos-pill info">${escapeHtml(item.kind)}</span><h2>${escapeHtml(item.label)}</h2></div><span class="kronos-pill ${item.complete ? 'pass' : 'warn'}">${item.complete ? 'Complete' : 'Partial'}</span></div>
    <div class="basket-provenance">${escapeHtml(item.provenance)}</div>
    <div class="basket-facts"><span>Fetched ${escapeHtml(item.fetchedAt)}</span><span>${escapeHtml(formatBytes(item.sizeBytes))}</span><span>SHA ${escapeHtml(item.contentSha256?.slice(0, 12) || 'unavailable')}</span></div>
    ${input.conflictIds.has(item.id) ? '<div class="message warn">Conflict: another selected artifact represents the same source with different content.</div>' : ''}
    ${item.warnings.slice(0, 2).map(warning => `<div class="message warn">${escapeHtml(warning)}</div>`).join('')}
    <div class="kronos-action-row"><button class="kronos-button" type="button" data-action="refresh" data-entry-id="${escapeAttr(item.id)}">Refresh Source…</button><button class="kronos-button" type="button" data-action="remove" data-entry-id="${escapeAttr(item.id)}">Remove</button></div>
  </article>`).join('');
  const script = [
    webviewRuntimeScriptTag(input.nonce, webviewRuntimeScriptUri(input.scriptUri)),
    `<script nonce="${escapeAttr(input.nonce)}" id="kronos-context-basket-script" src="${escapeAttr(input.scriptUri)}" data-kronos-script-kind="context-basket" data-kronos-ready-command="__kronosWebviewReady"></script>`,
  ].join('\n');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
${kronosWebviewBaseCss()}
.basket-shell { max-width: 1080px; }
.basket-summary { display: grid; grid-template-columns: repeat(4, minmax(110px, 1fr)); gap: 8px; margin-bottom: 14px; }
.basket-editor { padding: 14px; margin-bottom: 14px; }
.basket-editor textarea { width: 100%; min-height: 110px; resize: vertical; }
.basket-list { display: grid; gap: 10px; }
.basket-item { padding: 13px; border: 1px solid var(--k-border); border-left: 3px solid var(--k-info); border-radius: var(--k-radius); background: var(--k-surface); }
.basket-item.conflict { border-left-color: var(--k-warn); }
.basket-item-heading { display: flex; justify-content: space-between; gap: 10px; }
.basket-item-heading > div { min-width: 0; }
.basket-item h2 { display: inline; margin: 0 0 0 8px; font-size: 13px; }
.basket-provenance { margin: 7px 0; color: var(--k-muted); overflow-wrap: anywhere; }
.basket-facts { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 9px; color: var(--k-muted); font-size: 10px; }
@media (max-width: 620px) { .basket-summary { grid-template-columns: repeat(2, 1fr); } .basket-item-heading { display: block; } }
</style></head><body><main class="kronos-shell basket-shell">
<header class="kronos-header"><div><h1 class="kronos-title">Context Basket</h1><div class="kronos-subtitle">Collect private evidence references, edit one focus note, then place one inert bundle reference into an operator-owned terminal.</div></div></header>
<section class="basket-summary" aria-label="Basket totals">
  ${stat('Items', String(input.items.length))}${stat('Total size', formatBytes(totalBytes))}${stat('Partial', String(partial))}${stat('Conflicts', String(conflicts))}
</section>
<section class="kronos-panel basket-editor">
  <label class="kronos-section-title" for="basket-focus">Combined operator focus</label>
  <textarea id="basket-focus" class="kronos-input" maxlength="4000" autofocus>${escapeHtml(input.focus || 'Review the selected Jira, merge request, local Git, build, and quality evidence together before making changes.')}</textarea>
  <div class="kronos-action-row" style="margin-top:10px"><button class="kronos-button primary" type="button" data-action="insert">Place Basket in Terminal</button><button class="kronos-button" type="button" data-action="clear"${input.items.length === 0 ? ' disabled' : ''}>Clear Basket</button><button class="kronos-button" type="button" data-action="close">Close</button></div>
  <div class="kronos-subtitle">Nothing refreshes or submits automatically. “Refresh Source…” opens the normal explicit source workflow; add its new artifact when ready.</div>
</section>
<section id="basket-items" class="basket-list" aria-label="Selected context evidence">${rows || '<div class="kronos-empty">The basket is empty. Fetch Jira, MR, CI, or local Git context and choose Add to Basket from its composer.</div>'}</section>
</main>${script}</body></html>`;
}

function stat(label: string, value: string): string {
  return `<div class="kronos-stat"><div class="kronos-stat-value">${escapeHtml(value)}</div><div class="kronos-stat-label">${escapeHtml(label)}</div></div>`;
}

function formatBytes(value: number): string {
  if (value < 1024) { return `${value} B`; }
  if (value < 1024 * 1024) { return `${(value / 1024).toFixed(1)} KiB`; }
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
