---
name: x-integration
description: X (Twitter) integration for NanoClaw. Post tweets, like, reply, retweet, and quote. Use for setup, testing, or troubleshooting X functionality. Triggers on "setup x", "x integration", "twitter", "post tweet", "tweet".
---

# X (Twitter) Integration

Twitter API v2 integration via OAuth 1.0a — no browser automation required.

> **Compatibility:** NanoClaw v1.2.52+. Uses Twitter API v2 directly via `lib/api.ts`.

## Features

| Action          | Tool             | Description                                    |
| --------------- | ---------------- | ---------------------------------------------- |
| Post            | `x_post`         | Publish new tweets                             |
| Post (approval) | `x_post_pending` | Submit tweet for human approval before posting |
| Like            | `x_like`         | Like any tweet                                 |
| Reply           | `x_reply`        | Reply to tweets                                |
| Retweet         | `x_retweet`      | Retweet without comment                        |
| Quote           | `x_quote`        | Quote tweet with comment                       |
| Mentions        | `x_get_mentions` | Fetch recent @mentions                         |

## Prerequisites

Before using this skill, ensure:

1. **NanoClaw is installed and running** — Telegram connected, service active
2. **Twitter API credentials** configured in `.env`:
   ```bash
   X_API_KEY=...
   X_API_SECRET=...
   X_ACCESS_TOKEN=...
   X_ACCESS_TOKEN_SECRET=...
   ```
3. **Twitter Developer App** with Read+Write permissions (OAuth 1.0a, not OAuth 2.0)

## Quick Start

```bash
# 1. Add credentials to .env
echo "X_API_KEY=your_key" >> .env
echo "X_API_SECRET=your_secret" >> .env
echo "X_ACCESS_TOKEN=your_token" >> .env
echo "X_ACCESS_TOKEN_SECRET=your_token_secret" >> .env

# 2. Rebuild container to include skill
./container/build.sh

# 3. Rebuild host and restart service
npm run build
systemctl --user restart nanoclaw  # Linux
# macOS: launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Configuration

### Environment Variables

| Variable                | Description                    |
| ----------------------- | ------------------------------ |
| `X_API_KEY`             | Twitter API consumer key       |
| `X_API_SECRET`          | Twitter API consumer secret    |
| `X_ACCESS_TOKEN`        | OAuth 1.0a access token        |
| `X_ACCESS_TOKEN_SECRET` | OAuth 1.0a access token secret |

### Data Directories

| Path                | Purpose                         | Git     |
| ------------------- | ------------------------------- | ------- |
| `data/x-auth.json`  | Optional auth state marker      | Ignored |
| `logs/nanoclaw.log` | Service logs (X operation logs) | Ignored |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Container (Linux VM)                                       │
│  └── ipc-mcp-stdio.ts → MCP tools (x_post_pending, etc.)   │
│      └── Writes IPC request to /workspace/ipc/tasks/        │
└──────────────────────┬──────────────────────────────────────┘
                       │ IPC (file system)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Host                                                       │
│  └── src/ipc.ts → processTaskIpc()                         │
│      └── host.ts → handleXIpc()                            │
│          └── lib/api.ts → Twitter API v2 (OAuth 1.0a)      │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
.claude/skills/x-integration/
├── SKILL.md          # This documentation
├── host.ts           # Host-side IPC handler
├── agent.ts          # Container-side MCP tool definitions (legacy)
└── lib/
    └── api.ts        # Twitter API v2 client (OAuth 1.0a)
```

### Integration Points

**1. Host side: `src/ipc.ts`**

Add import:

```typescript
import { handleXIpc } from '../.claude/skills/x-integration/host.js';
```

Modify `processTaskIpc` switch default case:

```typescript
default:
  const handled = await handleXIpc(data, sourceGroup, isMain, DATA_DIR);
  if (!handled) {
    logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
```

**2. Container side: `container/agent-runner/src/ipc-mcp-stdio.ts`**

The X tools (`x_post_pending`, `x_get_mentions`) are already built into `ipc-mcp-stdio.ts` in the main codebase — no additional container changes needed.

**3. Build script: `container/build.sh`**

