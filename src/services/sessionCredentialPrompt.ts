import { normalizeGitLabApiBaseUrl } from './gitlabRestClient';

export interface SessionCredentialCommandPromptOptions {
  projectName?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
}

interface CredentialCommandBlock {
  title: string;
  command: string;
}

const CREDENTIAL_REDACTION = '[REDACTED_CREDENTIAL]';

export function buildSessionCredentialCommandPrompt(options: SessionCredentialCommandPromptOptions = {}): string | undefined {
  const env = options.env || process.env;
  const projectPrefix = projectEnvPrefix(options.projectName);
  const blocks = [
    sonarCredentialCommandBlock(env),
    environmentCurlCommandBlock('DEV', projectPrefix, env),
    environmentCurlCommandBlock('TEST', projectPrefix, env),
    gitLabMergeRequestCommandBlock(env),
  ].filter((block): block is CredentialCommandBlock => Boolean(block));
  if (blocks.length === 0) { return undefined; }
  return [
    'Kronos resolved credential commands:',
    'The extension resolved these values before launch because sessions must not read .env files and shell expansion may not expose credentials loaded from .env.',
    'Use these exact command or header fragments only when needed. Do not print, inspect, transform, save, or include credential values in reports, evidence, commits, merge request comments, tickets, or helper files.',
    ...blocks.flatMap(block => [
      '',
      `${block.title}:`,
      ...fencedCodeBlock('bash', block.command),
    ]),
  ].join('\n');
}

export function redactCredentialValues(text: string, env: Record<string, string | undefined> = process.env): string {
  let redacted = text;
  for (const secret of credentialRedactionValues(env)) {
    redacted = replaceAllLiteral(redacted, secret, CREDENTIAL_REDACTION);
  }
  return redacted;
}

function sonarCredentialCommandBlock(env: Record<string, string | undefined>): CredentialCommandBlock | undefined {
  const host = normalizeHttpUrl(firstNonEmpty(env['SONAR_HOST_URL']));
  const token = firstNonEmpty(env['SONAR_TOKEN']);
  if (!host || !token) { return undefined; }
  return {
    title: 'SonarQube scan command',
    command: `mvn sonar:sonar -Dsonar.host.url=${shellSingleQuote(host)} -Dsonar.token=${shellSingleQuote(token)}`,
  };
}

function gitLabMergeRequestCommandBlock(env: Record<string, string | undefined>): CredentialCommandBlock | undefined {
  const token = firstNonEmpty(env['GITLAB_TOKEN']);
  if (!token) { return undefined; }
  const apiBaseUrl = normalizeGitLabApiBaseUrl(firstNonEmpty(
    env['GITLAB_API_BASE_URL'],
    env['GITLAB_BASE_URL'],
    env['GITLAB_URL'],
    env['GITLAB_HOST'],
  ));
  const header = `--header ${shellSingleQuote(`PRIVATE-TOKEN: ${token}`)}`;
  if (!apiBaseUrl) {
    return {
      title: 'GitLab API token header for merge request creation',
      command: header,
    };
  }
  return {
    title: 'GitLab merge request creation command template',
    command: [
      `curl --request POST ${shellSingleQuote(`${apiBaseUrl}/projects/<project_id_or_urlencoded_path>/merge_requests`)}`,
      `  ${header}`,
      `  --form ${shellSingleQuote('source_branch=<source_branch>')}`,
      `  --form ${shellSingleQuote('target_branch=<target_branch>')}`,
      `  --form ${shellSingleQuote('title=<merge_request_title>')}`,
    ].join(' \\\n'),
  };
}

function environmentCurlCommandBlock(
  kind: 'DEV' | 'TEST',
  projectPrefix: string,
  env: Record<string, string | undefined>,
): CredentialCommandBlock | undefined {
  const header = environmentCurlHeader(kind, projectPrefix, env);
  if (!header) { return undefined; }
  const url = environmentUrl(kind, projectPrefix, env);
  const command = url
    ? `curl -i ${shellSingleQuote(url)} \\\n  ${header}`
    : header;
  return {
    title: url ? `${kind} replay curl command template` : `${kind} curl auth header`,
    command,
  };
}

