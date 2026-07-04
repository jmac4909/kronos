import { readIntegrationManifest, type IntegrationManifest } from './integrationManifest';
import {
  buildDefaultPromptSmokeTests,
  listPromptTemplates,
  type PromptSmokeTest,
  type PromptTemplateInfo,
} from './promptManager';

interface PromptWorkspaceProject {
  path?: string;
}

type PromptWorkspaceProjects = Record<string, PromptWorkspaceProject | undefined>;

export interface PromptProjectOverride {
  project: string;
  template: PromptTemplateInfo;
}

export interface PromptWorkspaceModel {
  globalTemplates: PromptTemplateInfo[];
  projectOverrides: PromptProjectOverride[];
  smokeTests: PromptSmokeTest[];
}

export function buildPromptWorkspaceModel(projects: PromptWorkspaceProjects = {}): PromptWorkspaceModel {
  const globalTemplates = listPromptTemplates();
  const projectOverrides = collectPromptProjectOverrides(projects);
  return {
    globalTemplates,
    projectOverrides,
    smokeTests: buildPromptSmokeTestsForWorkspace(projects, globalTemplates, projectOverrides),
  };
}

export function collectPromptProjectOverrides(projects: PromptWorkspaceProjects = {}): PromptProjectOverride[] {
  const overrides: PromptProjectOverride[] = [];
  for (const [projectName, project] of Object.entries(projects)) {
    if (!project?.path) { continue; }
    for (const template of listPromptTemplates(project.path).filter(t => t.source === 'project')) {
      overrides.push({ project: projectName, template });
    }
  }
  return overrides.sort((a, b) => `${a.project}:${a.template.name}:${a.template.path}`.localeCompare(`${b.project}:${b.template.name}:${b.template.path}`));
}

export function promptHistoryTemplatesForProjects(projects: PromptWorkspaceProjects = {}): PromptTemplateInfo[] {
  const byKey = new Map<string, PromptTemplateInfo>();
  for (const template of listPromptTemplates()) {
    byKey.set(promptTemplateKey(template), template);
  }
  for (const { template } of collectPromptProjectOverrides(projects)) {
    byKey.set(promptTemplateKey(template), template);
  }
  return Array.from(byKey.values()).sort((a, b) => promptTemplateKey(a).localeCompare(promptTemplateKey(b)));
}

export function buildPromptSmokeTestsForWorkspace(
  projects: PromptWorkspaceProjects,
  globalTemplates: PromptTemplateInfo[],
  projectOverrides: PromptProjectOverride[],
  manifest: IntegrationManifest | undefined = readIntegrationManifest().manifest,
): PromptSmokeTest[] {
  const tests = buildDefaultPromptSmokeTests(globalTemplates, { idPrefix: 'global' });
  for (const { project, template } of projectOverrides) {
    const projectPath = projects[project]?.path;
    if (projectPath) {
      tests.push(...buildDefaultPromptSmokeTests([template], { idPrefix: `project:${project}`, projectPath }));
    }
  }

  for (const [templateName, entry] of Object.entries(manifest?.prompts || {})) {
    for (const [idx, smoke] of (entry.smoke_tests || []).entries()) {
      const test: PromptSmokeTest = {
        id: `manifest:${templateName}:${smoke.name || idx + 1}`,
        templateName,
        source: 'manifest',
      };
      if (smoke.variables) { test.variables = smoke.variables; }
      if (smoke.mustContain) { test.mustContain = smoke.mustContain; }
      if (smoke.mustNotContain) { test.mustNotContain = smoke.mustNotContain; }
      if (smoke.allowMissingVariables !== undefined) { test.allowMissingVariables = smoke.allowMissingVariables; }
      tests.push(test);
    }
  }
  return tests;
}

function promptTemplateKey(template: PromptTemplateInfo): string {
  return `${template.source}:${template.name}:${template.path}`;
}
