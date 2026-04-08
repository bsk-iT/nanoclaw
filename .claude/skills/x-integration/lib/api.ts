/**
 * X Integration - Twitter API v2 client with OAuth 1.0a
 *
 * Uses Node.js native `crypto` — no extra npm dependencies.
 * Supports GET and POST requests to the v2 API.
 */

import crypto from 'crypto';
import https from 'https';
import { URL } from 'url';

// ── Credentials (read from env at import time) ──────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export function getCredentials() {
  return {
    apiKey: requireEnv('X_API_KEY'),
    apiSecret: requireEnv('X_API_SECRET'),
    accessToken: requireEnv('X_ACCESS_TOKEN'),
    accessTokenSecret: requireEnv('X_ACCESS_TOKEN_SECRET'),
  };
}

// ── OAuth 1.0a signature ────────────────────────────────────────────────────

function percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function buildSignature(
  method: string,
  url: string,
  oauthParams: Record<string, string>,
  bodyParams: Record<string, string>,
  apiSecret: string,
  tokenSecret: string,
): string {
  // Collect all params (oauth + body — NOT query string for POST)
  const allParams: Record<string, string> = { ...oauthParams, ...bodyParams };

  // Sort params alphabetically by key
  const sortedParams = Object.entries(allParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
    .join('&');

  // Base string: METHOD & encoded_url & encoded_params
  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sortedParams),
  ].join('&');

  // Signing key: encoded_api_secret & encoded_token_secret
  const signingKey = `${percentEncode(apiSecret)}&${percentEncode(tokenSecret)}`;

  return crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');
}

function buildAuthHeader(
  method: string,
  url: string,
  bodyParams: Record<string, string>,
  creds: ReturnType<typeof getCredentials>,
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  // Strip query string from URL for signature base (params are separate)
  const cleanUrl = url.split('?')[0];

  oauthParams.oauth_signature = buildSignature(
    method,
    cleanUrl,
    oauthParams,
    bodyParams,
    creds.apiSecret,
    creds.accessTokenSecret,
  );

  const headerParts = Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(', ');

  return `OAuth ${headerParts}`;
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

function httpsRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        ...headers,
        ...(body
          ? { 'Content-Length': Buffer.byteLength(body).toString() }
          : {}),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: raw });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

const BASE = 'https://api.twitter.com';

/**
 * POST to Twitter API v2.
 * `body` is sent as JSON.
 */
export async function apiPost(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const url = `${BASE}${endpoint}`;
  const creds = getCredentials();
  const jsonBody = JSON.stringify(body);

  // OAuth signature for JSON POST uses empty bodyParams (body is not form-encoded)
  const auth = buildAuthHeader('POST', url, {}, creds);

  return httpsRequest(
    'POST',
    url,
    {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    jsonBody,
  );
}

/**
 * GET from Twitter API v2.
 * `params` are appended as query string.
 */
export async function apiGet(
  endpoint: string,
  params: Record<string, string> = {},
): Promise<{ status: number; data: unknown }> {
  const query = new URLSearchParams(params).toString();
  const url = `${BASE}${endpoint}${query ? '?' + query : ''}`;
  const creds = getCredentials();

  // For GET, query params are included in OAuth signature
  const auth = buildAuthHeader('GET', url.split('?')[0], params, creds);

  return httpsRequest('GET', url, {
    Authorization: auth,
  });
}

// ── Typed response helpers ──────────────────────────────────────────────────

export interface ApiError {
  title?: string;
  detail?: string;
  errors?: Array<{ message: string }>;
}

export function extractError(data: unknown): string {
  const d = data as ApiError;
  if (d?.errors?.[0]?.message) return d.errors[0].message;
  if (d?.detail) return d.detail;
  if (d?.title) return d.title;
  return JSON.stringify(data);
}
