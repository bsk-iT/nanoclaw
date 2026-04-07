/**
 * NanoClaw Agent Runner (OpenCode edition)
 * Runs inside a container, receives config via stdin, outputs result to stdout
 *
 * Replaces the Anthropic Claude Agent SDK with the OpenCode CLI,
 * enabling use with GitHub Copilot Pro+ (no Anthropic API key needed).
 *
 * Input protocol:
 *   Stdin: Full ContainerInput JSON (read until EOF)
 *   IPC:   Follow-up messages written as JSON files to /workspace/ipc/input/
 *          Files: {type:"message", text:"..."}.json — polled and consumed
 *          Sentinel: /workspace/ipc/input/_close — signals session end
 *
 * Stdout protocol:
 *   Each result is wrapped in OUTPUT_START_MARKER / OUTPUT_END_MARKER pairs.
 *   Multiple results may be emitted (one per query).
 *   Final marker after loop ends signals completion.
 *
 * OpenCode invocation:
 *   opencode run --session <id> --format json --dir /workspace/group \
 *     --model github-copilot/claude-sonnet-4-5 "<prompt>"
 */

import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { fileURLToPath } from 'url';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  script?: string;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_POLL_MS = 500;

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

/**
 * Default model to use via GitHub Copilot.
 * Can be overridden via OPENCODE_MODEL env var.
 */
const DEFAULT_MODEL = process.env.OPENCODE_MODEL ?? 'github-copilot/claude-sonnet-4-5';

// ---------------------------------------------------------------------------
// Logging / output helpers
// ---------------------------------------------------------------------------

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

// ---------------------------------------------------------------------------
// Stdin
// ---------------------------------------------------------------------------

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// IPC helpers (unchanged from original — file-based polling)
// ---------------------------------------------------------------------------

function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }
    return true;
  }
  return false;
}

function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs
      .readdirSync(IPC_INPUT_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        log(`Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`);
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) { resolve(null); return; }
      const messages = drainIpcInput();
      if (messages.length > 0) { resolve(messages.join('\n')); return; }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

// ---------------------------------------------------------------------------
// Conversation archiving (Markdown — ported from original, adapted for
// OpenCode JSON event format)
// ---------------------------------------------------------------------------

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Parse OpenCode JSON event lines into simple user/assistant messages.
 * OpenCode --format json emits one JSON object per line.
 * We capture assistant "text" parts from "assistant" events.
 */
function parseOpencodeEvents(events: string[]): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  for (const line of events) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      // User message echo
      if (ev.type === 'message' && ev.role === 'user') {
        const text = typeof ev.content === 'string'
          ? ev.content
          : (ev.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
        if (text) messages.push({ role: 'user', content: text });
      }
      // Assistant text part
      if (ev.type === 'message' && ev.role === 'assistant') {
        const text = typeof ev.content === 'string'
          ? ev.content
          : (ev.content ?? [])
              .filter((c: { type: string }) => c.type === 'text')
              .map((c: { text: string }) => c.text)
              .join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch { /* skip non-JSON lines */ }
  }
  return messages;
}

function formatTranscriptMarkdown(
  messages: ParsedMessage[],
  title?: string | null,
  assistantName?: string,
): string {
  const now = new Date();
  const formatDateTime = (d: Date) =>
    d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

  const lines: string[] = [];
  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : assistantName || 'Assistant';
    const content = msg.content.length > 2000 ? msg.content.slice(0, 2000) + '...' : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }
  return lines.join('\n');
}

