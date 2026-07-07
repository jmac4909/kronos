import * as http from 'http';
import * as https from 'https';
import { unknownErrorMessage } from './errorUtils';
import { parseJsonWithLabel } from './jsonFiles';
import { arrayFromUnknown, isRecord, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown } from './records';

export interface GitLabMergeRequestTarget {
  projectIdOrPath: string;
  iid: number;
}

export interface GitLabRestRequestOptions {
  timeoutMs?: number;
}

export interface GitLabHttpRequest {
  method: 'GET';
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

export interface GitLabHttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

export type GitLabHttpTransport = (request: GitLabHttpRequest) => Promise<GitLabHttpResponse>;

export interface GitLabRestClientOptions {
  env?: NodeJS.ProcessEnv;
  transport?: GitLabHttpTransport;
}

interface GitLabRestConfig {
  apiBaseUrl: string;
  token: string;
}

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_PAGES = 20;

export class GitLabRestClient {
  private readonly env: NodeJS.ProcessEnv;
  private readonly transport: GitLabHttpTransport;

  constructor(options: GitLabRestClientOptions = {}) {
    this.env = options.env || process.env;
    this.transport = options.transport || defaultGitLabTransport;
  }

  async projectId(gitlabPath: string, options: GitLabRestRequestOptions = {}): Promise<number | null> {
    const projectPath = gitlabPath.trim();
    if (!projectPath) { return null; }
    const data = await this.requestJson(`/projects/${encodeURIComponent(projectPath)}`, 'GitLab project lookup', {}, options);
    const record = isRecord(data.value) ? data.value : {};
    const id = optionalFiniteNumberFromUnknown(record['id']);
    return id !== undefined ? id : null;
  }

  async mergeRequest(target: GitLabMergeRequestTarget, options: GitLabRestRequestOptions = {}): Promise<unknown> {
    const data = await this.requestJson(mergeRequestPath(target), `GitLab MR !${target.iid}`, {}, options);
    return data.value;
  }

  async mergeRequestStatus(target: GitLabMergeRequestTarget, options: GitLabRestRequestOptions = {}): Promise<unknown> {
    const [mr, comments, discussions, approvals] = await Promise.all([
      this.mergeRequest(target, options),
      this.paginatedArray(`${mergeRequestPath(target)}/notes`, `GitLab MR !${target.iid} notes`, {
        sort: 'asc',
        order_by: 'created_at',
      }, options),
      this.paginatedArray(`${mergeRequestPath(target)}/discussions`, `GitLab MR !${target.iid} discussions`, {}, options),
      this.optionalJson(`${mergeRequestPath(target)}/approvals`, `GitLab MR !${target.iid} approvals`, {}, options),
    ]);
    const status: Record<string, unknown> = { mr, comments, discussions };
    if (approvals !== undefined) { status['approvals'] = approvals; }
    return status;
  }

  async mergeRequestDiff(target: GitLabMergeRequestTarget, options: GitLabRestRequestOptions = {}): Promise<unknown> {
    const mr = await this.mergeRequest(target, options);
    const diffs = await this.paginatedArray(`${mergeRequestPath(target)}/diffs`, `GitLab MR !${target.iid} diffs`, {}, options)
      .catch(async (e: unknown) => {
        if (!isGitLabNotFoundError(e)) { throw e; }
        const changes = await this.requestJson(`${mergeRequestPath(target)}/changes`, `GitLab MR !${target.iid} changes`, {}, options);
        const record = isRecord(changes.value) ? changes.value : {};
        return arrayFromUnknown(record['changes']);
      });
    return { mr, files: diffs };
  }

  private async optionalJson(
    path: string,
    label: string,
    query: Record<string, string | number> = {},
    options: GitLabRestRequestOptions = {},
  ): Promise<unknown | undefined> {
    try {
      return (await this.requestJson(path, label, query, options)).value;
    } catch (e: unknown) {
      if (isGitLabNotFoundError(e)) { return undefined; }
      throw e;
    }
  }

  private async paginatedArray(
    path: string,
    label: string,
    query: Record<string, string | number> = {},
    options: GitLabRestRequestOptions = {},
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    let page = 1;
    for (;;) {
      const response = await this.requestJson(path, `${label} page ${page}`, { ...query, page, per_page: 100 }, options);
      results.push(...arrayFromUnknown(response.value));
      const nextPage = nextPageHeader(response.headers);
      if (!nextPage || page >= MAX_PAGES) { break; }
      page = nextPage;
    }
    return results;
  }

