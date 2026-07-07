import type { SetupWizardPlan, SetupWizardStep } from './setupWizard';
import { actionButton, actionRow, kronosActionPanelScript } from './operatorPanel';
import { escapeClass, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';

export function buildSetupWizardHtml(plan: SetupWizardPlan, nonce?: string, actionScriptUri?: string): string {
  const stepRows = plan.steps.map(setupStepHtml).join('');
  const next = plan.nextStep;
  const actions = actionRow([
    actionButton('refreshPanel', 'Refresh'),
    actionButton('setup', 'Auth Check'),
    actionButton('doctor', 'Doctor'),
    actionButton('integrationManifest', 'Manifest'),
    actionButton('integrationContractReport', 'Contracts'),
    actionButton('profiles', 'Profiles'),
    actionButton('specBeanstalk', 'Spec Beanstalk'),
  ]);

  return `<!DOCTYPE html>
<html>
<head>
<style>
${kronosWebviewBaseCss()}
.setup-shell { max-width: 1120px; }
.setup-hero { border: 1px solid var(--k-border); border-left: 3px solid var(--k-accent); border-radius: var(--k-radius); padding: 14px 16px; background: var(--k-surface); margin: 12px 0 16px; }
.setup-hero.blocked { border-left-color: var(--k-danger); }
.setup-hero.warn { border-left-color: var(--k-warn); }
.setup-hero.done { border-left-color: var(--k-ok); }
.setup-hero h2 { margin: 4px 0 6px; font-size: 18px; line-height: 1.25; }
.setup-hero p { margin: 0; color: var(--k-muted); line-height: 1.45; }
.setup-steps { display: grid; gap: 9px; margin-top: 12px; }
.setup-step { display: grid; grid-template-columns: 82px minmax(0, 1fr) auto; gap: 12px; align-items: center; border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 10px 12px; background: var(--k-surface); }
.setup-step.blocked { border-color: color-mix(in srgb, var(--k-danger) 45%, var(--k-border)); }
.setup-step.warn { border-color: color-mix(in srgb, var(--k-warn) 42%, var(--k-border)); }
.setup-step.done { border-color: color-mix(in srgb, var(--k-ok) 35%, var(--k-border)); }
.setup-title { font-weight: 650; font-size: 13px; }
.setup-detail { margin-top: 3px; color: var(--k-muted); font-size: 12px; line-height: 1.35; }
@media (max-width: 760px) {
  .setup-step { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="kronos-shell setup-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Setup Wizard</h1>
      <div class="kronos-subtitle">First-run readiness across auth, scripts, manifest, provider config, safe state, and Spec Beanstalk</div>
    </div>
  </div>
  ${actions}
  <div class="setup-hero ${escapeClass(plan.status)}">
    <div class="kronos-section-title">Readiness</div>
    <h2>${escapeHtml(plan.summary)}</h2>
    <p>${next ? `Next: ${escapeHtml(next.title)} - ${escapeHtml(next.detail)}` : 'All setup steps are clear.'}</p>
  </div>
  <div class="setup-steps">${stepRows}</div>
</div>
${nonce ? kronosActionPanelScript(nonce, 'Kronos Setup Wizard', actionScriptUri) : ''}
</body>
</html>`;
}

function setupStepHtml(step: SetupWizardStep): string {
  return `<div class="setup-step ${escapeClass(step.status)}">
    <span class="kronos-pill ${setupPillClass(step.status)}">${escapeHtml(setupStatusLabel(step.status))}</span>
    <div>
      <div class="setup-title">${escapeHtml(step.title)}</div>
      <div class="setup-detail">${escapeHtml(step.detail)}</div>
    </div>
    ${actionRow([actionButton(step.actionCommand, step.actionLabel)])}
  </div>`;
}

function setupStatusLabel(status: SetupWizardStep['status']): string {
  if (status === 'blocked') { return 'Blocked'; }
  if (status === 'warn') { return 'Review'; }
  return 'Ready';
}

function setupPillClass(status: SetupWizardStep['status']): string {
  if (status === 'blocked') { return 'fail'; }
  if (status === 'warn') { return 'warn'; }
  return 'pass';
}
