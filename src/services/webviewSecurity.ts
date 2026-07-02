import { randomBytes } from 'crypto';

export interface WebviewCspOptions {
  nonce?: string;
  allowScripts?: boolean;
  cspSource?: string;
  imgSrc?: string[];
}

export function createWebviewNonce(): string {
  return randomBytes(16).toString('hex');
}

export function webviewVsCodeApiScript(): string {
  return [
    'function kronosFallbackVsCodeApi() {',
    "  return { postMessage: function(message) { console.warn('VS Code API unavailable for Kronos webview action', message); } };",
    '}',
    'function kronosAcquireVsCodeApi() {',
    '  if (window.__kronosVscodeApi) { return window.__kronosVscodeApi; }',
    "  if (typeof acquireVsCodeApi !== 'function') {",
    '    window.__kronosVscodeApi = kronosFallbackVsCodeApi();',
    '    return window.__kronosVscodeApi;',
    '  }',
    '  try {',
    '    window.__kronosVscodeApi = acquireVsCodeApi();',
    '  } catch (error) {',
    "    console.error('Failed to acquire VS Code API for Kronos webview action', error);",
    '    window.__kronosVscodeApi = kronosFallbackVsCodeApi();',
    '  }',
    '  return window.__kronosVscodeApi;',
    '}',
    'var vscode = kronosAcquireVsCodeApi();',
  ].join('\n');
}

export function webviewCspMeta(options: WebviewCspOptions = {}): string {
  const cspSource = options.cspSource ? `${options.cspSource} ` : '';
  const scriptSrc = options.allowScripts
    ? options.nonce ? `'nonce-${options.nonce}'` : cspSource.trim() || "'none'"
    : "'none'";
  const styleSrc = `${cspSource}'unsafe-inline'`.trim();
  const imgSrc = options.imgSrc?.length ? ` img-src ${options.imgSrc.join(' ')};` : '';
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${styleSrc}; script-src ${scriptSrc};${imgSrc}">`;
}

export function withWebviewCsp(html: string, options: WebviewCspOptions = {}): string {
  if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) {
    return html;
  }
  const meta = webviewCspMeta(options);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, match => `${match}\n${meta}`);
  }
  return html.replace(/<html[^>]*>/i, match => `${match}<head>\n${meta}\n</head>`);
}
