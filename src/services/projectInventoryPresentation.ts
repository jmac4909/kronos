import type { ProjectConfig } from '../state/types';

export interface ProjectProviderCredentialReadiness {
  gitlab: boolean;
  jenkins: boolean;
  sonar: boolean;
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
