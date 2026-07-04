import { WEBVIEW_READY_COMMAND } from './webviewSecurity';

export interface WebviewDisposeTarget {
  onDidDispose(listener: () => void): unknown;
}

export interface WebviewReadyMonitor {
  (raw: unknown): boolean;
  arm(): void;
}

export function createWebviewReadyMonitor(panel: WebviewDisposeTarget, webviewName: string, timeoutMs = 5000): WebviewReadyMonitor {
  let reportedReady = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const arm = (): void => {
    if (disposed) { return; }
    reportedReady = false;
    clearTimer();
    timer = setTimeout(() => {
      if (reportedReady) { return; }
      console.warn(`Kronos webview script did not report ready: ${webviewName}. Check VS Code Webview Developer Tools and the Extension Host DevTools console for CSP or sandbox errors.`);
    }, timeoutMs);
  };
  const monitor = ((raw: unknown): boolean => {
    if (!logWebviewReadyMessage(raw, webviewName)) { return false; }
    reportedReady = true;
    clearTimer();
    return true;
  }) as WebviewReadyMonitor;
  monitor.arm = arm;
  panel.onDidDispose(() => {
    disposed = true;
    clearTimer();
  });
  return monitor;
}

function logWebviewReadyMessage(raw: unknown, fallbackWebviewName = 'Kronos webview'): boolean {
  if (!raw || typeof raw !== 'object') { return false; }
  const message = raw as { command?: unknown; webviewName?: unknown; readyState?: unknown; userAgent?: unknown };
  if (message.command !== WEBVIEW_READY_COMMAND) { return false; }
  const reportedName = typeof message.webviewName === 'string' ? message.webviewName.trim() : '';
  const webviewName = reportedName && reportedName !== 'Kronos action panel'
    ? reportedName
    : fallbackWebviewName;
  const readyState = typeof message.readyState === 'string' ? message.readyState : 'unknown';
  const userAgent = typeof message.userAgent === 'string' && message.userAgent.trim()
    ? `; ${message.userAgent.trim()}`
    : '';
  console.info(`Kronos webview script ready: ${webviewName} (${readyState}${userAgent})`);
  return true;
}
