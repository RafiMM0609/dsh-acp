/**
 * Management API for the native DSH ACP Settings panel.
 *
 * Tests, configures, and reloads ACP provider engines for the browser plugin.
 *
 * @module dsh-plugin-antigravity-acp/web-ui
 */

import { spawn, execSync } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_FILE_PATH = path.join(os.homedir(), '.dsh', 'acp-engines.json');

/**
 * Standard templates for popular ACP-compatible engines.
 */
export const ENGINE_PRESETS = [
  {
    id: 'antigravity',
    name: 'Google Antigravity (ACP)',
    description: 'Gemini 3.8 Flash, Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B via Google Antigravity ACP',
    command: 'C:\\Users\\5CG4292WTR\\AppData\\Local\\agy\\bin\\agy.exe',
    args: ['acp', '--stdio', '--dangerously-skip-permissions'],
    env: {},
    models: [
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High Thinking)', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium Thinking)', contextWindow: 1048576, defaultEffort: 'medium' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low Thinking)', contextWindow: 1048576, defaultEffort: 'low' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)', contextWindow: 1048576, defaultEffort: 'medium' },
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode (ACP)',
    description: 'DeepSeek V4.1, Claude Fable 5.2, GPT-5.5, Kimi K3, Qwen4 via OpenCode ACP CLI',
    command: 'opencode',
    args: ['acp'],
    env: {},
    models: [
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'claude-fable-5-2', name: 'Claude Fable 5.2 (Thinking)', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'gpt-5-5-preview', name: 'GPT-5.5 Preview (Thinking)', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'kimi-k3-max', name: 'Kimi K3 Max', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'qwen4-max', name: 'Qwen4 Max (Thinking)', contextWindow: 1048576, defaultEffort: 'high' },
    ],
  },
  {
    id: 'codex',
    name: 'OpenAI Codex (App Server)',
    description: 'OpenAI Codex Coding Agent via stdio JSON-RPC app-server',
    command: 'C:\\Users\\5CG4292WTR\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe',
    args: ['app-server'],
    env: {},
    models: [
      { id: 'codex-5.2-coder', name: 'Codex 5.2 Coder', contextWindow: 262144, defaultEffort: 'high' },
      { id: 'codex-mini', name: 'Codex Mini Flash', contextWindow: 131072, defaultEffort: 'medium' },
    ],
  },
  {
    id: 'pi',
    name: 'Pi Coding Agent (RPC)',
    description: 'Pi Multi-Provider AI coding assistant via stdio RPC',
    command: 'pi',
    args: ['--mode', 'rpc'],
    env: {},
    models: [
      { id: 'pi-agent-default', name: 'Pi Default Agent', contextWindow: 200000, defaultEffort: 'high' },
    ],
  },
  {
    id: 'claude',
    name: 'Anthropic Claude Code (ACP)',
    description: 'Anthropic Claude Code CLI via Agent Client Protocol',
    command: 'claude',
    args: ['acp'],
    env: {},
    models: [
      { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet (Thinking)', contextWindow: 200000, defaultEffort: 'high' },
    ],
  },
  {
    id: 'custom',
    name: 'Custom ACP Server',
    description: 'Any custom CLI or local daemon speaking stdio JSON-RPC / ACP',
    command: '',
    args: ['--stdio'],
    env: {},
    models: [
      { id: 'custom-model-1', name: 'Custom Model 1', contextWindow: 131072, defaultEffort: 'high' },
    ],
  },
];

/**
 * Load persistent engine configurations from ~/.dsh/acp-engines.json
 */
export function loadCustomEngines() {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const data = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('[acp-web] Failed to read persistent acp-engines.json:', err.message);
  }
  return {};
}

/**
 * Save persistent engine configurations to ~/.dsh/acp-engines.json
 */
export function saveCustomEngines(engines) {
  try {
    const dir = path.dirname(CONFIG_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(engines, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[acp-web] Failed to save persistent acp-engines.json:', err.message);
    return false;
  }
}

/**
 * Probe an ACP or JSON-RPC stdio daemon by performing a live initialize handshake.
 */
export async function probeEngine(command, args = [], env = {}, timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve) => {
    let resolved = false;
    const isWindows = process.platform === 'win32';
    const isScript = isWindows && !command.endsWith('.exe') && !command.includes('\\') && !command.includes('/');

    let child;
    try {
      child = spawn(command, args, {
        shell: isScript,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      });
    } catch (err) {
      return resolve({ ok: false, error: `Failed to spawn: ${err.message}`, latencyMs: 0 });
    }

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { child.kill(); } catch {}
        resolve({ ok: false, error: `Probe timed out after ${timeoutMs}ms`, latencyMs: timeoutMs });
      }
    }, timeoutMs);

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message, latencyMs: Date.now() - start });
      }
    });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id === 1) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            const latencyMs = Date.now() - start;
            try { child.kill(); } catch {}
            resolve({
              ok: !msg.error,
              latencyMs,
              result: msg.result,
              error: msg.error ? (msg.error.message || JSON.stringify(msg.error)) : undefined,
            });
          }
        }
      } catch {}
    });

    // Send ACP initialize request
    const initReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientInfo: { name: 'dsh-acp-probe', version: '1.0.0' },
        capabilities: {},
      },
    }) + '\n';

    try {
      child.stdin.write(initReq);
    } catch (err) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ ok: false, error: `Failed to write stdin: ${err.message}`, latencyMs: 0 });
      }
    }
  });
}

