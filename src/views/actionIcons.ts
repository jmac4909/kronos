import * as vscode from 'vscode';
import { queueActionIconSpec, ticketActionIconSpec } from '../services/actionCatalog';

interface ActionIconSpec {
  id: string;
  color?: string;
}

export function ticketActionIcon(action: string): vscode.ThemeIcon {
  return actionIcon(ticketActionIconSpec(action) || { id: 'circle-outline', color: 'disabledForeground' });
}

export function queueActionIcon(action: string): vscode.ThemeIcon {
  return actionIcon(queueActionIconSpec(action) || { id: 'circle-outline' });
}

function actionIcon(spec: ActionIconSpec): vscode.ThemeIcon {
  return spec.color
    ? new vscode.ThemeIcon(spec.id, new vscode.ThemeColor(spec.color))
    : new vscode.ThemeIcon(spec.id);
}
