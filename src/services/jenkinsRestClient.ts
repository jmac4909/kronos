import * as http from 'http';
import * as https from 'https';
import { unknownErrorMessage } from './errorUtils';
import { parseJsonWithLabel } from './jsonFiles';
import { isRecord, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown } from './records';

export interface JenkinsRestRequestOptions {
  timeoutMs?: number;
}

export interface JenkinsHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

export interface JenkinsHttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

export type JenkinsHttpTransport = (request: JenkinsHttpRequest) => Promise<JenkinsHttpResponse>;

export interface JenkinsRestClientOptions {
  env?: NodeJS.ProcessEnv;
  transport?: JenkinsHttpTransport;
}

export interface JenkinsBuildSummary {
  number: number;
  status: string;
  url: string;
  building?: boolean;
}

export interface JenkinsBuildTriggerResult {
  queued: boolean;
  statusCode: number;
  queueUrl?: string;
}

interface JenkinsRestConfig {
  baseUrl?: string;
  username?: string;
  token?: string;
}

const DEFAULT_TIMEOUT_MS = 15000;

export class JenkinsRestClient {
  private readonly env: NodeJS.ProcessEnv;
  private readonly transport: JenkinsHttpTransport;

  constructor(options: JenkinsRestClientOptions = {}) {
    this.env = options.env || process.env;
    this.transport = options.transport || defaultJenkinsTransport;
  }

  async buildStatus(jobUrl: string, options: JenkinsRestRequestOptions = {}): Promise<JenkinsBuildSummary | null> {
    const normalizedJobUrl = normalizeJenkinsJobUrl(jobUrl, resolveJenkinsRestConfig(this.env).baseUrl);
    if (!normalizedJobUrl) { return null; }
    const tree = 'lastBuild[number,result,building,url,timestamp,duration],lastCompletedBuild[number,result,building,url,timestamp,duration],number,result,building,url,timestamp,duration';
    const response = await this.requestJson(normalizedJobUrl, 'GET', 'Jenkins build status', { tree }, options);
    const record = isRecord(response.value) ? response.value : {};
    const candidate = firstRecord(record['lastBuild'], record['lastCompletedBuild'], record);
    return candidate ? normalizeJenkinsBuild(candidate, normalizedJobUrl) : null;
  }

  async triggerBuild(
    jobUrl: string,
    parameters: Record<string, string | number | boolean> = {},
    options: JenkinsRestRequestOptions = {},
  ): Promise<JenkinsBuildTriggerResult> {
    const normalizedJobUrl = normalizeJenkinsJobUrl(jobUrl, resolveJenkinsRestConfig(this.env).baseUrl);
    if (!normalizedJobUrl) {
      throw new JenkinsRestError('Jenkins job URL is missing or invalid.');
    }
    const hasParameters = Object.keys(parameters).length > 0;
    const response = await this.requestRaw(
      normalizedJobUrl,
      'POST',
      hasParameters ? 'Jenkins buildWithParameters trigger' : 'Jenkins build trigger',
      hasParameters ? parameters : {},
      options,
      hasParameters ? 'buildWithParameters' : 'build',
    );
    if (response.statusCode < 200 || response.statusCode >= 400) {
      throw new JenkinsRestError(`Jenkins build trigger failed with HTTP ${response.statusCode}${responsePreview(response.body)}`);
    }
    const location = headerString(response.headers, 'location');
    return {
      queued: true,
      statusCode: response.statusCode,
      ...(location ? { queueUrl: location } : {}),
    };
  }

  private async requestJson(
    jobUrl: string,
    method: JenkinsHttpRequest['method'],
    label: string,
    query: Record<string, string | number | boolean> = {},
    options: JenkinsRestRequestOptions = {},
    suffix = 'api/json',
  ): Promise<{ value: unknown; headers: Record<string, string | string[] | undefined> }> {
    const response = await this.requestRaw(jobUrl, method, label, query, options, suffix);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new JenkinsRestError(`Jenkins REST ${label} failed with HTTP ${response.statusCode}${responsePreview(response.body)}`);
    }
    return {
      value: parseJsonWithLabel(response.body, label, { includePreview: true }),
      headers: response.headers,
    };
  }

  private async requestRaw(
    jobUrl: string,
    method: JenkinsHttpRequest['method'],
    label: string,
    query: Record<string, string | number | boolean> = {},
    options: JenkinsRestRequestOptions = {},
    suffix = '',
  ): Promise<JenkinsHttpResponse> {
    const config = resolveJenkinsRestConfig(this.env);
    const url = buildJenkinsUrl(jobUrl, suffix, query);
    const response = await this.transport({
      method,
      url,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      headers: jenkinsHeaders(config),
    });
    if (response.statusCode === 401 || response.statusCode === 403) {
      throw new JenkinsRestError(`Jenkins REST ${label} failed with HTTP ${response.statusCode}. Check Jenkins credentials; values are not displayed.`);
    }
    return response;
  }
}

