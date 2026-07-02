import * as vscode from 'vscode';
import { KronosState } from '../state/KronosState';
import { QueueItem } from '../state/types';
import { actionToLabel } from '../services/actionLabels';
import { queueActionIcon, themeIcon } from './actionIcons';

export class QueueTreeProvider implements vscode.TreeDataProvider<QueueTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<QueueTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private kronosState: KronosState) {
    kronosState.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  getTreeItem(element: QueueTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): QueueTreeItem[] {
    const queue = this.kronosState.queue;
    if (!queue || queue.items.length === 0) {
      const empty = new QueueTreeItem({
        id: '', projects: [], project_path: '', ticket: null,
        action: '', priority_score: 0, reason: '',
      }, 0);
      empty.label = 'Queue empty — click refresh';
      empty.iconPath = new vscode.ThemeIcon('info');
      empty.command = { command: 'kronos.refresh', title: 'Refresh' };
      empty.contextValue = undefined;
      return [empty];
    }

    return queue.items.map((item, idx) => new QueueTreeItem(item, idx));
  }
}

export class QueueTreeItem extends vscode.TreeItem {
  public readonly item: QueueItem;
  public readonly index: number;

  constructor(item: QueueItem, index: number) {
    const ticketPart = item.ticket || 'refresh';
    const summaryPart = item.ticket_summary ? ` — ${item.ticket_summary}` : '';
    super(item.action ? `${ticketPart}${summaryPart}` : '', vscode.TreeItemCollapsibleState.None);

    this.item = item;
    this.index = index;

    if (!item.action) { return; }

    this.contextValue = 'queue_item';
    const actionLabel = actionToLabel(item.action);
    const projs = (item.projects || []).join(', ') || 'unlinked';
    this.description = `${projs} · [${actionLabel}] ${item.priority_score}`;

    this.tooltip = new vscode.MarkdownString(
      `**${(item.projects || []).join(', ')} / ${item.ticket || 'refresh'}**${summaryPart}\n\n` +
      `Action: ${actionLabel}\n\n` +
      `Score: ${item.priority_score}\n\n` +
      `${item.reason}\n\n` +
      `_Click to start · Right-click to reorder_`
    );

    this.command = {
      command: 'kronos.startQueueItem',
      title: 'Start',
      arguments: [item],
    };

    this.iconPath = themeIcon(queueActionIcon(item.action));
  }
}
