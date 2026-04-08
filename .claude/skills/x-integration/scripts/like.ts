#!/usr/bin/env npx tsx
/**
 * X Integration - Like Tweet
 * Usage: echo '{"tweetId":"1234567890"}' | npx tsx like.ts
 * Also accepts tweetUrl instead of tweetId.
 */

import { runScript, ScriptResult } from '../lib/browser.js';
import { apiPost, apiGet, extractError } from '../lib/api.js';

interface LikeInput {
  tweetId?: string;
  tweetUrl?: string;
}

function extractIdFromUrl(url: string): string | null {
  const m = url.match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

async function getUserId(): Promise<string> {
  const res = await apiGet('/2/users/me');
  if (res.status !== 200)
    throw new Error(`Could not fetch user id: ${extractError(res.data)}`);
  const d = res.data as { data?: { id?: string } };
  const id = d?.data?.id;
  if (!id) throw new Error('User id not found in /2/users/me response');
  return id;
}

async function likeTweet(input: LikeInput): Promise<ScriptResult> {
  const tweetId =
    input.tweetId ?? (input.tweetUrl ? extractIdFromUrl(input.tweetUrl) : null);
  if (!tweetId) {
    return { success: false, message: 'Provide tweetId or tweetUrl' };
  }

  const userId = await getUserId();
  const res = await apiPost(`/2/users/${userId}/likes`, { tweet_id: tweetId });

  if (res.status === 200) {
    const d = res.data as { data?: { liked?: boolean } };
    if (d?.data?.liked === false) {
      return { success: true, message: `Tweet ${tweetId} was already liked` };
    }
    return { success: true, message: `Liked tweet ${tweetId}` };
  }

  return {
    success: false,
    message: `Failed to like tweet (HTTP ${res.status}): ${extractError(res.data)}`,
  };
}

runScript<LikeInput>(likeTweet);
