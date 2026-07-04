import type { MergeRequestDiffResult } from './integrationAdapters';
import { primaryChangedFilePath } from './changedFiles';
import { escapeHtml, kronosWebviewBaseCss } from './webviewHtml';

export function buildDiffHtml(data: MergeRequestDiffResult): string {
  const mr = data.mr;
  const files = data.files;
  const esc = escapeHtml;
  const fileAnchor = (idx: number, filePath: string) => `file-${idx}-${encodeURIComponent(filePath || `file-${idx + 1}`)}`;

  const fileList = files.map((f, idx) => {
    const filePath = primaryChangedFilePath(f) || `file-${idx + 1}`;
    const icon = f.new_file ? '+' : f.deleted_file ? '-' : '~';
    const kind = f.new_file ? 'add' : f.deleted_file ? 'del' : 'mod';
    return `<a href="#${fileAnchor(idx, filePath)}" class="file-link ${kind}">${icon} ${esc(filePath)}</a>`;
  }).join('');

  const diffs = files.map((f, idx) => {
    const filePath = primaryChangedFilePath(f) || `file-${idx + 1}`;
    const lines = String(f.diff || '').split('\n').map((line: string) => {
      const escaped = esc(line);
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return `<div class="line add">${escaped}</div>`;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        return `<div class="line del">${escaped}</div>`;
      } else if (line.startsWith('@@')) {
        return `<div class="line hunk">${escaped}</div>`;
      }
      return `<div class="line">${escaped}</div>`;
    }).join('');
    const label = f.new_file ? '(new file)' : f.deleted_file ? '(deleted)' : '';
    return `<div class="file-diff" id="${fileAnchor(idx, filePath)}">
      <div class="file-header">${esc(filePath)} ${label}</div>
      <div class="diff-content">${lines}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosWebviewBaseCss()}
  .diff-shell { max-width: none; }
  .mr-meta { display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--k-muted); font-size: 12px; }
  .file-list { display: grid; gap: 2px; margin: 12px 0 18px; padding: 8px; }
  .file-link { display: block; padding: 3px 6px; border-radius: var(--k-radius-sm); text-decoration: none; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .file-link.add { color: var(--k-ok); }
  .file-link.del { color: var(--k-danger); }
  .file-link.mod { color: var(--k-accent); }
  .file-link:hover { background: var(--k-hover); text-decoration: none; }
  .file-diff { margin: 16px 0; }
  .file-header { background: var(--k-surface-soft); padding: 7px 12px; font-weight: 650; border: 1px solid var(--k-border); border-bottom: none; border-radius: var(--k-radius-sm) var(--k-radius-sm) 0 0; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .diff-content { border: 1px solid var(--k-border); border-radius: 0 0 var(--k-radius-sm) var(--k-radius-sm); overflow-x: auto; background: var(--k-bg); }
  .line { padding: 0 12px; white-space: pre; min-height: 18px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 18px; }
  .line.add { background: rgba(40, 167, 69, 0.15); color: var(--vscode-gitDecoration-addedResourceForeground); }
  .line.del { background: rgba(220, 53, 69, 0.15); color: var(--vscode-gitDecoration-deletedResourceForeground); }
  .line.hunk { background: var(--k-surface-soft); color: var(--k-accent); font-style: italic; }
</style></head><body><div class="kronos-shell diff-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">${esc(mr.title || 'Merge Request Diff')}</h1>
      <div class="mr-meta">
        <span>${esc(mr.source_branch || '')} &rarr; ${esc(mr.target_branch || '')}</span>
        <span>by ${esc(mr.author || '')}</span>
        <span>${files.length} files changed</span>
      </div>
    </div>
  </div>
  ${fileList ? `<div class="file-list kronos-panel">${fileList}</div>` : '<div class="kronos-empty">No changed files found.</div>'}
  ${diffs}
</div></body></html>`;
}
