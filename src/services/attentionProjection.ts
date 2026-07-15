import * as path from 'path';
import type { MonitorEvent } from './monitorEventStore';
import {
  providerTransitionProjectResourceKey,
  providerTransitionStreamKey,
} from './providerTransitionStreams';
import type { WorkSessionRecord } from './workSessionStore';

export interface AttentionRegisteredProject {
  name: string;
  path: string;
}

/**
 * Rebuilds the current Attention projection from durable audit history.
 * Restart, reload, and another VS Code window therefore produce the same
 * newest-per-stream result from the same normalized records.
 */
export function currentAttentionTransitions(
  events: readonly MonitorEvent[],
  sessions: readonly WorkSessionRecord[],
  registeredProjects?: readonly AttentionRegisteredProject[],
): MonitorEvent[] {
  const sessionsById = new Map(sessions.map(session => [session.id, session]));
  const acknowledged = acknowledgedEventKeys(events);
  const newestFirst = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'provider.transition' && sessionsById.has(event.sessionId))
    .sort((left, right) => right.event.at.localeCompare(left.event.at)
      || left.index - right.index
      || right.event.id.localeCompare(left.event.id));
  const latestByStream = new Map<string, MonitorEvent>();
  for (const { event } of newestFirst) {
    const session = sessionsById.get(event.sessionId);
    const projectSession = attentionProjectSessionForEvent(
      event,
      session,
      sessions,
      registeredProjects,
    );
    const stream = providerTransitionStreamKey(event, projectSession);
    if (!latestByStream.has(stream)) { latestByStream.set(stream, event); }
  }
  return [...latestByStream.values()]
    .filter(event => !acknowledged.has(attentionEventKey(event.sessionId, event.id)))
    .sort((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id));
}

/**
 * Projects legacy ticket-session provider events onto their one proven,
 * registered local project without changing the durable event or its Jira
 * context. Ambiguous or weak matches remain unassigned instead of guessing.
 */
export function attentionProjectSessionForEvent(
  event: MonitorEvent,
  session: WorkSessionRecord | undefined,
  sessions: readonly WorkSessionRecord[],
  registeredProjects?: readonly AttentionRegisteredProject[],
): WorkSessionRecord | undefined {
  if (!session || registeredProjects === undefined) { return session; }
  const project = resolveRegisteredAttentionProject(event, session, sessions, registeredProjects);
  const projected = { ...session };
  delete projected.projectName;
  delete projected.projectPath;
  if (project) {
    projected.projectName = project.name;
    projected.projectPath = project.path;
  }
  return projected;
}

function resolveRegisteredAttentionProject(
  event: MonitorEvent,
  session: WorkSessionRecord,
  sessions: readonly WorkSessionRecord[],
  registeredProjects: readonly AttentionRegisteredProject[],
): AttentionRegisteredProject | undefined {
  const direct = registeredProjectForSession(session, registeredProjects)
    || registeredProjects.find(project => project.name === event.subject?.project);
  if (direct) { return direct; }

  const resourceKey = providerTransitionProjectResourceKey(event, session);
  if (!resourceKey) { return undefined; }
  const matches = new Map<string, AttentionRegisteredProject>();
  for (const candidate of sessions) {
    const project = registeredProjectForSession(candidate, registeredProjects);
    if (!project || providerTransitionProjectResourceKey(event, candidate) !== resourceKey) { continue; }
    matches.set(`${project.name}\u0000${projectPathKey(project.path)}`, project);
  }
  return matches.size === 1 ? [...matches.values()][0] : undefined;
}

function registeredProjectForSession(
  session: WorkSessionRecord,
  registeredProjects: readonly AttentionRegisteredProject[],
): AttentionRegisteredProject | undefined {
  if (session.projectPath) {
    const projectPath = projectPathKey(session.projectPath);
    const byPath = registeredProjects.find(project => projectPathKey(project.path) === projectPath);
    if (byPath) { return byPath; }
  }
  return session.projectName
    ? registeredProjects.find(project => project.name === session.projectName)
    : undefined;
}

function projectPathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}

function acknowledgedEventKeys(events: readonly MonitorEvent[]): Set<string> {
  const acknowledged = new Set<string>();
  for (const event of events) {
    if (event.type !== 'notification.acknowledged') { continue; }
    const acknowledgedEventId = event.metadata?.['acknowledgedEventId'];
    if (typeof acknowledgedEventId === 'string' && acknowledgedEventId) {
      acknowledged.add(attentionEventKey(event.sessionId, acknowledgedEventId));
    }
  }
  return acknowledged;
}

function attentionEventKey(sessionId: string, eventId: string): string {
  return `${sessionId}:${eventId}`;
}
