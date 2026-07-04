import type { DiscoveredProject } from '../state/types';

export interface DiscoveryQuickPickEntry {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
  separator?: boolean;
}

export function buildDiscoveryQuickPickEntries(candidates: DiscoveredProject[]): DiscoveryQuickPickEntry[] {
  const withConfig = candidates.filter(c => c.has_project_json);
  const withJiraGuess = candidates.filter(c => !c.has_project_json && c.suggested_jira_key);
  const noConfig = candidates.filter(c => discoveryCandidateNeedsJiraKey(c));
  const items: DiscoveryQuickPickEntry[] = [];

  if (withConfig.length > 0) {
    items.push({ label: '--- Ready to register (has config) ---', separator: true });
    for (const c of withConfig) {
      items.push({ label: c.repo_name, description: '$(check) Has .claude/project.json', detail: c.path, picked: true });
    }
  }

  if (withJiraGuess.length > 0) {
    items.push({ label: `--- Jira key guessed (${withJiraGuess.length} repos) ---`, separator: true });
    for (const c of withJiraGuess) {
      items.push({ label: c.repo_name, description: `Jira: ${c.suggested_jira_key} | ${parentDirName(c.path)}`, detail: c.path });
    }
  }

  if (noConfig.length > 0) {
    items.push({ label: `--- No config (${noConfig.length} repos) ---`, separator: true });
    for (const c of noConfig) {
      items.push({ label: c.repo_name, description: `${parentDirName(c.path)} — needs Jira key`, detail: c.path });
    }
  }

  return items;
}

export function discoveryCandidateNeedsJiraKey(candidate: DiscoveredProject | undefined): boolean {
  return Boolean(candidate && !candidate.has_project_json && !candidate.suggested_jira_key);
}

function parentDirName(projectPath: string): string {
  return projectPath.split(/[\\/]/).slice(-2, -1)[0] || '';
}
