import * as vscode from 'vscode';

interface ActionThemeIcon {
  id: string;
  color?: vscode.ThemeColor;
}

interface ActionIconSpec {
  id: string;
  color?: string;
}

const SHARED_ACTION_ICON_SPECS: Record<string, ActionIconSpec> = {
  in_progress: { id: 'tools', color: 'charts.blue' },
  await_review: { id: 'git-pull-request', color: 'charts.yellow' },
  deploy_monitor: { id: 'rocket', color: 'charts.blue' },
  fix_build: { id: 'flame', color: 'testing.iconFailed' },
  verify: { id: 'beaker', color: 'charts.purple' },
  blocked: { id: 'lock', color: 'testing.iconFailed' },
  done: { id: 'pass', color: 'testing.iconPassed' },
};

export function ticketActionIcon(action: string): ActionThemeIcon {
  if (action === 'implement') {
    return actionIcon({ id: 'circle-outline', color: 'disabledForeground' });
  }
  return actionIcon(SHARED_ACTION_ICON_SPECS[action] || { id: 'circle-outline', color: 'disabledForeground' });
}

export function queueActionIcon(action: string): ActionThemeIcon {
  if (action === 'implement') {
    return actionIcon({ id: 'play-circle', color: 'charts.green' });
  }
  if (action === 'refresh') {
    return actionIcon({ id: 'refresh' });
  }
  return actionIcon(SHARED_ACTION_ICON_SPECS[action] || { id: 'circle-outline' });
}

export function themeIcon(icon: ActionThemeIcon): vscode.ThemeIcon {
  return new vscode.ThemeIcon(icon.id, icon.color);
}

function actionIcon(spec: ActionIconSpec): ActionThemeIcon {
  return spec.color
    ? { id: spec.id, color: new vscode.ThemeColor(spec.color) }
    : { id: spec.id };
}
