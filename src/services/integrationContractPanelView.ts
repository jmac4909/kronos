import type { IntegrationContractCheck, IntegrationContractReport } from './integrationContractHarness';
import { actionButton, actionRow, kronosActionPanelScript } from './operatorPanel';
import { escapeClass, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';

export function buildIntegrationContractHtml(report: IntegrationContractReport, nonce?: string, actionScriptUri?: string): string {
  const rows = report.checks.map(contractRow).join('');
  const actions = actionRow([
    actionButton('refreshPanel', 'Refresh'),
    actionButton('doctor', 'Doctor'),
    actionButton('integrationManifest', 'Manifest'),
    actionButton('snapshotIntegrationManifest', 'Snapshot'),
  ]);
  return `<!DOCTYPE html>
<html>
<head>
<style>
${kronosWebviewBaseCss()}
.contract-shell { max-width: 1180px; }
.contract-hero { border: 1px solid var(--k-border); border-left: 3px solid var(--k-accent); border-radius: var(--k-radius); padding: 14px 16px; background: var(--k-surface); margin: 12px 0 16px; }
.contract-hero.fail { border-left-color: var(--k-danger); }
.contract-hero.warn { border-left-color: var(--k-warn); }
.contract-hero.pass { border-left-color: var(--k-ok); }
.contract-hero h2 { margin: 4px 0 6px; font-size: 18px; line-height: 1.25; }
.contract-hero p { margin: 0; color: var(--k-muted); line-height: 1.45; }
.contract-command { font-family: var(--vscode-editor-font-family); font-size: 12px; word-break: break-all; }
.contract-purpose { color: var(--k-muted); font-size: 12px; line-height: 1.35; }
</style>
</head>
<body>
<div class="kronos-shell contract-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Integration Contracts</h1>
      <div class="kronos-subtitle">Local harness for the script command shapes used by Jira, GitLab, and Sonar flows</div>
    </div>
  </div>
  ${actions}
  <div class="contract-hero ${escapeClass(report.status)}">
    <div class="kronos-section-title">Contract Harness</div>
    <h2>${escapeHtml(report.summary)}</h2>
    <p>Checks are local. Kronos verifies required scripts exist and the in-repo contract documents the command/field shapes the extension calls.</p>
  </div>
  <div class="kronos-table-wrap">
    <table class="kronos-table">
      <thead><tr><th>Status</th><th>Script</th><th>Command</th><th>Purpose</th><th>Detail</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>
${nonce ? kronosActionPanelScript(nonce, 'Kronos Integration Contracts', actionScriptUri) : ''}
</body>
</html>`;
}

function contractRow(check: IntegrationContractCheck): string {
  return `<tr class="${escapeClass(check.status)}">
    <td><span class="kronos-pill ${contractPillClass(check.status)}">${escapeHtml(check.status.toUpperCase())}</span></td>
    <td>${escapeHtml(check.script)}</td>
    <td><div class="contract-command">${escapeHtml(check.command)}</div></td>
    <td><div class="contract-purpose">${escapeHtml(check.purpose)}</div></td>
    <td>${escapeHtml(check.detail)}</td>
  </tr>`;
}

function contractPillClass(status: IntegrationContractCheck['status']): string {
  if (status === 'fail') { return 'fail'; }
  if (status === 'warn') { return 'warn'; }
  return 'pass';
}
