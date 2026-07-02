import * as vscode from 'vscode';
import { KronosState } from '../state/KronosState';
import { AdhocTask } from '../state/types';

export class TaskTreeProvider implements vscode.TreeDataProvider<TaskTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private kronosState: KronosState) {
    kronosState.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  getTreeItem(element: TaskTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): TaskTreeItem[] {
    const state = this.kronosState.state;
    if (!state || Object.keys(state.adhoc_tasks).length === 0) {
      const empty = new TaskTreeItem('No tasks — click + to add', '', {
        title: '',
        description: '',
        status: 'todo',
        projects: [],
        created_at: '',
      });
      return [empty];
    }

    return Object.entries(state.adhoc_tasks).map(
      ([id, task]) => new TaskTreeItem(task.title, id, task)
    );
  }
}

class TaskTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly taskId: string,
    task: AdhocTask
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);

    if (!taskId) { return; }

    const isDone = task.status === 'done';
    this.contextValue = isDone ? 'adhoc_done' : 'adhoc_todo';
    this.description = task.description || undefined;
    this.tooltip = `Status: ${task.status}\nCreated: ${task.created_at}`;

    this.iconPath = new vscode.ThemeIcon(
      isDone ? 'check' : 'circle-outline',
      isDone ? new vscode.ThemeColor('testing.iconPassed') : undefined
    );
  }
}
