import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { TextDecoder } from 'util';
import { unknownErrorCode } from './errorUtils';
import { parseJsonWithLabel } from './jsonFiles';
import { arrayFromUnknown, isRecord, optionalFiniteNumberFromUnknown } from './records';

export interface JiraRestRequestOptions {
  timeoutMs?: number;
}

export interface JiraHttpRequest {
  method: 'GET';
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxResponseBytes: number;
  responseType?: 'text' | 'buffer';
}

export interface JiraHttpResponse {
  statusCode: number;
  body: string | Buffer;
  headers: Record<string, string | string[] | undefined>;
}

export type JiraHttpTransport = (request: JiraHttpRequest) => Promise<JiraHttpResponse>;

export interface JiraRestClientOptions {
  env?: NodeJS.ProcessEnv;
  transport?: JiraHttpTransport;
  maxCommentPages?: number;
  commentsPerPage?: number;
  maxResponseBytes?: number;
  maxTotalCommentBytes?: number;
}

export interface JiraRestConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface JiraTicketSnapshot {
  issue: unknown;
  comments: unknown[];
  attachmentContents: JiraAttachmentContentSnapshot[];
  fetchedAt: string;
  issueUrl: string;
  commentsComplete: boolean;
  commentPageCount: number;
  commentResponseBytes: number;
  attachmentFetchCount: number;
  attachmentResponseBytes: number;
  commentTotal?: number;
  warnings: string[];
}

export type JiraAttachmentContentStatus = 'captured' | 'skipped' | 'failed';

export interface JiraAttachmentContentSnapshot {
  index: number;
  status: JiraAttachmentContentStatus;
  id?: string;
  reason?: string;
  declaredMimeType?: string;
  responseMimeType?: string;
  declaredBytes?: number;
  responseBytes?: number;
  sourceSha256?: string;
  text?: string;
}

interface JiraCommentCollection {
  comments: unknown[];
  complete: boolean;
  pageCount: number;
  responseBytes: number;
  total?: number;
  warnings: string[];
}

interface JiraAttachmentCollection {
  contents: JiraAttachmentContentSnapshot[];
  fetchCount: number;
  responseBytes: number;
  warnings: string[];
}

interface JiraAttachmentFetchResult {
  content: JiraAttachmentContentSnapshot;
  budgetBytes: number;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_COMMENT_PAGES = 100;
const DEFAULT_COMMENTS_PER_PAGE = 100;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_COMMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_FETCHES = 10;
const MAX_ATTACHMENT_BYTES = 256 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'text/csv',
  'text/markdown',
  'text/plain',
  'text/tab-separated-values',
  'text/xml',
  'text/yaml',
]);
const UNSAFE_TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

export class JiraRestClient {
  private readonly env: NodeJS.ProcessEnv;
  private readonly transport: JiraHttpTransport;
  private readonly maxCommentPages: number;
  private readonly commentsPerPage: number;
  private readonly maxResponseBytes: number;
  private readonly maxTotalCommentBytes: number;