Change build context from `container/` to project root:

```bash
cd "$SCRIPT_DIR/.."
docker build -t "${IMAGE_NAME}:${TAG}" -f container/Dockerfile .
```

**4. Dockerfile: `container/Dockerfile`**

Update COPY paths for project-root build context:

```dockerfile
COPY container/agent-runner/package*.json ./
COPY container/agent-runner/ ./
```

## Setup

### 1. Obtain Twitter API Credentials

1. Go to [developer.twitter.com](https://developer.twitter.com/en/portal/dashboard)
2. Create or select an App
3. Set **App permissions** to **Read and Write**
4. Under **Keys and tokens**, generate:
   - API Key and Secret (consumer key/secret)
   - Access Token and Secret (for your account)
5. Ensure tokens are for OAuth 1.0a (not Bearer Token / OAuth 2.0)

### 2. Configure `.env`

```bash
X_API_KEY=your_consumer_key
X_API_SECRET=your_consumer_secret
X_ACCESS_TOKEN=your_access_token
X_ACCESS_TOKEN_SECRET=your_access_token_secret
```

### 3. Rebuild and Restart

```bash
./container/build.sh
npm run build
systemctl --user restart nanoclaw  # Linux
```

## Usage via Telegram

Replace `@Jarvis` with your configured trigger name:

```
@Jarvis post a tweet: Hello world!

@Jarvis like this tweet https://x.com/user/status/123

@Jarvis reply to https://x.com/user/status/123 with: Great post!

@Jarvis retweet https://x.com/user/status/123

@Jarvis quote https://x.com/user/status/123 with comment: Interesting

@Jarvis check my mentions
```

**Note:** Only the main group can use X tools. Other groups will receive an error.

### Approval Flow (`x_post_pending`)

Automated/scheduled posts go through approval:

1. Agent calls `x_post_pending` with tweet draft
2. Bot sends message to Telegram: `📝 Tweet pendente:\n\n[content]\n\nResponda: "ok", "edita: [novo texto]", ou "cancela"`
3. User replies within 30 minutes:
   - `ok` — posts as-is
   - `edita: [new text]` — replaces content and posts
   - `cancela` — discards without posting
4. Timeout (30 min) — auto-cancelled

## Testing

### Test API Connection

```bash
# Verify credentials work
node -e "
const crypto = require('crypto');
// Quick OAuth 1.0a test — just verify env vars are set
const vars = ['X_API_KEY','X_API_SECRET','X_ACCESS_TOKEN','X_ACCESS_TOKEN_SECRET'];
const missing = vars.filter(v => !process.env[v]);
console.log(missing.length ? 'Missing: ' + missing.join(', ') : 'All credentials set');
"
```

### Test via Telegram

Send to your main group:

```
@Jarvis post a tweet: API integration test - please ignore
```

Check logs:

```bash
grep -i "x_post\|x_like\|handleXIpc\|twitter" /tmp/nanoclaw.log | tail -20
```

## Troubleshooting

### 403 Forbidden on Post

- Verify App has **Read and Write** permissions (not Read-only)
- Regenerate Access Token **after** changing permissions
- Confirm using OAuth 1.0a tokens (not OAuth 2.0 Bearer Token)

### x_post_pending Timeout

- Default timeout: 30 minutes
- If no response in 30 min, tweet is auto-cancelled
- Check `store/messages.db` table `pending_approvals` for stuck entries

### MCP Tools Not Found in Container

```bash
# Rebuild container
./container/build.sh

# Verify ipc-mcp-stdio.js is compiled
docker run --rm nanoclaw-agent ls /tmp/dist/ipc-mcp-stdio.js
```

### Check IPC Directory

```bash
ls /tmp/nanoclaw-ipc/telegram_main/tasks/ 2>/dev/null
ls /tmp/nanoclaw-ipc/telegram_main/x_results/ 2>/dev/null
```

## Security

- API credentials stored in `.env` (never committed)
- Only main group can use X tools (enforced in `ipc-mcp-stdio.ts` and `host.ts`)
- No browser profile or session cookies — stateless OAuth 1.0a per request
