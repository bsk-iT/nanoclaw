/**
 * X Integration - Shared IO utilities
 *
 * Lightweight helpers used by all X scripts.
 * Playwright removed — all actions now go through Twitter API v2.
 */

import { config } from './config.js';

export { config };

export interface ScriptResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * Read JSON input from stdin
 */
export async function readInput<T>(): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error(`Invalid JSON input: ${err}`));
      }
    });
    process.stdin.on('error', reject);
  });
}

/**
 * Write JSON result to stdout
 */
export function writeResult(result: ScriptResult): void {
  console.log(JSON.stringify(result));
}

/**
 * Validate tweet/reply content length
 */
export function validateContent(
  content: string | undefined,
  type = 'Tweet',
): ScriptResult | null {
  if (!content || content.length === 0) {
    return { success: false, message: `${type} content cannot be empty` };
  }
  if (content.length > config.limits.tweetMaxLength) {
    return {
      success: false,
      message: `${type} exceeds ${config.limits.tweetMaxLength} character limit (current: ${content.length})`,
    };
  }
  return null;
}

/**
 * Run script with error handling
 */
export async function runScript<T>(
  handler: (input: T) => Promise<ScriptResult>,
): Promise<void> {
  try {
    const input = await readInput<T>();
    const result = await handler(input);
    writeResult(result);
  } catch (err) {
    writeResult({
      success: false,
      message: `Script execution failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
  }
}