  constructor(options: JiraRestClientOptions = {}) {
    this.env = options.env || process.env;
    this.transport = options.transport || defaultJiraTransport;
    this.maxCommentPages = boundedInteger(options.maxCommentPages, DEFAULT_MAX_COMMENT_PAGES, 1, 1000);
    this.commentsPerPage = boundedInteger(options.commentsPerPage, DEFAULT_COMMENTS_PER_PAGE, 1, 100);
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      1024,
      25 * 1024 * 1024,
    );
    this.maxTotalCommentBytes = boundedInteger(
      options.maxTotalCommentBytes,
      DEFAULT_MAX_TOTAL_COMMENT_BYTES,
      1024,
      250 * 1024 * 1024,
    );
  }

  async ticketContext(
    ticketKey: string,
    issueUrl?: string,
    options: JiraRestRequestOptions = {},
  ): Promise<JiraTicketSnapshot> {
    const normalizedKey = normalizeJiraIssueKey(ticketKey);
    const config = resolveJiraRestConfig(this.env);
    const issuePath = `/rest/api/3/issue/${encodeURIComponent(normalizedKey)}`;
    const issue = (await this.requestJson(config, issuePath, `Jira issue ${normalizedKey}`, {
      fields: '*all',
      expand: 'names,schema',
    }, options)).value;
    const commentCollection = await this.paginatedComments(config, normalizedKey, options);
    const attachmentCollection = await this.attachmentContents(config, issue, options);
    const resolvedIssueUrl = normalizeJiraIssueUrl(issueUrl) || `${config.baseUrl}/browse/${encodeURIComponent(normalizedKey)}`;
    const snapshot: JiraTicketSnapshot = {
      issue,
      comments: commentCollection.comments,
      attachmentContents: attachmentCollection.contents,
      fetchedAt: new Date().toISOString(),
      issueUrl: resolvedIssueUrl,
      commentsComplete: commentCollection.complete,
      commentPageCount: commentCollection.pageCount,
      commentResponseBytes: commentCollection.responseBytes,
      attachmentFetchCount: attachmentCollection.fetchCount,
      attachmentResponseBytes: attachmentCollection.responseBytes,
      warnings: [...commentCollection.warnings, ...attachmentCollection.warnings],
    };
    if (commentCollection.total !== undefined) {
      snapshot.commentTotal = commentCollection.total;
    }
    return snapshot;
  }

  private async attachmentContents(
    config: JiraRestConfig,
    issueValue: unknown,
    options: JiraRestRequestOptions,
  ): Promise<JiraAttachmentCollection> {
    const issue = isRecord(issueValue) ? issueValue : {};
    const fields = isRecord(issue['fields']) ? issue['fields'] : {};
    const attachments = arrayFromUnknown(fields['attachment']);
    const contents: JiraAttachmentContentSnapshot[] = [];
    let fetchCount = 0;
    let responseBytes = 0;
    let budgetBytes = 0;

    for (let index = 0; index < attachments.length; index += 1) {
      const attachmentValue = attachments[index];
      const metadata: Record<string, unknown> = isRecord(attachmentValue) ? attachmentValue : {};
      const id = normalizedAttachmentId(metadata['id']);
      const declaredMimeType = normalizedMimeType(firstHeaderLikeString(metadata['mimeType'], metadata['mimetype']));
      const declaredBytes = nonNegativeInteger(metadata['size']);
      const base: JiraAttachmentContentSnapshot = { index, status: 'skipped' };
      if (id) { base.id = id; }
      if (declaredMimeType) { base.declaredMimeType = declaredMimeType; }
      if (declaredBytes !== undefined) { base.declaredBytes = declaredBytes; }

      if (!id) {
        contents.push({ ...base, reason: 'invalid-id' });
        continue;
      }
      if (!declaredMimeType || !ALLOWED_ATTACHMENT_MIME_TYPES.has(declaredMimeType)) {
        contents.push({ ...base, reason: 'unsupported-mime' });
        continue;
      }
      if (declaredBytes !== undefined && declaredBytes > MAX_ATTACHMENT_BYTES) {
        contents.push({ ...base, reason: 'per-file-byte-limit' });
        continue;
      }
      if (fetchCount >= MAX_ATTACHMENT_FETCHES) {
        contents.push({ ...base, reason: 'fetch-count-limit' });
        continue;
      }
      const remainingBytes = MAX_TOTAL_ATTACHMENT_BYTES - budgetBytes;
      if (remainingBytes <= 0 || (declaredBytes !== undefined && declaredBytes > remainingBytes)) {
        contents.push({ ...base, reason: 'total-byte-limit' });
        continue;
      }

      fetchCount += 1;
      const fetched = await this.requestAttachmentText(
        config,
        base,
        Math.min(MAX_ATTACHMENT_BYTES, remainingBytes),
        options,
      );
      budgetBytes += fetched.budgetBytes;
      responseBytes += fetched.content.responseBytes || 0;
      contents.push(fetched.content);
    }

    const captured = contents.filter(item => item.status === 'captured').length;
    const skipped = contents.filter(item => item.status === 'skipped').length;
    const failed = contents.filter(item => item.status === 'failed').length;
    const warnings = skipped > 0 || failed > 0
      ? [`Jira attachment content capture was partial: ${captured} captured, ${skipped} skipped, and ${failed} failed.`]
      : [];
    return { contents, fetchCount, responseBytes, warnings };
  }

  private async requestAttachmentText(
    config: JiraRestConfig,
    base: JiraAttachmentContentSnapshot,
    maxResponseBytes: number,
    options: JiraRestRequestOptions,
  ): Promise<JiraAttachmentFetchResult> {
    if (!base.id || !base.declaredMimeType) {
      return {
        content: { ...base, status: 'skipped', reason: 'invalid-metadata' },
        budgetBytes: 0,
      };
    }
    const requestUrl = buildCredentialedJiraUrl(
      config.baseUrl,
      `/rest/api/3/attachment/content/${encodeURIComponent(base.id)}`,
      { redirect: 'false' },
    );
    const request: JiraHttpRequest = {
      method: 'GET',
      url: requestUrl,
      headers: jiraHeaders(config, '*/*'),
      timeoutMs: boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 250, 120000),
      maxResponseBytes,
      responseType: 'buffer',
    };
    let response: JiraHttpResponse;
    try {
      response = await this.transport(request);
    } catch (error: unknown) {
      return {
        content: {
          ...base,
          status: 'failed',
          reason: error instanceof JiraResponseLimitError ? 'response-byte-limit' : 'fetch-failed',
        },
        // The transport did not return a trustworthy byte count. Reserve the
        // entire attempted allowance so repeated failures cannot reset the
        // cumulative one MiB attachment budget.
        budgetBytes: maxResponseBytes,
      };
    }

    const body = responseBodyBuffer(response.body);
    const responseMime = responseContentType(response.headers);
    const result: JiraAttachmentContentSnapshot = { ...base, status: 'failed', responseBytes: body.length };
    const completed = (): JiraAttachmentFetchResult => ({ content: result, budgetBytes: body.length });
    if (responseMime.mimeType) { result.responseMimeType = responseMime.mimeType; }
    if (body.length > maxResponseBytes) {
      result.reason = 'response-byte-limit';
      return completed();
    }
    if (response.statusCode >= 300 && response.statusCode < 400) {
      result.reason = 'redirect-refused';
      return completed();
    }
    if (response.statusCode !== 200) {
      result.reason = `http-${response.statusCode || 0}`;
      return completed();
    }
    if (!responseMime.mimeType || !ALLOWED_ATTACHMENT_MIME_TYPES.has(responseMime.mimeType)) {
      result.reason = 'unsupported-response-mime';
      return completed();
    }
    if (responseMime.charset && !isSupportedTextCharset(responseMime.charset)) {
      result.reason = 'unsupported-charset';
      return completed();
    }

    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch {
      result.reason = 'invalid-utf8';
      return completed();
    }
    if (UNSAFE_TEXT_CONTROL_PATTERN.test(text)) {
      result.reason = 'unsafe-control-characters';
      return completed();
    }
    if (text.charCodeAt(0) === 0xFEFF) { text = text.slice(1); }
    result.status = 'captured';
    result.sourceSha256 = crypto.createHash('sha256').update(body).digest('hex');
    result.text = text.replace(/\r\n?/g, '\n');
    return completed();
  }

  private async paginatedComments(
    config: JiraRestConfig,
    ticketKey: string,
    options: JiraRestRequestOptions,
  ): Promise<JiraCommentCollection> {
    const comments: unknown[] = [];
    const warnings: string[] = [];
    let pageCount = 0;
    let responseBytes = 0;
    let startAt = 0;
    let total: number | undefined;
    let complete = false;

    while (pageCount < this.maxCommentPages) {
      const pageNumber = pageCount + 1;
      let response: Awaited<ReturnType<JiraRestClient['requestJson']>>;
      try {
        response = await this.requestJson(
          config,
          `/rest/api/3/issue/${encodeURIComponent(ticketKey)}/comment`,
          `Jira comments for ${ticketKey} page ${pageNumber}`,
          { startAt, maxResults: this.commentsPerPage, orderBy: 'created' },
          options,
        );
      } catch {
        warnings.push(`Jira comment page ${pageNumber} could not be fetched; ${comments.length} previously fetched comment${comments.length === 1 ? '' : 's'} were retained.`);
        break;
      }
      if (responseBytes + response.bodyBytes > this.maxTotalCommentBytes) {
        warnings.push(`Jira comment collection stopped before page ${pageNumber} because responses reached the ${this.maxTotalCommentBytes}-byte cumulative safety limit.`);
        break;
      }
      responseBytes += response.bodyBytes;
      const page = isRecord(response.value) ? response.value : undefined;
      if (!page) {
        warnings.push(`Jira comment page ${pageNumber} returned an invalid pagination object; previously fetched comments were retained.`);
        break;
      }
      const pageComments = arrayFromUnknown(page['comments']);
      const declaredTotal = nonNegativeInteger(page['total']);
      if (declaredTotal !== undefined) {
        total = declaredTotal;
      }
      comments.push(...pageComments);
      pageCount = pageNumber;

      const nextStartAt = startAt + pageComments.length;
      if (page['isLast'] === true
        || (total !== undefined && nextStartAt >= total)
        || (total === undefined && pageComments.length < this.commentsPerPage)) {
        complete = true;
        break;
      }
      if (pageComments.length === 0 || nextStartAt <= startAt) {
        warnings.push(`Jira comment collection stopped at page ${pageNumber} because pagination did not advance safely.`);
        break;
      }
      startAt = nextStartAt;
    }

    if (!complete) {
      warnings.push(`Jira comment collection stopped at the safety limit of ${this.maxCommentPages} pages.`);
    }
    const result: JiraCommentCollection = { comments, complete, pageCount, responseBytes, warnings };
    if (total !== undefined) {
      result.total = total;
    }
    return result;
  }

  private async requestJson(
    config: JiraRestConfig,
    apiPath: string,
    label: string,
    query: Record<string, string | number>,
    options: JiraRestRequestOptions,
  ): Promise<{ value: unknown; headers: Record<string, string | string[] | undefined>; bodyBytes: number }> {
    const request: JiraHttpRequest = {
      method: 'GET',
      url: buildCredentialedJiraUrl(config.baseUrl, apiPath, query),
      headers: jiraHeaders(config),
      timeoutMs: boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 250, 120000),
      maxResponseBytes: this.maxResponseBytes,
      responseType: 'text',
    };
    let response: JiraHttpResponse;
    try {
      response = await this.transport(request);
    } catch (error: unknown) {
      if (error instanceof JiraRestError) { throw error; }
      const code = unknownErrorCode(error);
      throw new JiraRestError(
        `Jira REST request failed while fetching ${label}${code ? ` (${code})` : ''}. `
        + 'Check connectivity and Jira configuration; credentials and response bodies are not displayed.',
      );
    }
    const body = responseBodyBuffer(response.body);
    if (body.length > this.maxResponseBytes) {
      throw new JiraRestError(`Jira REST ${label} exceeded the ${this.maxResponseBytes}-byte response safety limit.`);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw jiraHttpError(label, response.statusCode);
    }
    return {
      value: parseJsonWithLabel(body.toString('utf8'), label),
      headers: response.headers,
      bodyBytes: body.length,
    };
  }
}

