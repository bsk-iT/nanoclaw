#!/usr/bin/env npx tsx
/**
 * X Integration - Post Tweet
 * Usage: echo '{"content":"Hello world"}' | npx tsx post.ts
 */

import { runScript, validateContent, ScriptResult } from '../lib/browser.js';
import { apiPost, extractError } from '../lib/api.js';

interface PostInput {
  content: string;
}

async function postTweet(input: PostInput): Promise<ScriptResult> {
  const validationError = validateContent(input.content, 'Tweet');
  if (validationError) return validationError;

  const res = await apiPost('/2/tweets', { text: input.content });

  if (res.status === 201) {
    const d = res.data as { data?: { id?: string } };
    const id = d?.data?.id ?? 'unknown';
    return {
      success: true,
      message: `Tweet posted (id: ${id}): ${input.content.slice(0, 50)}${input.content.length > 50 ? '...' : ''}`,
      data: { tweetId: id },
    };
  }

  return {
    success: false,
    message: `Failed to post tweet (HTTP ${res.status}): ${extractError(res.data)}`,
  };
}

runScript<PostInput>(postTweet);
