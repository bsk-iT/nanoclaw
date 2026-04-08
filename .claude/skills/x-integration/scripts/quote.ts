#!/usr/bin/env npx tsx
/**
 * X Integration - Quote Tweet
 * Usage: echo '{"tweetId":"1234567890","content":"My take on this"}' | npx tsx quote.ts
 * Also accepts tweetUrl instead of tweetId.
 */

import { runScript, validateContent, ScriptResult } from '../lib/browser.js';
import { apiPost, extractError } from '../lib/api.js';

interface QuoteInput {
  tweetId?: string;
  tweetUrl?: string;
  content: string;
}

function extractIdFromUrl(url: string): string | null {
  const m = url.match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

async function quoteTweet(input: QuoteInput): Promise<ScriptResult> {
  const tweetId =
    input.tweetId ?? (input.tweetUrl ? extractIdFromUrl(input.tweetUrl) : null);
  if (!tweetId) {
    return { success: false, message: 'Provide tweetId or tweetUrl' };
  }

  const validationError = validateContent(input.content, 'Quote');
  if (validationError) return validationError;

  const res = await apiPost('/2/tweets', {
    text: input.content,
    quote_tweet_id: tweetId,
  });

  if (res.status === 201) {
    const d = res.data as { data?: { id?: string } };
    const id = d?.data?.id ?? 'unknown';
    return {
      success: true,
      message: `Quote tweet posted (id: ${id})`,
      data: { tweetId: id },
    };
  }

  return {
    success: false,
    message: `Failed to quote tweet (HTTP ${res.status}): ${extractError(res.data)}`,
  };
}

runScript<QuoteInput>(quoteTweet);