export function createJiraRestClient(options: JiraRestClientOptions = {}): JiraRestClient {
  return new JiraRestClient(options);
}

export const jiraRestClient = createJiraRestClient();

export function isJiraRestConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    resolveJiraRestConfig(env);
    return true;
  } catch {
    return false;
  }
}

export function resolveJiraRestConfig(env: NodeJS.ProcessEnv = process.env): JiraRestConfig {
  const baseUrl = normalizeJiraBaseUrl(env['JIRA_BASE_URL']);
  const email = env['JIRA_EMAIL']?.trim();
  const apiToken = env['JIRA_API_TOKEN']?.trim();
  const missing: string[] = [];
  if (!baseUrl) { missing.push('JIRA_BASE_URL'); }
  if (!email) { missing.push('JIRA_EMAIL'); }
  if (!apiToken) { missing.push('JIRA_API_TOKEN'); }
  if (missing.length > 0) {
    throw new JiraRestError(`Jira REST configuration missing ${missing.join(', ')}. Values are not displayed.`);
  }
  if (!baseUrl || !email || !apiToken) {
    throw new JiraRestError('Jira REST configuration is incomplete. Values are not displayed.');
  }
  return { baseUrl, email, apiToken };
}

export function normalizeJiraBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) { return undefined; }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) {
      return undefined;
    }
    url.username = '';
    url.password = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function normalizeJiraIssueKey(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,127}-[1-9][0-9]*$/.test(normalized)) {
    throw new JiraRestError('Jira ticket key is missing or invalid.');
  }
  return normalized;
}

