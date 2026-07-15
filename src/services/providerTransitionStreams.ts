import * as crypto from 'crypto';
import type {
  MonitorEventMetadataValue,
  MonitorEventSource,
  MonitorEventSubject,
} from './monitorEventStore';
import type { WorkSessionRecord } from './workSessionStore';

interface ProviderTransitionEventLike {
  sessionId: string;
  source: MonitorEventSource;
  subject?: MonitorEventSubject;
  metadata?: Record<string, MonitorEventMetadataValue>;
}

/**
 * Canonical Attention stream identity:
 * scope (project or session) + provider + resource + logical subject + facet.
 *
 * Occurrence IDs such as pipeline IDs and Jenkins build numbers deliberately
 * do not become logical subjects. A newer occurrence must replace the stale
 * row for the same MR pipeline or project job. MR IIDs and SonarQube branches
 * remain subjects because multiple current MRs or analyzed branches may need
 * independent attention.
 */
export function providerTransitionStreamKey(
  event: ProviderTransitionEventLike,
  session: WorkSessionRecord | undefined,
): string {
  const identity = providerTransitionStreamIdentity(event, session);
  const digest = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return `provider-stream-${digest.slice(0, 48)}`;
}

/**
 * Strong provider-resource identity used only to correlate the same monitored
 * resource across legacy ticket sessions and current project sessions. It is
 * intentionally unavailable when the provider project cannot be proven: an
 * MR IID alone is not unique across GitLab projects.
 */
export function providerTransitionProjectResourceKey(
  event: ProviderTransitionEventLike,
  session: WorkSessionRecord | undefined,
): string | undefined {
  const transitionKind = metadataString(event, 'transitionKind');
  const providerRead = transitionKind.startsWith('provider_read_')
    || event.subject?.kind === 'provider-read';
  const resource = providerRead ? 'provider-read' : event.subject?.kind || 'provider-event';
  const project = providerProjectIdentity(event, session);
  if (!project) { return undefined; }
  const identity = [
    project,
    event.source,
    resource,
    logicalSubject(event, resource),
    attentionFacet(resource),
  ];
  const digest = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return `provider-resource-${digest.slice(0, 48)}`;
}

function providerTransitionStreamIdentity(
  event: ProviderTransitionEventLike,
  session: WorkSessionRecord | undefined,
): readonly string[] {
  const transitionKind = metadataString(event, 'transitionKind');
  const providerRead = transitionKind.startsWith('provider_read_')
    || event.subject?.kind === 'provider-read';
  const resource = providerRead ? 'provider-read' : event.subject?.kind || 'provider-event';
  const scope = session?.projectName
    ? `project:${session.projectName}`
    : `session:${event.sessionId}`;
  return [
    scope,
    event.source,
    resource,
    logicalSubject(event, resource),
    attentionFacet(resource),
  ];
}

function logicalSubject(event: ProviderTransitionEventLike, resource: string): string {
  if (resource === 'provider-read') {
    return event.source === 'gitlab'
      ? metadataIdentity(event, 'mergeRequestIid', 'merge-request') || event.source
      : event.source;
  }
  if (resource === 'pipeline') {
    return metadataIdentity(event, 'mergeRequestIid', 'merge-request') || 'current-merge-request';
  }
  if (resource === 'build') { return 'configured-job'; }
  if (resource === 'merge-request') {
    return metadataIdentity(event, 'mergeRequestIid', 'merge-request')
      || `merge-request:${event.subject?.id || 'current'}`;
  }
  if (resource === 'quality-gate') {
    const projectKey = metadataString(event, 'projectKey');
    const branch = metadataString(event, 'branch');
    if (projectKey || branch) { return `sonar:${projectKey || 'project'}:${branch || 'branch'}`; }
  }
  return event.subject?.id || 'current';
}

function attentionFacet(resource: string): string {
  if (resource === 'merge-request') { return 'state-and-review'; }
  if (resource === 'pipeline') { return 'pipeline-jobs-and-tests'; }
  if (resource === 'build') { return 'build-stages-and-tests'; }
  if (resource === 'quality-gate') { return 'gate-and-issues'; }
  return resource;
}

function providerProjectIdentity(
  event: ProviderTransitionEventLike,
  session: WorkSessionRecord | undefined,
): string | undefined {
  if (!session) { return undefined; }
  if (event.source === 'gitlab') {
    const mergeRequestIid = metadataValue(event, 'mergeRequestIid')
      || (event.subject?.kind === 'merge-request' ? event.subject.id : undefined);
    if (!mergeRequestIid) { return undefined; }
    const binding = newestBindingProjectId(session, 'gitlab', 'merge-request', mergeRequestIid);
    return binding ? `gitlab:${binding}` : undefined;
  }
  if (event.source === 'jenkins') {
    const binding = newestBindingProjectId(session, 'jenkins', undefined, undefined);
    return binding ? `jenkins:${binding}` : undefined;
  }
  if (event.source === 'sonar') {
    const projectKey = metadataValue(event, 'projectKey');
    if (projectKey) { return `sonar:${projectKey}`; }
    const binding = newestBindingProjectId(session, 'sonar', undefined, undefined);
    return binding ? `sonar:${binding}` : undefined;
  }
  return undefined;
}

function newestBindingProjectId(
  session: WorkSessionRecord,
  provider: 'gitlab' | 'jenkins' | 'sonar',
  resource: 'merge-request' | undefined,
  subjectId: string | undefined,
): string | undefined {
  let newest: { projectId: string; attachedAt: string } | undefined;
  for (const binding of session.providerBindings) {
    if (binding.provider !== provider
      || (resource && binding.resource !== resource)
      || (subjectId && binding.subjectId !== subjectId)
      || !binding.projectId) {
      continue;
    }
    if (!newest || binding.attachedAt > newest.attachedAt) {
      newest = { projectId: binding.projectId, attachedAt: binding.attachedAt };
    }
  }
  return newest?.projectId;
}

function metadataIdentity(
  event: ProviderTransitionEventLike,
  key: string,
  prefix: string,
): string | undefined {
  const value = event.metadata?.[key];
  return (typeof value === 'string' || typeof value === 'number') && String(value)
    ? `${prefix}:${String(value)}`
    : undefined;
}

function metadataString(event: ProviderTransitionEventLike, key: string): string {
  const value = event.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function metadataValue(event: ProviderTransitionEventLike, key: string): string | undefined {
  const value = event.metadata?.[key];
  return (typeof value === 'string' || typeof value === 'number') && String(value)
    ? String(value)
    : undefined;
}
