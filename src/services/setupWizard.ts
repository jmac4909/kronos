import type { QueueState, KronosState as KronosStateSnapshot } from '../state/types';
import type { DoctorCheck } from './doctorChecks';
import type { IntegrationManifestAudit, IntegrationManifestStatus } from './integrationManifest';
import type { KronosProfile } from './profileManager';
import type { ScriptHealth } from './scriptClient';
import { countLabel } from './countLabels';

export type SetupWizardStepStatus = 'done' | 'warn' | 'blocked';

export interface SetupWizardStep {
  id: string;
  title: string;
  detail: string;
  status: SetupWizardStepStatus;
  actionLabel: string;
  actionCommand: string;
}

export interface SetupWizardPlan {
  status: SetupWizardStepStatus;
  summary: string;
  nextStep?: SetupWizardStep | undefined;
  steps: SetupWizardStep[];
}

export interface SetupWizardPlanInput {
  state: KronosStateSnapshot | null;
  queue: QueueState | null;
  profile: KronosProfile;
  doctorChecks: DoctorCheck[];
  manifestStatus: IntegrationManifestStatus;
  manifestAudit: IntegrationManifestAudit;
  scripts: ScriptHealth[];
}

export function buildSetupWizardPlan(input: SetupWizardPlanInput): SetupWizardPlan {
  const state = input.state;
  const projects = state?.projects || {};
  const tickets = state?.tickets || {};
  const queueItems = input.queue?.items || [];
  const authChecks = input.doctorChecks.filter(check => /auth|Claude CLI|GCloud|GCP|model/i.test(check.name));
  const failingAuth = authChecks.filter(check => check.status === 'fail').length;
  const warningAuth = authChecks.filter(check => check.status === 'warn').length;
  const scriptMissing = input.scripts.filter(script => !script.present);
  const manifestBlocked = input.manifestStatus.present && !input.manifestStatus.valid;
  const manifestWarn = !input.manifestStatus.present || input.manifestAudit.status === 'warn';
  const providerFailures = input.doctorChecks.filter(check => check.status === 'fail' && /provider|reachability|script|config|manifest/i.test(check.name)).length;
  const providerWarnings = input.doctorChecks.filter(check => check.status === 'warn' && /provider|reachability|script|config|manifest/i.test(check.name)).length;

  const steps: SetupWizardStep[] = [
    {
      id: 'profile',
      title: 'Profile and branch policy',
      detail: `${input.profile.label}; default base branch ${input.profile.defaultBaseBranch}.`,
      status: 'done',
      actionLabel: 'Profiles',
      actionCommand: 'profiles',
    },
    {
      id: 'auth',
      title: 'Claude and provider auth',
      detail: authChecks.length === 0
        ? 'Doctor has no auth checks to report yet.'
        : `${countLabel(authChecks.length - failingAuth - warningAuth, 'auth check')} passing, ${countLabel(warningAuth, 'warning')}, ${countLabel(failingAuth, 'failure')}.`,
      status: failingAuth > 0 ? 'blocked' : warningAuth > 0 ? 'warn' : 'done',
      actionLabel: 'Auth Check',
      actionCommand: 'setup',
    },
    {
      id: 'scripts',
      title: 'Integration scripts',
      detail: scriptMissing.length > 0
        ? `${scriptMissing.map(script => script.name).join(', ')} missing from the script bundle.`
        : `${countLabel(input.scripts.length, 'required script')} present.`,
      status: scriptMissing.length > 0 ? 'blocked' : 'done',
      actionLabel: 'Doctor',
      actionCommand: 'doctor',
    },
    {
      id: 'manifest',
      title: 'Integration manifest',
      detail: manifestBlocked
        ? `Manifest invalid at ${input.manifestStatus.path}.`
        : input.manifestStatus.present
          ? `Manifest present; ${input.manifestAudit.summary}`
          : 'Manifest is missing; create a snapshot before trusting script or prompt drift checks.',
      status: manifestBlocked ? 'blocked' : manifestWarn ? 'warn' : 'done',
      actionLabel: input.manifestStatus.present ? 'Manifest' : 'Snapshot',
      actionCommand: input.manifestStatus.present ? 'integrationManifest' : 'snapshotIntegrationManifest',
    },
    {
      id: 'providers',
      title: 'Provider reachability and config',
      detail: providerFailures > 0 || providerWarnings > 0
        ? `${countLabel(providerFailures, 'provider/config failure')}, ${countLabel(providerWarnings, 'warning')}.`
        : 'Doctor provider, config, and reachability checks are clear or not required by this profile.',
      status: providerFailures > 0 ? 'blocked' : providerWarnings > 0 ? 'warn' : 'done',
      actionLabel: 'Doctor',
      actionCommand: 'doctor',
    },
    {
      id: 'projects',
      title: 'Project registration',
      detail: Object.keys(projects).length > 0
        ? `${countLabel(Object.keys(projects).length, 'project')} registered.`
        : 'No registered projects yet; discover or register Java repos before dispatching work.',
      status: Object.keys(projects).length > 0 ? 'done' : 'warn',
      actionLabel: 'Settings',
      actionCommand: 'settings',
    },
    {
      id: 'safe-state',
      title: 'Safe operator state',
      detail: Object.keys(tickets).length > 0 || queueItems.length > 0
        ? `${countLabel(Object.keys(tickets).length, 'ticket')} and ${countLabel(queueItems.length, 'queue item')} loaded.`
        : 'No tickets or queue items are loaded. Use fixture state for feedback or a known scratch ticket for mutations.',
      status: Object.keys(tickets).length > 0 || queueItems.length > 0 ? 'done' : 'warn',
      actionLabel: 'Dashboard',
      actionCommand: 'openDashboard',
    },
    {
      id: 'spec-beanstalk',
      title: 'Spec Beanstalk loop',
      detail: 'Generate .xlsx spec artifacts into the Java repo before starting Claude implementation from Excel-derived requirements.',
      status: 'warn',
      actionLabel: 'Spec Beanstalk',
      actionCommand: 'specBeanstalk',
    },
  ];

  const nextStep = steps.find(step => step.status === 'blocked') || steps.find(step => step.status === 'warn');
  const blocked = steps.filter(step => step.status === 'blocked').length;
  const warnings = steps.filter(step => step.status === 'warn').length;
  const status: SetupWizardStepStatus = blocked > 0 ? 'blocked' : warnings > 0 ? 'warn' : 'done';
  return {
    status,
    summary: `${countLabel(steps.length - blocked - warnings, 'setup step')} ready, ${countLabel(warnings, 'warning')}, ${countLabel(blocked, 'blocker')}.`,
    nextStep,
    steps,
  };
}
