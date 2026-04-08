/**
 * X Integration - Configuration
 *
 * Minimal config after migration to Twitter API v2.
 * Credentials are read from env by lib/api.ts.
 */

// X character limits
export const config = {
  limits: {
    tweetMaxLength: 280,
  },
};
