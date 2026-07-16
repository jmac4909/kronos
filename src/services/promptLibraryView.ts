import { escapeAttr, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';
import { webviewRuntimeScriptTag, webviewRuntimeScriptUri } from './webviewSecurity';

export const PROMPT_LIBRARY_SCRIPT = 'kronos-prompt-library.js';

export interface PromptLibraryComposerInput {
  title: string;
  description: string;
  libraryName: string;
  sourceLabel: string;
  terminalName: string;
  body: string;
  tags: readonly string[];
  suggestedContext: readonly string[];
  appliedVariables: readonly string[];
  warnings: readonly string[];
  nonce: string;
  scriptUri: string;
}

export function buildPromptLibraryComposerHtml(input: PromptLibraryComposerInput): string {
  const title = singleLine(input.title, 200);
  const description = singleLine(input.description, 500);
  const libraryName = singleLine(input.libraryName, 200);
  const sourceLabel = singleLine(input.sourceLabel, 500);
  const terminalName = singleLine(input.terminalName, 300);
  const body = multiline(input.body, 20_000);
  const warnings = input.warnings.slice(0, 20)
    .map(warning => `<div class="message warn">${escapeHtml(singleLine(warning, 1_000))}</div>`)
    .join('');
  const tags = input.tags.slice(0, 20).map(tag => `<span class="kronos-pill info">${escapeHtml(singleLine(tag, 50))}</span>`).join('');
  const context = input.suggestedContext.slice(0, 20)
    .map(item => `<li>${escapeHtml(singleLine(item, 100))}</li>`).join('');
  const variables = input.appliedVariables.slice(0, 20)
    .map(item => `<li><code>{{${escapeHtml(singleLine(item, 100))}}}</code></li>`).join('');
  const script = [
    webviewRuntimeScriptTag(input.nonce, webviewRuntimeScriptUri(input.scriptUri)),
    `<script nonce="${escapeAttr(input.nonce)}" id="kronos-prompt-library-script" src="${escapeAttr(input.scriptUri)}" data-kronos-script-kind="prompt-library" data-kronos-ready-command="__kronosWebviewReady"></script>`,
  ].join('\n');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
${kronosWebviewBaseCss()}
.prompt-shell { max-width: 1080px; }
.prompt-header { align-items: center; }
.prompt-layout { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(260px, .6fr); gap: 14px; align-items: start; }
.prompt-card { padding: 16px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface); }
.prompt-body { width: 100%; min-height: 420px; resize: vertical; padding: 11px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); color: var(--k-fg); background: var(--vscode-input-background, var(--k-bg)); font: 13px/1.5 var(--vscode-editor-font-family, monospace); }
.prompt-body:focus { border-color: var(--vscode-focusBorder, var(--k-accent)); outline: none; }
.prompt-meta { display: grid; gap: 12px; }
.prompt-meta h2 { margin: 0 0 5px; font-size: 13px; }
.prompt-meta p, .prompt-meta li { color: var(--k-muted); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
.prompt-meta ul { margin: 5px 0 0; padding-left: 20px; }
.prompt-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.prompt-actions { margin-top: 12px; }
@media (max-width: 800px) { .prompt-layout { grid-template-columns: 1fr; } }
</style></head><body><main class="kronos-shell prompt-shell">
<header class="kronos-header prompt-header"><div><h1 class="kronos-title">${escapeHtml(title)}</h1><div class="kronos-subtitle">${escapeHtml(description || 'Review and edit this shared instruction before placing it in your terminal.')}</div></div><span class="kronos-pill info">Prompt Library</span></header>
${warnings}
<div class="prompt-layout">
  <section class="prompt-card">
    <label class="kronos-section-title" for="prompt-body">Reviewed prompt</label>
    <p class="kronos-subtitle">Edit the complete instruction below. Kronos saves the reviewed text as a private snapshot and places only a shell-inert reference without pressing Enter.</p>
    <textarea id="prompt-body" class="prompt-body" maxlength="20000" spellcheck="true" autofocus>${escapeHtml(body)}</textarea>
    <div class="kronos-muted">Target terminal: ${escapeHtml(terminalName)}</div>
    <div class="kronos-action-row prompt-actions"><button type="button" class="kronos-button primary" data-action="insertPrompt">Place in Terminal</button><button type="button" class="kronos-button" data-action="openSettings">Prompt Settings</button><button type="button" class="kronos-button" data-action="cancel">Cancel</button></div>
    <div class="kronos-subtitle">Ctrl+Enter (Cmd+Enter on macOS) places the reference. Normal Enter edits. You still submit manually in the terminal.</div>
  </section>
  <aside class="prompt-card prompt-meta">
    <section><h2>Library</h2><p>${escapeHtml(libraryName)}<br>${escapeHtml(sourceLabel)}</p></section>
    <section><h2>Tags</h2><div class="prompt-tags">${tags || '<span class="kronos-muted">None</span>'}</div></section>
    <section><h2>Suggested context</h2>${context ? `<ul>${context}</ul>` : '<p>None. Add Jira, MR, CI, Git, or Basket context separately when useful.</p>'}</section>
    <section><h2>Filled variables</h2>${variables ? `<ul>${variables}</ul>` : '<p>No session placeholders were used.</p>'}</section>
    <section><h2>Authority</h2><p>Library content is data until you review this editor. It cannot launch Claude, execute a command, submit input, or update Git or a provider.</p></section>
  </aside>
</div></main>${script}</body></html>`;
}

function singleLine(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function multiline(value: string, maxLength: number): string {
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '').trim().slice(0, maxLength);
}
