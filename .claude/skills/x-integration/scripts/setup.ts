#!/usr/bin/env npx tsx
/**
 * X Integration - Credential Verification
 *
 * Verifies that the 4 OAuth 1.0a credentials in .env are valid
 * by calling GET /2/users/me and printing account info.
 *
 * Usage: npx tsx setup.ts
 * Or with dotenv: npx tsx -r dotenv/config setup.ts
 */

import { apiGet, getCredentials, extractError } from '../lib/api.js';

async function setup(): Promise<void> {
  console.log('=== X (Twitter) Credential Verification ===\n');

  // Check env vars are present
  let creds: ReturnType<typeof getCredentials>;
  try {
    creds = getCredentials();
  } catch (err) {
    console.error(
      `❌ Missing credentials: ${err instanceof Error ? err.message : err}`,
    );
    console.error('\nMake sure these variables are set in .env:');
    console.error(
      '  X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET',
    );
    process.exit(1);
  }

  console.log(`API Key      : ${creds.apiKey.slice(0, 6)}...`);
  console.log(`Access Token : ${creds.accessToken.slice(0, 10)}...`);
  console.log('\nCalling GET /2/users/me ...\n');

  const res = await apiGet('/2/users/me', {
    'user.fields': 'username,name,public_metrics',
  });

  if (res.status === 200) {
    const body = res.data as {
      data?: {
        id: string;
        name: string;
        username: string;
        public_metrics?: {
          followers_count: number;
          following_count: number;
          tweet_count: number;
        };
      };
    };

    const u = body.data;
    if (!u) {
      console.error('❌ Unexpected response (no data field)');
      process.exit(1);
    }

    console.log('✅ Credentials valid!\n');
    console.log(`  Name     : ${u.name}`);
    console.log(`  Handle   : @${u.username}`);
    console.log(`  User ID  : ${u.id}`);
    if (u.public_metrics) {
      console.log(`  Followers: ${u.public_metrics.followers_count}`);
      console.log(`  Tweets   : ${u.public_metrics.tweet_count}`);
    }
    console.log('\nX integration is ready to use.');
  } else {
    console.error(`❌ Authentication failed (HTTP ${res.status})`);
    console.error(`   ${extractError(res.data)}`);
    console.error(
      '\nCheck your credentials in .env and ensure the app has Read and Write permissions.',
    );
    process.exit(1);
  }
}

setup().catch((err) => {
  console.error('Setup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