/**
 * Scan system for installed ACP-compatible CLIs.
 */
export function scanSystemEngines() {
  const results = [];
  const candidates = [
    {
      id: 'antigravity',
      name: 'Google Antigravity',
      defaultPath: 'C:\\Users\\5CG4292WTR\\AppData\\Local\\agy\\bin\\agy.exe',
      command: 'agy',
      args: ['acp', '--stdio', '--dangerously-skip-permissions'],
      presetId: 'antigravity',
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      defaultPath: null,
      command: 'opencode',
      args: ['acp'],
      presetId: 'opencode',
    },
    {
      id: 'codex',
      name: 'OpenAI Codex',
      defaultPath: 'C:\\Users\\5CG4292WTR\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe',
      command: 'codex',
      args: ['app-server'],
      presetId: 'codex',
    },
    {
      id: 'pi',
      name: 'Pi Coding Agent',
      defaultPath: null,
      command: 'pi',
      args: ['--mode', 'rpc'],
      presetId: 'pi',
    },
    {
      id: 'claude',
      name: 'Anthropic Claude Code',
      defaultPath: null,
      command: 'claude',
      args: ['acp'],
      presetId: 'claude',
    },
  ];

  for (const c of candidates) {
    let installed = false;
    let resolvedPath = null;

    if (c.defaultPath && fs.existsSync(c.defaultPath)) {
      installed = true;
      resolvedPath = c.defaultPath;
    } else {
      try {
        const out = execSync(`where.exe ${c.command}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        const firstLine = out.trim().split('\n')[0]?.trim();
        if (firstLine) {
          installed = true;
          resolvedPath = firstLine;
        }
      } catch {}
    }

    results.push({
      ...c,
      installed,
      resolvedPath: resolvedPath || c.defaultPath || c.command,
    });
  }

  return results;
}

/**
 * Parse JSON body from HTTP request.
 */
async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache, no-store',
  });
  res.end(JSON.stringify(data));
}

/**
 * Creates the management handler served under `/api/acp/*`.
 */
export function createAcpWebHandler(context) {
  const { adapter, getRegistration, setRegistration, ctx } = context;

  return async function handleAcpRequest(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const p = url.pathname.replace(/^\/api\/acp(?=\/|$)/, '/acp/api');

      // GET /acp/api/engines -> Live engine status & models
      if (req.method === 'GET' && p === '/acp/api/engines') {
        const enginesList = [];
        const persistentConfig = loadCustomEngines();

        for (const [key, engine] of Object.entries(adapter.engines)) {
          const daemon = adapter.daemons.get(key);
          const isAlive = daemon && daemon.child && !daemon.child.killed && daemon.child.exitCode === null;
          const isCustom = Boolean(persistentConfig[key]);

          enginesList.push({
            id: key,
            name: engine.name || key,
            command: engine.command,
            args: engine.args || [],
            env: engine.env || {},
            models: engine.models || [],
            disabled: Boolean(engine.disabled),
            isCustom,
            daemon: {
              running: Boolean(isAlive),
              pid: isAlive ? daemon.child.pid : null,
              hasChild: Boolean(daemon?.child),
              lastPing: daemon?.lastPing || null,
              latencyMs: daemon?.lastLatencyMs || null,
            },
          });
        }

        return sendJson(res, 200, {
          ok: true,
          engines: enginesList,
          presets: ENGINE_PRESETS,
          installedScan: scanSystemEngines(),
        });
      }

      // POST /acp/api/probe -> Run live handshake probe
      if (req.method === 'POST' && p === '/acp/api/probe') {
        const body = await parseJsonBody(req);
        const { command, args, env } = body;
        if (!command) {
          return sendJson(res, 400, { ok: false, error: 'Command executable is required' });
        }
        const result = await probeEngine(command, args || [], env || {}, 6000);
        return sendJson(res, 200, result);
      }

      // POST /acp/api/save -> Add or update engine config
      if (req.method === 'POST' && p === '/acp/api/save') {
        const body = await parseJsonBody(req);
        const { id, name, command, args, env, models, disabled } = body;

        if (!id || !command) {
          return sendJson(res, 400, { ok: false, error: 'Engine ID and command are required' });
        }

        const engineKey = String(id).trim().toLowerCase();
        const updatedEngine = {
          id: engineKey,
          name: name?.trim() || `ACP (${engineKey})`,
          command: String(command).trim(),
          args: Array.isArray(args) ? args : String(args || '').split(' ').filter(Boolean),
          env: env && typeof env === 'object' ? env : {},
          models: Array.isArray(models) && models.length > 0 ? models : [
            { id: `${engineKey}-default`, name: `${name || engineKey} Default`, contextWindow: 1048576, defaultEffort: 'high' },
          ],
          disabled: Boolean(disabled),
        };

        // Update in adapter
        const oldDaemon = adapter.daemons.get(engineKey);
        if (oldDaemon) {
          oldDaemon.dispose();
          adapter.daemons.delete(engineKey);
        }
        adapter.engines[engineKey] = updatedEngine;

        // Persist to ~/.dsh/acp-engines.json
        const persistent = loadCustomEngines();
        persistent[engineKey] = updatedEngine;
        saveCustomEngines(persistent);

        // Update Cordis LLM adapter registrations
        const activeKeys = Object.keys(adapter.engines).filter((k) => !adapter.engines[k].disabled);
        const reg = getRegistration();
        if (reg?.replace) {
          try {
            reg.replace(activeKeys);
          } catch (e) {
            console.warn('[acp-web] Error replacing LLM adapter routes:', e.message);
          }
        }

        return sendJson(res, 200, { ok: true, engine: updatedEngine });
      }

      // POST /acp/api/toggle -> Toggle enabled/disabled state
      if (req.method === 'POST' && p === '/acp/api/toggle') {
        const body = await parseJsonBody(req);
        const { id, disabled } = body;
        const engine = adapter.engines[id];
        if (!engine) {
          return sendJson(res, 404, { ok: false, error: `Engine "${id}" not found` });
        }

        engine.disabled = Boolean(disabled);

        if (engine.disabled) {
          const daemon = adapter.daemons.get(id);
          if (daemon) {
            daemon.dispose();
            adapter.daemons.delete(id);
          }
        }

        // Persist
        const persistent = loadCustomEngines();
        if (persistent[id]) {
          persistent[id].disabled = engine.disabled;
          saveCustomEngines(persistent);
        }

        // Update LLM routes
        const activeKeys = Object.keys(adapter.engines).filter((k) => !adapter.engines[k].disabled);
        const reg = getRegistration();
        if (reg?.replace) {
          try {
            reg.replace(activeKeys);
          } catch (e) {
            console.warn('[acp-web] Error updating routes on toggle:', e.message);
          }
        }

        return sendJson(res, 200, { ok: true, id, disabled: engine.disabled });
      }

      // POST /acp/api/restart -> Restart engine daemon
      if (req.method === 'POST' && p === '/acp/api/restart') {
        const body = await parseJsonBody(req);
        const { id } = body;
        const daemon = adapter.daemons.get(id);
        if (daemon) {
          daemon.dispose();
          adapter.daemons.delete(id);
        }

        // Ensure started & measure ping
        const engine = adapter.engines[id];
        let pingResult = null;
        if (engine && !engine.disabled) {
          pingResult = await probeEngine(engine.command, engine.args, engine.env, 6000);
        }

        return sendJson(res, 200, { ok: true, id, ping: pingResult });
      }

      // POST /acp/api/delete -> Delete engine
      if (req.method === 'POST' && p === '/acp/api/delete') {
        const body = await parseJsonBody(req);
        const { id } = body;

        const daemon = adapter.daemons.get(id);
        if (daemon) {
          daemon.dispose();
          adapter.daemons.delete(id);
        }
        delete adapter.engines[id];

        // Persist delete
        const persistent = loadCustomEngines();
        delete persistent[id];
        saveCustomEngines(persistent);

        // Update LLM routes
        const activeKeys = Object.keys(adapter.engines).filter((k) => !adapter.engines[k].disabled);
        const reg = getRegistration();
        if (reg?.replace) {
          try {
            reg.replace(activeKeys);
          } catch (e) {
            console.warn('[acp-web] Error updating routes on delete:', e.message);
          }
        }

        return sendJson(res, 200, { ok: true, id });
      }

      // 404 for unknown /acp route
      return sendJson(res, 404, { error: 'not_found', path: p });
    } catch (err) {
      console.error('[acp-web] Handler error:', err);
      return sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  };
}
