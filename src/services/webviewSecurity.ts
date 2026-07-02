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

export function webviewVsCodeApiScript(webviewName = 'Kronos webview'): string {
  const nameLiteral = JSON.stringify(webviewName) || '"Kronos webview"';
  return [
    'const vscode = (function() {',
    '  function kronosFallbackVsCodeApi() {',
    "    return { postMessage: function(message) { console.warn('VS Code API unavailable for Kronos webview action', message); } };",
    '  }',
    "  if (typeof acquireVsCodeApi !== 'function') {",
    '    return kronosFallbackVsCodeApi();',
    '  }',
    '  try {',
    '    return acquireVsCodeApi();',
    '  } catch (error) {',
    "    console.error('Failed to acquire VS Code API for Kronos webview action', error);",
    '    return kronosFallbackVsCodeApi();',
    '  }',
    '}());',
    '(function() {',
    `  const webviewName = ${nameLiteral};`,
    '  function kronosErrorText(value) {',
    '    if (value && typeof value === \'object\' && \'message\' in value) { return String(value.message || value); }',
    '    return String(value || \'unknown error\');',
    '  }',
    '  try {',
    "    document.documentElement.setAttribute('data-kronos-script-ready', 'true');",
    "    document.documentElement.setAttribute('data-kronos-webview', webviewName);",
    '  } catch (error) {',
    "    console.warn('Kronos webview could not mark script readiness', error);",
    '  }',
    "  console.info('Kronos webview script ready', webviewName, navigator.userAgent);",
    "  window.addEventListener('error', function(event) {",
    "    console.error('Kronos webview script error', webviewName, event.message, event.filename, event.lineno, event.colno);",
    '  });',
    "  window.addEventListener('unhandledrejection', function(event) {",
    "    console.error('Kronos webview unhandled rejection', webviewName, kronosErrorText(event.reason));",
    '  });',
    '}());',
  ].join('\n');
}

export function webviewCspMeta(options: WebviewCspOptions = {}): string {
  const cspSource = options.cspSource?.trim();
  const scriptSources = [
    cspSource,
    options.nonce ? `'nonce-${options.nonce}'` : undefined,
  ].filter((source): source is string => Boolean(source));
  const scriptSrc = options.allowScripts && scriptSources.length > 0
    ? scriptSources.join(' ')
    : "'none'";
  const styleSrc = [
    cspSource,
    "'unsafe-inline'",
  ].filter((source): source is string => Boolean(source)).join(' ');
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
