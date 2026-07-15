import type { ProjectConfig } from '../state/types';

export interface ProjectProviderCredentialReadiness {
  gitlab: boolean;
  jenkins: boolean;
  sonar: boolean;
}

export interface RegisteredProjectActionPresentation {
  label: string;
  icon: string;
  command: string;
  description?: string;
}

const REGISTERED_PROJECT_ACTIONS: readonly RegisteredProjectActionPresentation[] = Object.freeze([
  Object.freeze({
    label: 'Start Claude in project',
    icon: 'terminal',
    command: 'kronos.newClaudeSession',
    description: 'no Jira ticket',
  }),
  Object.freeze({
    label: 'View Git status and diff',
    icon: 'diff',
    command: 'kronos.openProjectGitStatus',
    description: 'read-only',
  }),
  Object.freeze({
    label: 'Insert working diff in context',
    icon: 'symbol-keyword',
    command: 'kronos.insertProjectGitContext',
    description: 'non-submitting',
  }),
  Object.freeze({ label: 'Open merge request page', icon: 'git-merge', command: 'kronos.openProjectMergeRequest' }),
  Object.freeze({ label: 'Insert MR evidence', icon: 'git-merge', command: 'kronos.insertProjectGitLabContext' }),
  Object.freeze({ label: 'Insert Jenkins / Sonar evidence', icon: 'beaker', command: 'kronos.insertProjectCiContext' }),
  Object.freeze({ label: 'Configure provider polling', icon: 'settings-gear', command: 'kronos.configureProjectIntegrations' }),
  Object.freeze({
    label: 'Set project nickname',
    icon: 'edit',
    command: 'kronos.renameLocalProject',
    description: 'optional; identity and links stay unchanged',
  }),
]);

/** One ordered action inventory keeps project launch, evidence, and setup controls intentional. */
export function registeredProjectActionInventory(): readonly RegisteredProjectActionPresentation[] {
  return REGISTERED_PROJECT_ACTIONS;
}

/**
 * Presents only readiness states. Provider identifiers and credential values
 * are deliberately absent from this view model.
 */
export function projectIntegrationStatusLines(
  config: ProjectConfig,
  credentials: ProjectProviderCredentialReadiness,
  activeSessions: number,
): string[] {
  return [
    providerStatus('GitLab', Boolean(config.gitlab_project_id || config.gitlab_project_path), credentials.gitlab, activeSessions),
    providerStatus('Jenkins', Boolean(config.jenkins_url), credentials.jenkins, activeSessions),
    providerStatus('SonarQube', Boolean(config.sonar_project_key), credentials.sonar, activeSessions),
  ];
}

function providerStatus(name: string, targetConfigured: boolean, credentialsReady: boolean, activeSessions: number): string {
  if (!targetConfigured) { return `${name}: project setup needed`; }
  if (!credentialsReady) { return `${name}: target saved, credentials need Doctor`; }
  return activeSessions > 0
    ? `${name}: automatic polling active for ${activeSessions} ticket session${activeSessions === 1 ? '' : 's'}`
    : `${name}: ready; automatic polling starts with a ticket session`;
}