export class JiraRestError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, JiraRestError.prototype);
    this.name = 'JiraRestError';
  }
}

class JiraResponseLimitError extends JiraRestError {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, JiraResponseLimitError.prototype);
    this.name = 'JiraResponseLimitError';
  }
}

function normalizeJiraIssueUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) { return undefined; }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { return undefined; }
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function jiraHeaders(config: JiraRestConfig, accept = 'application/json'): Record<string, string> {
  return {
    Accept: accept,
    Authorization: `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`,
    'User-Agent': 'kronos-jira-rest',
  };
}

function buildCredentialedJiraUrl(
  baseUrl: string,
  apiPath: string,
  query: Record<string, string | number>,
): string {
  const requestUrl = buildJiraUrl(baseUrl, apiPath, query);
  const configuredOrigin = new URL(baseUrl).origin;
  if (new URL(requestUrl).origin !== configuredOrigin) {
    throw new JiraRestError('Refused to send Jira credentials outside the configured JIRA_BASE_URL origin.');
  }
  return requestUrl;
}

function buildJiraUrl(baseUrl: string, apiPath: string, query: Record<string, string | number>): string {
  const url = new URL(apiPath.replace(/^\/+/, ''), `${baseUrl.replace(/\/+$/, '')}/`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function jiraHttpError(label: string, statusCode: number): JiraRestError {
  if (statusCode === 401 || statusCode === 403) {
    return new JiraRestError(
      `Jira REST ${label} failed with HTTP ${statusCode}. Check Jira credentials and permissions; values are not displayed.`,
    );
  }
  if (statusCode === 404) {
    return new JiraRestError(`Jira REST ${label} failed with HTTP 404. The ticket may be missing or unavailable.`);
  }
  if (statusCode === 429) {
    return new JiraRestError(`Jira REST ${label} failed with HTTP 429. Jira rate limiting prevented a complete fetch.`);
  }
  return new JiraRestError(`Jira REST ${label} failed with HTTP ${statusCode}. Response content is not displayed.`);
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = optionalFiniteNumberFromUnknown(value);
  return number !== undefined && number >= 0 ? Math.floor(number) : undefined;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) { return fallback; }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function normalizedAttachmentId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') { return undefined; }
  const normalized = String(value).trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : undefined;
}

function firstHeaderLikeString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) { return value.trim(); }
  }
  return undefined;
}

