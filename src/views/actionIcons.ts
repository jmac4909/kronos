import * as vscode from 'vscode';

export interface ActionThemeIcon {
  id: string;
  color?: vscode.ThemeColor;
}

export function ticketActionIcon(action: string): ActionThemeIcon {
  switch (action) {
    case 'implement': return { id: 'circle-outline', color: new vscode.ThemeColor('disabledForeground') };
    case 'in_progress': return { id: 'tools', color: new vscode.ThemeColor('charts.blue') };
    case 'await_review': return { id: 'git-pull-request', color: new vscode.ThemeColor('charts.yellow') };
    case 'deploy_monitor': return { id: 'rocket', color: new vscode.ThemeColor('charts.blue') };
    case 'fix_build': return { id: 'flame', color: new vscode.ThemeColor('testing.iconFailed') };
    case 'verify': return { id: 'beaker', color: new vscode.ThemeColor('charts.purple') };
    case 'blocked': return { id: 'lock', color: new vscode.ThemeColor('testing.iconFailed') };
    case 'done': return { id: 'pass', color: new vscode.ThemeColor('testing.iconPassed') };
    default: return { id: 'circle-outline', color: new vscode.ThemeColor('disabledForeground') };
  }
}

export function queueActionIcon(action: string): ActionThemeIcon {
  switch (action) {
    case 'implement': return { id: 'play-circle', color: new vscode.ThemeColor('charts.green') };
    case 'in_progress': return { id: 'tools', color: new vscode.ThemeColor('charts.blue') };
    case 'await_review': return { id: 'git-pull-request', color: new vscode.ThemeColor('charts.yellow') };
    case 'deploy_monitor': return { id: 'rocket', color: new vscode.ThemeColor('charts.blue') };
    case 'verify': return { id: 'beaker', color: new vscode.ThemeColor('charts.purple') };
    case 'fix_build': return { id: 'flame', color: new vscode.ThemeColor('testing.iconFailed') };
    case 'blocked': return { id: 'lock', color: new vscode.ThemeColor('testing.iconFailed') };
    case 'done': return { id: 'pass', color: new vscode.ThemeColor('testing.iconPassed') };
    case 'refresh': return { id: 'refresh' };
    default: return { id: 'circle-outline' };
  }
}

export function themeIcon(icon: ActionThemeIcon): vscode.ThemeIcon {
  return new vscode.ThemeIcon(icon.id, icon.color);
}
