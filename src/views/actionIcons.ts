import * as vscode from 'vscode';
import { queueActionIconSpec, ticketActionIconSpec } from '../services/actionCatalog';

interface ActionThemeIcon {
  id: string;
  color?: vscode.ThemeColor;
}

interface ActionIconSpec {
  id: string;
  color?: string;
}

export function ticketActionIcon(action: string): ActionThemeIcon {
  return actionIcon(ticketActionIconSpec(action) || { id: 'circle-outline', color: 'disabledForeground' });
}

export function queueActionIcon(action: string): ActionThemeIcon {
  return actionIcon(queueActionIconSpec(action) || { id: 'circle-outline' });
}

export function themeIcon(icon: ActionThemeIcon): vscode.ThemeIcon {
  return new vscode.ThemeIcon(icon.id, icon.color);
}

function actionIcon(spec: ActionIconSpec): ActionThemeIcon {
  return spec.color
    ? { id: spec.id, color: new vscode.ThemeColor(spec.color) }
    : { id: spec.id };
}