function normalizedMimeType(value: string | undefined): string | undefined {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase();
  return normalized && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)
    ? normalized
    : undefined;
}

function responseContentType(
  headers: Record<string, string | string[] | undefined>,
): { mimeType?: string; charset?: string } {
  let rawValue: string | undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'content-type') { continue; }
    rawValue = Array.isArray(value) ? value[0] : value;
    break;
  }
  if (!rawValue) { return {}; }
  const segments = rawValue.split(';').map(segment => segment.trim());
  const mimeType = normalizedMimeType(segments[0]);
  const charsetSegment = segments.slice(1).find(segment => /^charset\s*=/i.test(segment));
  const charset = charsetSegment
    ?.replace(/^charset\s*=\s*/i, '')
    .replace(/^"|"$/g, '')
    .trim()
    .toLowerCase();
  const result: { mimeType?: string; charset?: string } = {};
  if (mimeType) { result.mimeType = mimeType; }
  if (charset) { result.charset = charset; }
  return result;
}

function isSupportedTextCharset(value: string): boolean {
  return value === 'utf-8' || value === 'utf8' || value === 'us-ascii' || value === 'ascii';
}

function responseBodyBuffer(body: string | Buffer): Buffer {
  return Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
}

function defaultJiraTransport(request: JiraHttpRequest): Promise<JiraHttpResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch {
      reject(new JiraRestError('Invalid Jira REST URL.'));
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new JiraRestError('Invalid Jira REST URL protocol.'));
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: request.method,
      timeout: request.timeoutMs,
      headers: request.headers,
    }, res => {
      const declaredLength = firstHeaderLikeString(res.headers['content-length']);
      if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > request.maxResponseBytes) {
        res.destroy();
        req.destroy();
        reject(new JiraResponseLimitError(`Jira REST response exceeded the ${request.maxResponseBytes}-byte safety limit.`));
        return;
      }
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      res.on('data', chunk => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        receivedBytes += buffer.length;
        if (receivedBytes > request.maxResponseBytes) {
          res.destroy();
          req.destroy();
          reject(new JiraResponseLimitError(`Jira REST response exceeded the ${request.maxResponseBytes}-byte safety limit.`));
          return;
        }
        chunks.push(buffer);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode || 0,
          body: request.responseType === 'buffer' ? body : body.toString('utf8'),
          headers: res.headers,
        });
      });
      res.on('error', () => {
        reject(new JiraRestError('Jira REST response ended unexpectedly.'));
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new JiraRestError(`Timed out after ${request.timeoutMs}ms reaching Jira REST API.`));
    });
    req.on('error', () => {
      reject(new JiraRestError('Jira REST network request failed.'));
    });
    req.end();
  });
}