function archiveConversation(
  eventLines: string[],
  assistantName?: string,
): void {
  try {
    const messages = parseOpencodeEvents(eventLines);
    if (messages.length === 0) return;

    const conversationsDir = '/workspace/group/conversations';
    fs.mkdirSync(conversationsDir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const time = new Date();
    const fallbackName = `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
    const filename = `${date}-${fallbackName}.md`;
    const filePath = path.join(conversationsDir, filename);

    const markdown = formatTranscriptMarkdown(messages, null, assistantName);
    fs.writeFileSync(filePath, markdown);
    log(`Archived conversation to ${filePath}`);
  } catch (err) {
    log(`Failed to archive conversation: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// OpenCode runner
// ---------------------------------------------------------------------------

interface QueryResult {
  newSessionId?: string;
  assistantText: string;
  closedDuringQuery: boolean;
  eventLines: string[];
}

/**
 * Run a single opencode query via CLI subprocess.
 *
 * opencode run --session <id> --format json --dir /workspace/group \
 *   --model <model> "<prompt>"
 *
 * stdout: JSON events, one per line.
 *   - Events with `sessionId` field → capture as newSessionId
 *   - Events with type "message" and role "assistant" → capture text
 *
 * IPC messages that arrive while the query is running are buffered and
 * returned so the outer loop can feed them back as the next query.
 *
 * Concurrent _close sentinel → kills the process and sets closedDuringQuery.
 */
async function runQuery(
  prompt: string,
  sessionId: string | undefined,
  mcpServerPath: string,
  containerInput: ContainerInput,
): Promise<QueryResult> {
  // Build opencode CLI args
  const args: string[] = ['run', '--format', 'json', '--dir', '/workspace/group'];

  if (sessionId) {
    args.push('--session', sessionId);
  }

  args.push('--model', DEFAULT_MODEL);
  args.push(prompt);

  // MCP server for NanoClaw IPC tools — passed via env (opencode picks up from config)
  // We write a temporary opencode config override so the MCP server is registered.
  const opencodeConfigDir = '/home/node/.config/opencode';
  fs.mkdirSync(opencodeConfigDir, { recursive: true });
  const opencodeConfig = {
    model: DEFAULT_MODEL,
    mcp: {
      servers: {
        nanoclaw: {
          command: 'node',
          args: [mcpServerPath],
          environment: {
            NANOCLAW_CHAT_JID: containerInput.chatJid,
            NANOCLAW_GROUP_FOLDER: containerInput.groupFolder,
            NANOCLAW_IS_MAIN: containerInput.isMain ? '1' : '0',
          },
        },
      },
    },
  };
  fs.writeFileSync(
    path.join(opencodeConfigDir, 'config.json'),
    JSON.stringify(opencodeConfig, null, 2),
  );

  log(`Spawning opencode: opencode ${args.join(' ')}`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Ensure Copilot auth token is available
    HOME: '/home/node',
    XDG_CONFIG_HOME: '/home/node/.config',
  };

  return new Promise((resolve) => {
    const proc = spawn('opencode', args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Close stdin immediately — we pass the prompt as a CLI arg
    proc.stdin.end();

    let newSessionId: string | undefined;
    let assistantText = '';
    const eventLines: string[] = [];
    let closedDuringQuery = false;
    let ipcPolling = true;

    // Poll IPC for _close or new messages during the query
    const pollIpc = () => {
      if (!ipcPolling) return;
      if (shouldClose()) {
        log('Close sentinel detected during query, killing opencode process');
        closedDuringQuery = true;
        ipcPolling = false;
        proc.kill('SIGTERM');
        return;
      }
      // Drain messages — they will be returned for the next iteration
      // (we don't support injecting mid-query; each message = new process)
      setTimeout(pollIpc, IPC_POLL_MS);
    };
    setTimeout(pollIpc, IPC_POLL_MS);

    // Parse stdout: one JSON event per line
    let lineBuffer = '';
    proc.stdout.on('data', (data: Buffer) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? ''; // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        eventLines.push(trimmed);

        try {
          const ev = JSON.parse(trimmed);

          // Capture session ID from any event that carries it
          if (ev.sessionID && !newSessionId) {
            newSessionId = ev.sessionID as string;
            log(`Session ID: ${newSessionId}`);
          }
          if (ev.session_id && !newSessionId) {
            newSessionId = ev.session_id as string;
            log(`Session ID: ${newSessionId}`);
          }

          // Accumulate assistant text
          if (ev.type === 'message' && ev.role === 'assistant') {
            const text = typeof ev.content === 'string'
              ? ev.content
              : (ev.content ?? [])
                  .filter((c: { type: string }) => c.type === 'text')
                  .map((c: { text: string }) => c.text)
                  .join('');
            if (text) assistantText += (assistantText ? '\n' : '') + text;
          }
        } catch { /* non-JSON line — log line, skip */ }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) log(`[opencode stderr] ${msg}`);
    });

    proc.on('close', (code) => {
      ipcPolling = false;
      log(`opencode exited with code ${code}`);
      resolve({ newSessionId, assistantText, closedDuringQuery, eventLines });
    });

    proc.on('error', (err) => {
      ipcPolling = false;
      log(`opencode spawn error: ${err.message}`);
      resolve({ newSessionId: undefined, assistantText: '', closedDuringQuery: false, eventLines: [] });
    });
  });
}

// ---------------------------------------------------------------------------
// Script runner (unchanged from original)
// ---------------------------------------------------------------------------

interface ScriptResult {
  wakeAgent: boolean;
  data?: unknown;
}

const SCRIPT_TIMEOUT_MS = 30_000;

async function runScript(script: string): Promise<ScriptResult | null> {
  const scriptPath = '/tmp/task-script.sh';
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  return new Promise((resolve) => {
    execFile(
      'bash',
      [scriptPath],
      { timeout: SCRIPT_TIMEOUT_MS, maxBuffer: 1024 * 1024, env: process.env },
      (error, stdout, stderr) => {
        if (stderr) log(`Script stderr: ${stderr.slice(0, 500)}`);
        if (error) { log(`Script error: ${error.message}`); return resolve(null); }

        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        if (!lastLine) { log('Script produced no output'); return resolve(null); }

        try {
          const result = JSON.parse(lastLine);
          if (typeof result.wakeAgent !== 'boolean') {
            log(`Script output missing wakeAgent boolean: ${lastLine.slice(0, 200)}`);
            return resolve(null);
          }
          resolve(result as ScriptResult);
        } catch {
          log(`Script output is not valid JSON: ${lastLine.slice(0, 200)}`);
          resolve(null);
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    try { fs.unlinkSync('/tmp/input.json'); } catch { /* may not exist */ }
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(__dirname, 'ipc-mcp-stdio.js');

  let sessionId = containerInput.sessionId;
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });

  // Clean up stale _close sentinel from previous container runs
  try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }

  // Build initial prompt
  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }
  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  // Inject global AGENTS.md as additional context for non-main groups
  const globalAgentsMdPath = '/workspace/global/AGENTS.md';
  if (!containerInput.isMain && fs.existsSync(globalAgentsMdPath)) {
    const globalCtx = fs.readFileSync(globalAgentsMdPath, 'utf-8');
    prompt = `[Global context from AGENTS.md]\n${globalCtx}\n\n---\n\n${prompt}`;
  }

  // Script phase: run script before waking agent
  if (containerInput.script && containerInput.isScheduledTask) {
    log('Running task script...');
    const scriptResult = await runScript(containerInput.script);

    if (!scriptResult || !scriptResult.wakeAgent) {
      const reason = scriptResult ? 'wakeAgent=false' : 'script error/no output';
      log(`Script decided not to wake agent: ${reason}`);
      writeOutput({ status: 'success', result: null });
      return;
    }

    log(`Script wakeAgent=true, enriching prompt with data`);
    prompt = `[SCHEDULED TASK]\n\nScript output:\n${JSON.stringify(scriptResult.data, null, 2)}\n\nInstructions:\n${containerInput.prompt}`;
  }

  // Query loop: run query → wait for IPC message → run new query → repeat
  try {
    while (true) {
      log(`Starting query (session: ${sessionId || 'new'})...`);

      const result = await runQuery(prompt, sessionId, mcpServerPath, containerInput);

      if (result.newSessionId) {
        sessionId = result.newSessionId;
      }

      // Archive conversation on each completed query turn
      if (result.eventLines.length > 0) {
        archiveConversation(result.eventLines, containerInput.assistantName);
      }

      // Emit result
      writeOutput({
        status: 'success',
        result: result.assistantText || null,
        newSessionId: sessionId,
      });

      // If _close was consumed during the query, exit immediately
      if (result.closedDuringQuery) {
        log('Close sentinel consumed during query, exiting');
        break;
      }

      // Emit session update so host can track idle state
      writeOutput({ status: 'success', result: null, newSessionId: sessionId });

      log('Query ended, waiting for next IPC message...');

      // Wait for next message or _close sentinel
      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId: sessionId,
      error: errorMessage,
    });
    process.exit(1);
  }
}

main();
