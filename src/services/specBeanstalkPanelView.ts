import { actionButton, actionRow, kronosActionPanelScript } from './operatorPanel';
import type { SpecBeanstalkProjectStatus, SpecBeanstalkSummary } from './specBeanstalk';
import { escapeClass, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';

export interface SpecBeanstalkPanelInput {
  projects: SpecBeanstalkProjectStatus[];
  lastResult?: SpecBeanstalkSummary | undefined;
  nonce?: string | undefined;
  actionScriptUri?: string | undefined;
}

export function buildSpecBeanstalkHtml(input: SpecBeanstalkPanelInput): string {
  const projectCount = input.projects.length;
  const readyCount = input.projects.filter(project => project.hasSpec).length;
  const issueCount = input.projects.filter(project => Boolean(project.issue)).length;
  const lastResult = input.lastResult;
  const actions = actionRow([
    actionButton('generateSpec', 'Generate Spec', { primary: true }),
    actionButton('startBeanstalk', 'Start / Continue'),
    actionButton('openGeneratedSpec', 'Open Spec'),
    actionButton('refreshPanel', 'Refresh'),
  ]);

  return `<!DOCTYPE html>
<html>
<head>
<style>
${kronosWebviewBaseCss()}
.spec-shell { max-width: 1280px; }
.spec-topline { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: start; padding-bottom: 16px; margin-bottom: 18px; border-bottom: 1px solid var(--k-border); }
.spec-topline .kronos-action-row { justify-content: flex-end; }
.spec-status-strip { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 10px; margin: 0 0 14px; }
.spec-mode { border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 11px 12px; background: var(--k-surface); }
.spec-mode.primary { border-color: color-mix(in srgb, var(--k-accent) 45%, var(--k-border)); }
.spec-mode .label { font-weight: 650; font-size: 13px; }
.spec-mode .detail { margin-top: 3px; color: var(--k-muted); font-size: 12px; line-height: 1.35; }
.spec-overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin: 0 0 18px; }
.spec-current { margin-bottom: 18px; }
.spec-current-grid { display: grid; grid-template-columns: minmax(180px, 0.8fr) minmax(0, 1.2fr); gap: 12px; align-items: start; }
.spec-artifact-path { color: var(--k-muted); word-break: break-all; font-size: 12px; }
.spec-table .project-name { font-weight: 650; }
.spec-table .path-cell { color: var(--k-muted); font-size: 11px; word-break: break-all; }
.spec-table .signals { color: var(--k-muted); font-size: 12px; }
.spec-table .colors { margin-top: 3px; color: var(--k-muted); font-size: 11px; }
@media (max-width: 820px) {
  .spec-topline { display: block; }
  .spec-topline .kronos-action-row { justify-content: flex-start; margin-top: 12px; }
  .spec-status-strip,
  .spec-overview,
  .spec-current-grid { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="kronos-shell spec-shell">
  <div class="spec-topline">
    <div>
      <h1 class="kronos-title">Spec Beanstalk</h1>
      <div class="kronos-subtitle">Excel API spec to Java implementation loop</div>
    </div>
    <div>${actions}</div>
  </div>

  <div class="spec-status-strip">
    ${modeBlock('Generate', 'Prepare repo spec', '.xlsx -> Markdown + trace JSON in docs/api-spec', true)}
    ${modeBlock('Continue', 'Run Claude on Java repo', 'Uses generated spec, cites sheet/cell evidence', false)}
  </div>

  <div class="spec-overview">
    ${statBlock(projectCount, 'Projects')}
    ${statBlock(readyCount, 'Spec Ready')}
    ${statBlock(issueCount, 'Needs Review')}
    ${statBlock(lastResult?.formattedCellCount ?? 0, 'Formatted Cells')}
  </div>

  ${lastResultHtml(lastResult)}

  <div class="kronos-section">
    <h2 class="kronos-section-title">Java Repos</h2>
    ${projectTable(input.projects)}
  </div>
</div>
${input.nonce ? kronosActionPanelScript(input.nonce, 'Kronos Spec Beanstalk', input.actionScriptUri) : ''}
</body>
</html>`;
}

function modeBlock(label: string, title: string, detail: string, primary: boolean): string {
  return `<div class="spec-mode ${primary ? 'primary' : ''}">
    <div class="kronos-section-title">${escapeHtml(label)}</div>
    <div class="label">${escapeHtml(title)}</div>
    <div class="detail">${escapeHtml(detail)}</div>
  </div>`;
}

function statBlock(value: number, label: string): string {
  return `<div class="kronos-stat">
    <div class="kronos-stat-value">${escapeHtml(value)}</div>
    <div class="kronos-stat-label">${escapeHtml(label)}</div>
  </div>`;
}

function lastResultHtml(summary: SpecBeanstalkSummary | undefined): string {
  if (!summary) {
    return `<div class="kronos-empty spec-current">No generated spec selected.</div>`;
  }
  return `<div class="kronos-panel pad spec-current">
    <div class="spec-current-grid">
      <div>
        <div class="kronos-section-title">Current Spec</div>
        <strong>${escapeHtml(summary.sourceWorkbook || 'Workbook')}</strong>
        <div class="kronos-detail">${escapeHtml(summary.sheetCount)} sheets, ${escapeHtml(summary.cellCount)} cells, ${escapeHtml(summary.formattedCellCount)} formatted</div>
      </div>
      <div>
        <div class="kronos-section-title">Artifacts</div>
        <div class="spec-artifact-path">${escapeHtml(summary.indexPath)}</div>
        <div class="spec-artifact-path">${escapeHtml(summary.tracePath)}</div>
      </div>
    </div>
  </div>`;
}

function projectTable(projects: SpecBeanstalkProjectStatus[]): string {
  if (projects.length === 0) {
    return '<div class="kronos-empty">No Java repos registered.</div>';
  }
  return `<div class="kronos-table-wrap">
    <table class="kronos-table spec-table">
      <thead>
        <tr>
          <th>Project</th>
          <th>Status</th>
          <th>Source</th>
          <th>Output</th>
          <th>Signals</th>
        </tr>
      </thead>
      <tbody>${projects.map(projectRow).join('')}</tbody>
    </table>
  </div>`;
}

function projectRow(status: SpecBeanstalkProjectStatus): string {
  const summary = status.summary;
  const tone = status.hasSpec ? 'pass' : status.issue ? 'warn' : 'neutral';
  const label = status.hasSpec ? 'Spec ready' : status.issue ? 'Needs review' : 'No spec';
  return `<tr class="${escapeClass(tone)}">
    <td>
      <div class="project-name">${escapeHtml(status.projectName)}</div>
      <div class="path-cell">${escapeHtml(status.projectPath)}</div>
    </td>
    <td><span class="kronos-pill ${escapeClass(tone)}">${escapeHtml(label)}</span>${status.issue ? `<div class="signals">${escapeHtml(status.issue)}</div>` : ''}</td>
    <td>${summary ? `${escapeHtml(summary.sourceWorkbook)}<div class="signals">${escapeHtml(summary.generatedAt)}</div>` : '<span class="kronos-muted">-</span>'}</td>
    <td><div class="path-cell">${escapeHtml(summary?.indexPath || status.outputDir)}</div></td>
    <td>${sheetSignals(summary)}</td>
  </tr>`;
}

function sheetSignals(summary: SpecBeanstalkSummary | undefined): string {
  if (!summary) {
    return '<span class="kronos-muted">-</span>';
  }
  const sheets = summary.sheets.slice(0, 3).map(sheet => {
    const colors = sheet.fillPalette.length ? `<div class="colors">${escapeHtml(sheet.fillPalette.join(', '))}</div>` : '';
    return `<div class="signals">${escapeHtml(sheet.name)}: ${escapeHtml(sheet.cellCount)} cells, ${escapeHtml(sheet.formattedCellCount)} formatted${colors}</div>`;
  }).join('');
  const extra = summary.sheets.length > 3
    ? `<div class="signals">${escapeHtml(summary.sheets.length - 3)} more sheet${summary.sheets.length - 3 === 1 ? '' : 's'}</div>`
    : '';
  return sheets || extra ? `${sheets}${extra}` : '<span class="kronos-muted">No parsed sheets</span>';
}
