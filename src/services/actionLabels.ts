export function actionToLabel(action: string): string {
  switch (action) {
    case 'implement': return 'To Do';
    case 'in_progress': return 'In Progress';
    case 'await_review': return 'Review';
    case 'deploy_monitor': return 'Deploying';
    case 'verify': return 'QA';
    case 'fix_build': return 'Build Failed';
    case 'blocked': return 'Blocked';
    case 'done': return 'Done';
    case 'refresh': return 'Refresh';
    default: return action.replace(/_/g, ' ');
  }
}
