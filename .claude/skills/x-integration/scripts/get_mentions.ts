#!/usr/bin/env npx tsx
/**
 * X Integration - Get Mentions
 * Fetches recent @mentions via Twitter API v2.
 * Usage: echo '{"limit":20}' | npx tsx get_mentions.ts
 * Output: { success: true, data: { mentions: [...] } }
 */

import { runScript, ScriptResult } from '../lib/browser.js';
import { apiGet, extractError } from '../lib/api.js';

interface GetMentionsInput {
  /** Max number of mentions to return (default: 20, max: 100) */
  limit?: number;
  /** Only fetch mentions since this ISO date string. Defaults to 4 hours ago. */
  startTime?: string;
}

export interface Mention {
  tweetId: string;
  tweetUrl: string;
  authorId: string;
  content: string;
  publishedAt: string;
  isReply: boolean;
}

interface GetMentionsResult extends ScriptResult {
  data?: {
    mentions: Mention[];
    scrapedAt: string;
  };
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

async function getMentions(
  input: GetMentionsInput,
): Promise<GetMentionsResult> {
  const limit = Math.min(input.limit ?? 20, 100);

  // Default: last 4 hours
  const startTime =
    input.startTime ?? new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

  const userId = await getUserId();

  const res = await apiGet(`/2/users/${userId}/mentions`, {
    max_results: limit.toString(),
    start_time: startTime,
    'tweet.fields':
      'created_at,author_id,in_reply_to_user_id,referenced_tweets',
    expansions: 'author_id',
  });

  if (res.status !== 200) {
    return {
      success: false,
      message: `Failed to fetch mentions (HTTP ${res.status}): ${extractError(res.data)}`,
    };
  }

  const body = res.data as {
    data?: Array<{
      id: string;
      text: string;
      author_id: string;
      created_at: string;
      in_reply_to_user_id?: string;
      referenced_tweets?: Array<{ type: string }>;
    }>;
    meta?: { result_count: number };
  };

  if (!body.data || body.data.length === 0) {
    return {
      success: true,
      message: 'No mentions found in the specified time range.',
      data: { mentions: [], scrapedAt: new Date().toISOString() },
    };
  }

  const mentions: Mention[] = body.data.map((tweet) => {
    const isReply =
      !!tweet.in_reply_to_user_id ||
      (tweet.referenced_tweets?.some((r) => r.type === 'replied_to') ?? false);

    return {
      tweetId: tweet.id,
      tweetUrl: `https://x.com/i/status/${tweet.id}`,
      authorId: tweet.author_id,
      content: tweet.text,
      publishedAt: tweet.created_at,
      isReply,
    };
  });

  return {
    success: true,
    message: `Found ${mentions.length} mention(s) since ${startTime}.`,
    data: {
      mentions,
      scrapedAt: new Date().toISOString(),
    },
  };
}

runScript<GetMentionsInput>(getMentions);