  private async requestJson(
    path: string,
    label: string,
    query: Record<string, string | number> = {},
    options: GitLabRestRequestOptions = {},
  ): Promise<{ value: unknown; headers: Record<string, string | string[] | undefined> }> {
    const config = resolveGitLabRestConfig(this.env);
    const url = buildGitLabUrl(config.apiBaseUrl, path, query);
    const response = await this.transport({
      method: 'GET',
      url,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        'PRIVATE-TOKEN': config.token,
        'User-Agent': 'kronos-gitlab-rest',
      },
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new GitLabRestError(`GitLab REST ${label} failed with HTTP ${response.statusCode}${responsePreview(response.body)}`);
    }
    return {
      value: parseJsonWithLabel(response.body, label, { includePreview: true }),
      headers: response.headers,
    };
  }
}

export function createGitLabRestClient(options: GitLabRestClientOptions = {}): GitLabRestClient {
  return new GitLabRestClient(options);
}

export const gitlabRestClient = createGitLabRestClient();

export function resolveGitLabRestConfig(env: NodeJS.ProcessEnv = process.env): GitLabRestConfig {
  const apiBaseUrl = normalizeGitLabApiBaseUrl(firstNonEmpty(
    env['GITLAB_API_BASE_URL'],
    env['GITLAB_BASE_URL'],
    env['GITLAB_URL'],
    env['GITLAB_HOST'],
  ));
  const token = firstNonEmpty(env['GITLAB_TOKEN']);
  const missing: string[] = [];
  if (!apiBaseUrl) { missing.push('GITLAB_BASE_URL'); }
  if (!token) { missing.push('GITLAB_TOKEN'); }
  if (missing.length > 0) {
    throw new GitLabRestError(`GitLab REST configuration missing ${missing.join(', ')}. Values are not displayed.`);
  }
  if (!apiBaseUrl || !token) {
    throw new GitLabRestError('GitLab REST configuration is incomplete. Values are not displayed.');
  }
  return { apiBaseUrl, token };
}

export function normalizeGitLabApiBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) { return undefined; }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { return undefined; }
    url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/api\/v4$/, '')}/api/v4`;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function gitLabProjectPathFromMergeRequestUrl(value: string | undefined): string | undefined {
  const trimmed = optionalTrimmedStringFromUnknown(value);
  if (!trimmed) { return undefined; }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { return undefined; }
    const marker = '/-/merge_requests/';
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex <= 1) { return undefined; }
    return decodeURIComponent(parsed.pathname.slice(1, markerIndex));
  } catch {
    return undefined;
  }
}

export function isGitLabRestConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(normalizeGitLabApiBaseUrl(firstNonEmpty(
    env['GITLAB_API_BASE_URL'],
    env['GITLAB_BASE_URL'],
    env['GITLAB_URL'],
    env['GITLAB_HOST'],
  )) && firstNonEmpty(env['GITLAB_TOKEN']));
}

class GitLabRestError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, GitLabRestError.prototype);
    this.name = 'GitLabRestError';
  }
}

function mergeRequestPath(target: GitLabMergeRequestTarget): string {
  return `/projects/${encodeURIComponent(target.projectIdOrPath)}/merge_requests/${encodeURIComponent(String(target.iid))}`;
}

function buildGitLabUrl(apiBaseUrl: string, path: string, query: Record<string, string | number>): string {
  const base = `${apiBaseUrl.replace(/\/+$/, '')}/`;
  const url = new URL(path.replace(/^\/+/, ''), base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function nextPageHeader(headers: Record<string, string | string[] | undefined>): number | undefined {
  const raw = headers['x-next-page'] || headers['X-Next-Page'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const page = optionalFiniteNumberFromUnknown(value);
  return page !== undefined && page > 0 ? Math.floor(page) : undefined;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) { return trimmed; }
  }
  return undefined;
}

function responsePreview(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  return compact ? `: ${compact.slice(0, 300)}` : '';
}

function isGitLabNotFoundError(error: unknown): boolean {
  return /\bHTTP 40[34]\b/.test(unknownErrorMessage(error, ''));
}

function defaultGitLabTransport(request: GitLabHttpRequest): Promise<GitLabHttpResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch (e: unknown) {
      reject(new Error(unknownErrorMessage(e, 'Invalid GitLab REST URL.')));
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
      req.destroy(new Error(`Timed out after ${request.timeoutMs}ms reaching GitLab REST API.`));
    });
    req.on('error', reject);
    req.end();
  });
}
