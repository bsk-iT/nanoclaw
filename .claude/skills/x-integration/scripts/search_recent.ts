#!/usr/bin/env npx tsx
/**
 * X Integration - Search Recent Tweets
 * Searches recent tweets using Twitter API v2 search endpoint.
 * Usage: echo '{"query":"from:@Adrenaline","limit":5}' | npx tsx search_recent.ts
 * Output: { success: true, data: { tweets: [...] } }
 */

import { runScript, ScriptResult } from '../lib/browser.js';
import { apiGet, extractError } from '../lib/api.js';

interface SearchRecentInput {
  /** Twitter search query (e.g., "from:@Adrenaline", "FIIs dividendos") */
  query: string;
  /** Max number of tweets to return (default: 5, max: 20) */
  limit?: number;
  /** Only fetch tweets since this ISO date string. Defaults to 24 hours ago. */
  startTime?: string;
}

export interface Tweet {
  tweetId: string;
  tweetUrl: string;
  authorId: string;
  content: string;
  publishedAt: string;
}

interface SearchRecentResult extends ScriptResult {
  data?: {
    tweets: Tweet[];
    query: string;
    scrapedAt: string;
  };
}

async function searchRecent(
  input: SearchRecentInput,
): Promise<SearchRecentResult> {
  if (!input.query) {
    return { success: false, message: 'Missing required field: query' };
  }

  const limit = Math.min(input.limit ?? 5, 20);

  // Default: last 24 hours
  const startTime =
    input.startTime ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const res = await apiGet('/2/tweets/search/recent', {
    query: input.query,
    max_results: limit.toString(),
    start_time: startTime,
    'tweet.fields': 'created_at,author_id',
    expansions: 'author_id',
  });

  if (res.status !== 200) {
    return {
      success: false,
      message: `Failed to search tweets (HTTP ${res.status}): ${extractError(res.data)}`,
    };
  }

  const body = res.data as {
    data?: Array<{
      id: string;
      text: string;
      author_id: string;
      created_at: string;
    }>;
    meta?: { result_count: number };
  };

  if (!body.data || body.data.length === 0) {
    return {
      success: true,
      message: `No tweets found for query: ${input.query}`,
      data: {
        tweets: [],
        query: input.query,
        scrapedAt: new Date().toISOString(),
      },
    };
  }

  const tweets: Tweet[] = body.data.map((tweet) => ({
    tweetId: tweet.id,
    tweetUrl: `https://x.com/i/status/${tweet.id}`,
    authorId: tweet.author_id,
    content: tweet.text,
    publishedAt: tweet.created_at,
  }));

  return {
    success: true,
    message: `Found ${tweets.length} tweet(s) for query: ${input.query}`,
    data: {
      tweets,
      query: input.query,
      scrapedAt: new Date().toISOString(),
    },
  };
}

runScript<SearchRecentInput>(searchRecent);