export function createJenkinsRestClient(options: JenkinsRestClientOptions = {}): JenkinsRestClient {
  return new JenkinsRestClient(options);
}

export const jenkinsRestClient = createJenkinsRestClient();

export function normalizeJenkinsJobUrl(value: string | undefined, baseUrl?: string): string | undefined {
  const trimmed = optionalTrimmedStringFromUnknown(value);
  if (!trimmed) { return undefined; }
  const normalizedBase = normalizeJenkinsBaseUrl(baseUrl);
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : normalizedBase
      ? new URL(trimmed, `${normalizedBase}/`).toString()
      : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { return undefined; }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function normalizeJenkinsBaseUrl(value: string | undefined): string | undefined {
  const trimmed = optionalTrimmedStringFromUnknown(value);
  if (!trimmed) { return undefined; }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { return undefined; }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function isJenkinsRestConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(normalizeJenkinsBaseUrl(env['JENKINS_URL']));
}

function resolveJenkinsRestConfig(env: NodeJS.ProcessEnv): JenkinsRestConfig {
  const config: JenkinsRestConfig = {};
  const baseUrl = normalizeJenkinsBaseUrl(env['JENKINS_URL']);
  const username = firstNonEmpty(env['JENKINS_USER'], env['JENKINS_USERNAME']);
  const token = firstNonEmpty(env['JENKINS_API_TOKEN'], env['JENKINS_TOKEN']);
  if (baseUrl) { config.baseUrl = baseUrl; }
  if (username) { config.username = username; }
  if (token) { config.token = token; }
  return config;
}

function normalizeJenkinsBuild(record: Record<string, unknown>, fallbackUrl: string): JenkinsBuildSummary | null {
  const number = optionalFiniteNumberFromUnknown(record['number']);
  if (number === undefined || number < 0) { return null; }
  const building = record['building'] === true;
  const status = optionalTrimmedStringFromUnknown(firstDefined(record['result'], record['status']))
    || (building ? 'BUILDING' : 'UNKNOWN');
  const url = optionalTrimmedStringFromUnknown(record['url']) || fallbackUrl;
  const summary: JenkinsBuildSummary = {
    number: Math.floor(number),
    status,
    url,
  };
  if (building) { summary.building = true; }
  return summary;
}

function jenkinsHeaders(config: JenkinsRestConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'kronos-jenkins-rest',
  };
  if (config.username && config.token) {
    headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.token}`).toString('base64')}`;
  } else if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }
  return headers;
}

function buildJenkinsUrl(jobUrl: string, suffix: string, query: Record<string, string | number | boolean>): string {
  const base = `${jobUrl.replace(/\/+$/, '')}/`;
  const url = new URL(suffix.replace(/^\/+/, ''), base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function firstDefined(...values: unknown[]): unknown {
  return values.find(value => value !== undefined && value !== null);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) { return trimmed; }
  }
  return undefined;
}

function headerString(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const raw = headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return optionalTrimmedStringFromUnknown(value);
}

function responsePreview(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  return compact ? `: ${compact.slice(0, 300)}` : '';
}

class JenkinsRestError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, JenkinsRestError.prototype);
    this.name = 'JenkinsRestError';
  }
}

function defaultJenkinsTransport(request: JenkinsHttpRequest): Promise<JenkinsHttpResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch (e: unknown) {
      reject(new Error(unknownErrorMessage(e, 'Invalid Jenkins REST URL.')));
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: request.method,
      timeout: request.timeoutMs,
      headers: request.headers,
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        });
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error(`Timed out after ${request.timeoutMs}ms reaching Jenkins REST API.`));
    });
    req.on('error', reject);
    req.end();
  });
}