function environmentCurlHeader(kind: 'DEV' | 'TEST', projectPrefix: string, env: Record<string, string | undefined>): string | undefined {
  const explicitHeader = firstNonEmpty(...scopedEnvValues(projectPrefix, kind, [
    'CURL_AUTH_HEADER',
    'AUTH_HEADER',
  ], env));
  const normalizedExplicitHeader = normalizeHeaderValue(explicitHeader);
  if (normalizedExplicitHeader) {
    return `-H ${shellSingleQuote(normalizedExplicitHeader)}`;
  }
  const bearerToken = firstNonEmpty(...scopedEnvValues(projectPrefix, kind, [
    'BEARER_TOKEN',
    'ACCESS_TOKEN',
    'API_TOKEN',
    'TOKEN',
  ], env));
  if (bearerToken) {
    return `-H ${shellSingleQuote(`Authorization: Bearer ${bearerToken}`)}`;
  }
  const apiKey = firstNonEmpty(...scopedEnvValues(projectPrefix, kind, ['API_KEY'], env));
  if (apiKey) {
    return `-H ${shellSingleQuote(`x-api-key: ${apiKey}`)}`;
  }
  return undefined;
}

function environmentUrl(kind: 'DEV' | 'TEST', projectPrefix: string, env: Record<string, string | undefined>): string | undefined {
  return normalizeHttpUrl(firstNonEmpty(
    projectPrefix ? env[`${projectPrefix}_${kind}_URL`] : undefined,
    env[`${kind}_BASE_URL`],
    env[`${kind}_URL`],
  ));
}

function scopedEnvValues(
  projectPrefix: string,
  kind: 'DEV' | 'TEST',
  suffixes: string[],
  env: Record<string, string | undefined>,
): Array<string | undefined> {
  return suffixes.flatMap(suffix => [
    projectPrefix ? env[`${projectPrefix}_${kind}_${suffix}`] : undefined,
    env[`${kind}_${suffix}`],
  ]);
}

function normalizeHeaderValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) { return undefined; }
  const unwrapped = trimmed
    .replace(/^--header\s+/i, '')
    .replace(/^-H\s+/i, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
  return /^[A-Za-z0-9-]+:\s*\S/.test(unwrapped) ? unwrapped : undefined;
}

function projectEnvPrefix(projectName: string | undefined): string {
  return String(projectName || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeHttpUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) { return undefined; }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { return undefined; }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) { return trimmed; }
  }
  return undefined;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function fencedCodeBlock(language: string, content: string): string[] {
  return [`\`\`\`${language}`, content, '```'];
}

function credentialRedactionValues(env: Record<string, string | undefined>): string[] {
  const values = Object.entries(env)
    .filter(([key]) => credentialEnvKey(key))
    .flatMap(([, value]) => credentialRedactionVariants(value));
  return [...new Set(values)]
    .filter(value => value.length >= 6)
    .sort((a, b) => b.length - a.length);
}

function credentialEnvKey(key: string): boolean {
  return /(?:TOKEN|PASSWORD|PASSCODE|SECRET|PRIVATE_KEY|API_KEY|AUTH_HEADER|AUTHORIZATION)/i.test(key);
}

function credentialRedactionVariants(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed) { return []; }
  const variants = [trimmed, shellSingleQuote(trimmed)];
  const headerValue = /^[A-Za-z0-9-]+:\s*(.+)$/.exec(normalizeHeaderValue(trimmed) || trimmed)?.[1]?.trim();
  if (headerValue) {
    variants.push(headerValue, shellSingleQuote(headerValue));
  }
  const bearerValue = /\bBearer\s+(.+)$/i.exec(trimmed)?.[1]?.trim();
  if (bearerValue) {
    variants.push(bearerValue, shellSingleQuote(bearerValue));
  }
  return variants;
}

function replaceAllLiteral(value: string, search: string, replacement: string): string {
  return value.split(search).join(replacement);
}
