#!/usr/bin/env npx tsx
/**
 * X Integration - Reply to Tweet
 * Usage: echo '{"tweetId":"1234567890","content":"Great point!"}' | npx tsx reply.ts
 */

import { runScript, validateContent, ScriptResult } from '../lib/browser.js';
import { apiPost, extractError } from '../lib/api.js';

interface ReplyInput {
  tweetId: string;
  content: string;
}

async function replyToTweet(input: ReplyInput): Promise<ScriptResult> {
  if (!input.tweetId) {
    return { success: false, message: 'tweetId is required' };
  }

  const validationError = validateContent(input.content, 'Reply');
  if (validationError) return validationError;

  const res = await apiPost('/2/tweets', {
    text: input.content,
    reply: { in_reply_to_tweet_id: input.tweetId },
  });

  if (res.status === 201) {
    const d = res.data as { data?: { id?: string } };
    const id = d?.data?.id ?? 'unknown';
    return {
      success: true,
      message: `Reply posted (id: ${id}) to tweet ${input.tweetId}`,
      data: { tweetId: id },
    };
  }

  return {
    success: false,
    message: `Failed to reply (HTTP ${res.status}): ${extractError(res.data)}`,
  };
}

runScript<ReplyInput>(replyToTweet);
