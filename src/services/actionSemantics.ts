const CODE_ACTIONS = new Set(['implement', 'in_progress', 'fix_build']);
const PROOF_SENSITIVE_ACTIONS = new Set(['await_review', 'verify', 'deploy_monitor', 'done']);

export function isCodeAction(action: string | null | undefined): boolean {
  return Boolean(action && CODE_ACTIONS.has(action));
}

export function isProofSensitiveAction(action: string | null | undefined): boolean {
  return Boolean(action && PROOF_SENSITIVE_ACTIONS.has(action));
}

export function isReviewReadyAction(action: string | null | undefined): boolean {
  return isProofSensitiveAction(action);
}

export function isHandoffAction(action: string | null | undefined): boolean {
  return isProofSensitiveAction(action);
}
