import type { ScriptHealth } from './scriptClient';
import { requiredScripts } from './scriptClient';
import { countLabel } from './countLabels';

export type IntegrationContractCheckStatus = 'pass' | 'warn' | 'fail';

export interface IntegrationContractExpectation {
  id: string;
  script: string;
  command: string;
  purpose: string;
  requiredText: string[];
}

export interface IntegrationContractCheck {
  id: string;
  script: string;
  command: string;
  purpose: string;
  status: IntegrationContractCheckStatus;
  detail: string;
}

export interface IntegrationContractReport {
  status: IntegrationContractCheckStatus;
  summary: string;
  checks: IntegrationContractCheck[];
}

export const INTEGRATION_CONTRACT_EXPECTATIONS: IntegrationContractExpectation[] = [
  {
    id: 'jira-ticket-comments',
    script: 'kronos_state.py',
    command: 'kronos_state.py --ticket-comments <ticket_key>',
    purpose: 'Load Jira comments for ticket detail and evidence review.',
    requiredText: ['--ticket-comments', 'comments'],
  },
  {
    id: 'gitlab-mr-status',
    script: 'gitlab_api.py',
    command: 'gitlab_api.py --mr-status <gitlab_project_id> <mr_iid>',
    purpose: 'Poll MR state, review status, comments, and discussions.',
    requiredText: ['--mr-status', '<gitlab_project_id>', '<mr_iid>'],
  },
  {
    id: 'gitlab-mr-diff',
    script: 'gitlab_api.py',
    command: 'gitlab_api.py --mr-diff <gitlab_project_id> <mr_iid>',
    purpose: 'Fetch changed files for review hints and diff panels.',
    requiredText: ['--mr-diff', 'files'],
  },
  {
    id: 'gitlab-mr-branch',
    script: 'gitlab_api.py',
    command: 'gitlab_api.py --mr-branch <gitlab_project_id> <mr_iid>',
    purpose: 'Resolve the source branch for verify/fix flows.',
    requiredText: ['--mr-branch', 'branch'],
  },
  {
    id: 'gitlab-project-id',
    script: 'gitlab_api.py',
    command: 'gitlab_api.py --project-id <namespace/project>',
    purpose: 'Resolve stable GitLab numeric project IDs for registered repos.',
    requiredText: ['--project-id', 'id'],
  },
  {
    id: 'sonar-project-key',
    script: 'pipeline_monitor.py',
    command: 'pipeline_monitor.py --find-sonar-key <project_name>',
    purpose: 'Discover SonarQube keys for registered projects.',
    requiredText: ['--find-sonar-key', 'sonar_project_key'],
  },
  {
    id: 'sonar-branches',
    script: 'pipeline_monitor.py',
    command: 'pipeline_monitor.py --sonar-branches <sonar_project_key>',
    purpose: 'List branch quality-gate candidates.',
    requiredText: ['--sonar-branches', 'branches'],
  },
  {
    id: 'sonar-gate',
    script: 'pipeline_monitor.py',
    command: 'pipeline_monitor.py --sonar-gate <sonar_project_key> --branch <branch>',
    purpose: 'Fetch quality gate status before and after fixes.',
    requiredText: ['--sonar-gate', '--branch'],
  },
  {
    id: 'sonar-measures',
    script: 'pipeline_monitor.py',
    command: 'pipeline_monitor.py --sonar-measures <sonar_project_key> --branch <branch>',
    purpose: 'Fetch measures for report context.',
    requiredText: ['--sonar-measures', '--branch'],
  },
  {
    id: 'sonar-issues',
    script: 'pipeline_monitor.py',
    command: 'pipeline_monitor.py --sonar-issues <sonar_project_key> --branch <branch>',
    purpose: 'Fetch actionable SonarQube issues for fix-sonar runs.',
    requiredText: ['--sonar-issues', '--branch'],
  },
];

export function buildIntegrationContractReport(input: {
  contractDocText?: string;
  scripts?: ScriptHealth[];
} = {}): IntegrationContractReport {
  const docText = input.contractDocText || '';
  const scripts = input.scripts || requiredScripts();
  const scriptByName = new Map(scripts.map(script => [script.name, script]));
  const checks = INTEGRATION_CONTRACT_EXPECTATIONS.map(expectation => {
    const script = scriptByName.get(expectation.script as ScriptHealth['name']);
    const missingText = expectation.requiredText.filter(text => !docText.includes(text));
    if (!script?.present) {
      return contractCheck(expectation, 'fail', `${expectation.script} is missing from the script bundle.`);
    }
    if (missingText.length > 0) {
      return contractCheck(expectation, 'warn', `Contract docs are missing: ${missingText.join(', ')}.`);
    }
    return contractCheck(expectation, 'pass', 'Script is present and contract text is documented.');
  });
  const failures = checks.filter(check => check.status === 'fail').length;
  const warnings = checks.filter(check => check.status === 'warn').length;
  const passes = checks.filter(check => check.status === 'pass').length;
  const status: IntegrationContractCheckStatus = failures > 0 ? 'fail' : warnings > 0 ? 'warn' : 'pass';
  return {
    status,
    summary: `${countLabel(passes, 'contract check')} passed, ${countLabel(warnings, 'warning')}, ${countLabel(failures, 'failure')}.`,
    checks,
  };
}

function contractCheck(
  expectation: IntegrationContractExpectation,
  status: IntegrationContractCheckStatus,
  detail: string,
): IntegrationContractCheck {
  return {
    id: expectation.id,
    script: expectation.script,
    command: expectation.command,
    purpose: expectation.purpose,
    status,
    detail,
  };
}
