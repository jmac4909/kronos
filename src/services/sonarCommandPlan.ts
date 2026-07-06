import type { SonarIssue } from './sonarReportView';
import { arrayFromUnknown, optionalTrimmedStringFromUnknown, recordFromUnknown } from './records';

interface SonarBranchSummary {
  name: string;
  isMain?: boolean;
  status?: {
    qualityGateStatus?: string;
  };
}

export interface SonarBranchPickItem {
  label: string;
  description: string;
  detail?: string;
}

export function buildSonarBranchPickItems(
  branches: SonarBranchSummary[],
  fallbackBranch: string,
  unavailableDetail = '',
): SonarBranchPickItem[] {
  if (branches.length > 0) {
    return branches.map(branch => ({
      label: branch.name,
      description: `${branch.isMain ? '(main) ' : ''}${branch.status?.qualityGateStatus || ''}`,
    }));
  }
  const item: SonarBranchPickItem = {
    label: fallbackBranch,
    description: unavailableDetail ? '(default; Sonar branches unavailable)' : '(default)',
  };
  if (unavailableDetail) { item.detail = unavailableDetail; }
  return [item];
}

export function normalizeSonarIssueCommandList(value: unknown): SonarIssue[] {
  return arrayFromUnknown(value)
    .map(normalizeSonarIssueCommandValue)
    .filter((issue): issue is SonarIssue => Boolean(issue));
}

export function formatSonarIssuePromptLine(issue: SonarIssue): string {
  const file = String(issue.component || '').replace(/^[^:]+:/, '') || '?';
  const rule = String(issue.rule || '').replace(/^[^:]+:/, '') || '-';
  const line = issue.line === undefined || issue.line === null || issue.line === '' ? '?' : String(issue.line);
  return `- [${issue.severity || '-'}] ${rule}: ${file}:${line} — ${issue.message || ''}`;
}

export function buildKnownSonarIssuesBlock(value: unknown): string {
  const issuesData = normalizeSonarIssueCommandList(value);
  if (issuesData.length === 0) { return ''; }
  const lines = issuesData.map(formatSonarIssuePromptLine);
  return `KNOWN ISSUES (already fetched — do NOT re-query SonarQube for the issue list):\n${lines.join('\n')}`;
}

export function buildSonarFixBranchStrategy(projectName: string, sourceBranch: string): string {
  const baseBranch = sourceBranch || 'develop';
  const isProtected = !sourceBranch || sourceBranch === 'develop' || sourceBranch === 'main' || sourceBranch === 'master';
  return isProtected
    ? `You are fixing issues from the ${baseBranch} branch. Create a NEW branch: bugfix/sonar-${projectName.toLowerCase()} from ${baseBranch}. After fixing and pushing, create a GitLab MR from your branch into ${baseBranch} using: python ~/.claude/scripts/gitlab_api.py --create-mr`
    : `You are fixing issues on branch ${sourceBranch}. Stay on this branch — push directly, it already has an open MR.`;
}

export function buildSonarFixInstructionBlock(input: {
  customInstructions: string;
  branchStrategy: string;
  issuesData: unknown;
}): string {
  return [
    input.customInstructions ? `CUSTOM INSTRUCTIONS (follow these overrides):\n${input.customInstructions}` : '',
    `BRANCH STRATEGY:\n${input.branchStrategy}`,
    buildKnownSonarIssuesBlock(input.issuesData),
  ].filter(Boolean).join('\n\n');
}

function normalizeSonarIssueCommandValue(value: unknown): SonarIssue | null {
  const record = recordFromUnknown(value);
  const issue: SonarIssue = {};
  const severity = optionalTrimmedStringFromUnknown(record['severity']);
  const rule = optionalTrimmedStringFromUnknown(record['rule']);
  const component = optionalTrimmedStringFromUnknown(record['component']);
  const message = optionalTrimmedStringFromUnknown(record['message']);
  if (severity) { issue.severity = severity; }
  if (rule) { issue.rule = rule; }
  if (component) { issue.component = component; }
  if (record['line'] !== undefined) { issue.line = record['line']; }
  if (message) { issue.message = message; }
  return issue.severity || issue.rule || issue.component || issue.message || issue.line !== undefined ? issue : null;
}
