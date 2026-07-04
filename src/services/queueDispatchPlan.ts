export interface QueueDispatchTarget {
  projectName?: string | undefined;
  projectPath: string;
}

export interface QueueDispatchPlan {
  projects: string[];
  directProjectPath?: string | undefined;
  projectLabel: string;
  dispatchTargets: QueueDispatchTarget[];
  missingProjects: string[];
}

export interface QueueDispatchCollisionTarget {
  ticketKey?: string | null;
  projects: string[];
  action: string;
  excludeQueueItemId?: string;
}

export function buildQueueDispatchPlan(input: {
  projects?: string[];
  projectPath?: string | undefined;
  pathProject?: string | undefined;
  resolveProjectPath: (projectName: string) => string | undefined;
}): QueueDispatchPlan {
  const projects = (input.projects || []).length > 0
    ? input.projects || []
    : input.pathProject
      ? [input.pathProject]
      : [];
  const directProjectPath = projects.length === 0 ? input.projectPath : undefined;
  const dispatchTargets: QueueDispatchTarget[] = [];
  const missingProjects: string[] = [];

  for (const projectName of projects) {
    const projectPath = input.resolveProjectPath(projectName);
    if (projectPath) {
      dispatchTargets.push({ projectName, projectPath });
    } else {
      missingProjects.push(projectName);
    }
  }
  if (dispatchTargets.length === 0 && directProjectPath) {
    dispatchTargets.push({ projectPath: directProjectPath });
  }

  return {
    projects,
    directProjectPath,
    projectLabel: projects.join(', ') || directProjectPath || 'unlinked',
    dispatchTargets,
    missingProjects,
  };
}

export function queueDispatchMissingProjectMessage(input: { target?: string | null | undefined; missingProjects: string[] }): string {
  const target = input.target || 'queue item';
  return `Cannot start ${target}; linked project ${input.missingProjects.join(', ')} is not registered.`;
}

export function queueDispatchNoProjectPathMessage(ticket?: string | null): string {
  return `Cannot start ${ticket || 'queue item'}; no project path was found.`;
}

export function buildQueueDispatchCollisionTarget(input: {
  ticket?: string | null | undefined;
  id?: string | undefined;
  projects: string[];
  action: string;
}): QueueDispatchCollisionTarget {
  const target: QueueDispatchCollisionTarget = {
    projects: input.projects,
    action: input.action,
  };
  if (input.ticket) { target.ticketKey = input.ticket; }
  if (input.id) { target.excludeQueueItemId = input.id; }
  return target;
}

export function buildQueueDispatchExtraPrompt(extra: string): string {
  return extra ? `\n\nADDITIONAL CONTEXT FROM USER: ${extra}` : '';
}

export function buildQueueDispatchScopeHint(target: QueueDispatchTarget, projects: string[]): string {
  const otherProjects = target.projectName ? projects.filter(project => project !== target.projectName) : [];
  if (otherProjects.length === 0) { return ''; }
  const projectLabel = target.projectName || target.projectPath;
  return `\nYou are working in ${projectLabel}. Focus ONLY on this codebase. Other projects: ${otherProjects.join(', ')}.`;
}

export function buildQueueDispatchAppendPrompt(input: {
  codeAction: boolean;
  implementPrompt: string;
  scopeHint?: string;
  extraPrompt?: string;
}): string | undefined {
  const extraPrompt = input.extraPrompt || '';
  if (input.codeAction) {
    return input.implementPrompt + (input.scopeHint || '') + extraPrompt;
  }
  return extraPrompt || undefined;
}
