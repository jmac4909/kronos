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
