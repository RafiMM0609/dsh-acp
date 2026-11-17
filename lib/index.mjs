/**
 * Generic Multi-Engine Agent Client Protocol (ACP) adapter for DeepSeek Harness (DSH).
 *
 * Implements the DSH LlmAdapter contract and manages multiple ACP server daemons
 * over stdio JSON-RPC (inspired by T3 Code packages/provider-acp and packages/provider-acp-registry).
 *
 * Supports:
 *  - Google Antigravity (Gemini 3.8 Flash, Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B)
 *  - Anthropic Claude Code ACP
 *  - OpenAI Codex ACP
 *  - Custom third-party ACP servers
 *
 * @module dsh-plugin-antigravity-acp
 */

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { expandHome } from './paths.mjs';
import {
  createAcpWebHandler,
  loadCustomEngines,
} from './web-ui.mjs';

export const name = 'dsh-plugin-antigravity-acp';
export const inject = ['llm'];

const DEFAULT_AGY_PATH = process.platform === 'win32' ? '~/AppData/Local/agy/bin/agy.exe' : 'agy';

export const DEFAULT_ANTIGRAVITY_MODELS = [
  {
    id: 'gemini-3.8-flash-high',
    name: 'Gemini 3.8 Flash (High Thinking)',
    description: 'Google Antigravity Gemini 3.8 Flash with high reasoning effort',
    contextWindow: 1048576,
    defaultEffort: 'high',
  },
  {
    id: 'gemini-3.8-flash-medium',
    name: 'Gemini 3.8 Flash (Medium Thinking)',
    description: 'Google Antigravity Gemini 3.8 Flash with medium reasoning effort',
    contextWindow: 1048576,
    defaultEffort: 'medium',
  },
  {
    id: 'gemini-3.8-flash-low',
    name: 'Gemini 3.8 Flash (Low Thinking)',
    description: 'Google Antigravity Gemini 3.8 Flash with low reasoning effort',
    contextWindow: 1048576,
    defaultEffort: 'low',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (Thinking)',
    description: 'Anthropic Claude Sonnet 4.6 via Google Antigravity ACP',
    contextWindow: 1048576,
    defaultEffort: 'high',
  },
  {
    id: 'claude-opus-4-6-thinking',
    name: 'Claude Opus 4.6 (Thinking)',
    description: 'Anthropic Claude Opus 4.6 via Google Antigravity ACP',
    contextWindow: 1048576,
    defaultEffort: 'high',
  },
  {
    id: 'gpt-oss-120b-medium',
    name: 'GPT-OSS 120B (Medium)',
    description: 'OpenAI GPT-OSS 120B via Google Antigravity ACP',
    contextWindow: 1048576,
    defaultEffort: 'medium',
  },
];

/**
 * Standard-Schema v1 configuration validator.
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'acp-multi-adapter',
    validate(raw) {
      const engines = {};

      if (raw?.engines && typeof raw.engines === 'object') {
        for (const [key, eng] of Object.entries(raw.engines)) {
          if (!key || typeof eng !== 'object') continue;
          engines[key] = {
            id: key,
            name: typeof eng.name === 'string' ? eng.name : `ACP (${key})`,
            command: typeof eng.command === 'string' ? eng.command : (key === 'antigravity' ? DEFAULT_AGY_PATH : key),
            args: Array.isArray(eng.args) ? eng.args : ['acp', '--stdio', '--dangerously-skip-permissions'],
            env: eng.env && typeof eng.env === 'object' ? eng.env : {},
            models: Array.isArray(eng.models) && eng.models.length > 0
              ? eng.models
              : (key === 'antigravity' ? DEFAULT_ANTIGRAVITY_MODELS : []),
          };
        }
      }

      // Backward-compatible fallback: ensure antigravity is always present
      if (!engines.antigravity) {
        engines.antigravity = {
          id: 'antigravity',
          name: typeof raw?.providerName === 'string' ? raw.providerName : 'Google Antigravity (ACP)',
          command: typeof raw?.executablePath === 'string' ? raw.executablePath : DEFAULT_AGY_PATH,
          args: [
            'acp',
            '--stdio',
            ...(raw?.dangerouslySkipPermissions !== false ? ['--dangerously-skip-permissions'] : []),
            ...(Array.isArray(raw?.extraArgs) ? raw.extraArgs : []),
          ],
          env: {},
          models: DEFAULT_ANTIGRAVITY_MODELS,
        };
      }

      return {
        value: {
          engines,
        },
      };
    },
  },
};

class AsyncQueue {
  constructor() {
    this.items = [];
    this.resolvers = [];
  }

  push(item) {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift();
      resolve(item);
    } else {
      this.items.push(item);
    }
  }

  async next() {
    if (this.items.length > 0) {
      return this.items.shift();
    }
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}

/**
 * Manages one ACP child process instance (e.g. agy acp, claude --acp, codex-acp).
 */
export class AcpDaemon {
  constructor(engine) {
    this.engine = engine;
    this.child = null;
    this.msgId = 1;
    this.pending = new Map();
    this.activePromptHandlers = new Map(); // sessionId -> handler function
    this.sessionMap = new Map(); // dshSessionId -> { acpSessionId, currentModel, currentEffort, configOptions }
    this.initialized = false;
    this.initPromise = null;
    this.lastLatencyMs = null;
    this.lastPing = null;
  }

  async ensureStarted() {
    if (this.child && !this.child.killed && this.initialized) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      if (this.child) {
        try { this.child.kill(); } catch {}
      }

      const cwd = process.cwd();
      const isWindows = process.platform === 'win32';
      const cmd = expandHome(this.engine.command || '');
      const isScriptOrName = isWindows && (!cmd.endsWith('.exe') || !cmd.includes('\\'));

      this.child = spawn(cmd, this.engine.args || [], {
        cwd,
        stdio: ['pipe', 'pipe', 'inherit'],
        shell: isScriptOrName,
        env: {
          ...process.env,
          ...this.engine.env,
          PYTHONUNBUFFERED: '1',
        },
      });

      this.child.on('error', (err) => {
        console.error(`[acp-${this.engine.id}] child process error:`, err);
      });

      this.child.on('exit', (code, signal) => {
        console.log(`[acp-${this.engine.id}] child exited: code=${code}, signal=${signal}`);
        this.initialized = false;
        this.child = null;
        this.initPromise = null;
        for (const [id, req] of this.pending.entries()) {
          req.reject(new Error(`ACP server "${this.engine.id}" terminated unexpectedly (code: ${code})`));
        }
        this.pending.clear();
      });

      const rl = readline.createInterface({
        input: this.child.stdout,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const data = JSON.parse(line);
          if (data.id !== undefined && this.pending.has(data.id)) {
            const { resolve, reject } = this.pending.get(data.id);
            this.pending.delete(data.id);
            if (data.error) {
              reject(data.error);
            } else {
              resolve(data.result);
            }
          } else if (data.method === 'session/update') {
            const sid = data.params?.sessionId;
            const handler = this.activePromptHandlers.get(sid);
            if (handler) {
              handler(data.params?.update);
            }
          }
        } catch {}
      });

      // Handshake initialize
      const t0 = Date.now();
      await this.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'deepseek-harness', version: '0.2.2' },
      });
      this.lastLatencyMs = Date.now() - t0;
      this.lastPing = Date.now();

      this.initialized = true;
    })();

    return this.initPromise;
  }

  request(method, params) {
    const id = this.msgId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    this.child.stdin.write(payload);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
  }

  notify(method, params) {
    if (!this.child || this.child.killed) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.child.stdin.write(payload);
  }

  async getOrCreateAcpSession(dshSessionId, cwd) {
    await this.ensureStarted();
    const effectiveCwd = cwd || process.cwd();
    const key = dshSessionId || 'default-session';

    if (this.sessionMap.has(key)) {
      return this.sessionMap.get(key);
    }

    const res = await this.request('session/new', {
      cwd: effectiveCwd,
      mcpServers: [],
    });

    const info = {
      acpSessionId: res.sessionId,
      currentModel: 'gemini-3.8-flash',
      currentEffort: 'high',
      configOptions: res.configOptions || [],
      availableModels: res.models?.availableModels || [],
      isNew: true,
    };
    this.sessionMap.set(key, info);
    return info;
  }

  async discoverModels(provider) {
    const session = await this.getOrCreateAcpSession('discovery-session');
    const options = session.configOptions || [];
    const modelConfig = options.find((o) => o.category === 'model' || o.id === 'model' || o.id === 'model_name');
    if (modelConfig && Array.isArray(modelConfig.options)) {
      const flatten = entries => entries.flatMap(entry => Array.isArray(entry.options) ? flatten(entry.options) : [entry]);
      return flatten(modelConfig.options).filter(opt => typeof opt.value === 'string').map((opt) => ({
        provider,
        id: opt.value,
        name: opt.name || opt.value,
        description: opt.description || `Model ${opt.name || opt.value} via ${this.engine.name}`,
        inputModalities: ['text', 'image'],
      }));
    }
    return session.availableModels.filter(model => typeof model.modelId === 'string').map(model => ({
      provider, id: model.modelId, name: model.name || model.modelId, description: model.description,
    }));
  }

  async *stream(options) {
    const dshSessionId = options.sessionId || 'default-session';
    const cwd = options.cwd || process.cwd();
    const sessionInfo = await this.getOrCreateAcpSession(dshSessionId, cwd);
    const acpSessionId = sessionInfo.acpSessionId;

    // Handle model and thought level configuration
    let targetModel = options.model;
    let targetThoughtLevel = 'high';

    if (targetModel.startsWith('gemini-3.8-flash')) {
      if (targetModel.endsWith('-low')) targetThoughtLevel = 'low';
      else if (targetModel.endsWith('-medium')) targetThoughtLevel = 'medium';
      else targetThoughtLevel = 'high';
      targetModel = 'gemini-3.8-flash';
    }

    if (options.reasoningEffort) {
      targetThoughtLevel = options.reasoningEffort;
    }

    try {
      if (sessionInfo.currentModel !== targetModel && targetModel) {
        await this.request('session/set_config_option', {
          sessionId: acpSessionId,
          configId: 'model',
          value: targetModel,
        });
        sessionInfo.currentModel = targetModel;
      }
      if (sessionInfo.currentEffort !== targetThoughtLevel && targetThoughtLevel) {
        await this.request('session/set_config_option', {
          sessionId: acpSessionId,
          configId: 'thought_level',
          value: targetThoughtLevel,
        });
        sessionInfo.currentEffort = targetThoughtLevel;
      }
    } catch (e) {
      console.warn(`[acp-${this.engine.id}] set_config_option warning:`, e.message || e);
    }

    // Prepare prompt text
    const messages = options.messages || [];
    const lastUserMessage = messages[messages.length - 1];
    let userText = '';
    if (lastUserMessage && lastUserMessage.content) {
      if (typeof lastUserMessage.content === 'string') {
        userText = lastUserMessage.content;
      } else if (Array.isArray(lastUserMessage.content)) {
        userText = lastUserMessage.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
      }
    }

    let promptText = userText;
    if (sessionInfo.isNew && messages.length > 1) {
      // Include prior turns for seamless context handoff
      const history = messages
        .slice(0, -1)
        .map((m) => {
          const role = (m.role || 'user').toUpperCase();
          const t = typeof m.content === 'string'
            ? m.content
            : (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ');
          return `[${role}]: ${t}`;
        })
        .join('\n\n');
      promptText = `[Context from previous turns]:\n${history}\n\n[User]:\n${userText}`;
    }
    sessionInfo.isNew = false;

    // Setup streaming queue
    const queue = new AsyncQueue();
    let reasoningStarted = false;
    let reasoningEnded = false;
    let accumulatedReasoning = '';
    let textStarted = false;
    let textEnded = false;
    let accumulatedText = '';

    const updateHandler = (update) => {
      if (!update) return;
      const type = update.sessionUpdate;
      if (type === 'agent_thought_chunk' && update.content?.text) {
        queue.push({ kind: 'thought', text: update.content.text });
      } else if (type === 'agent_message_chunk' && update.content?.text) {
        queue.push({ kind: 'text', text: update.content.text });
      } else if (type === 'tool_call') {
        const title = update.title || update.name || 'tool';
        queue.push({ kind: 'tool', text: `\n> *[Tool Execution: ${title}]*\n` });
      }
    };

    this.activePromptHandlers.set(acpSessionId, updateHandler);

    let promptPromise = this.request('session/prompt', {
      sessionId: acpSessionId,
      prompt: [{ type: 'text', text: promptText }],
    });

    let finished = false;
    let promptResult = null;
    promptPromise
      .then((res) => {
        promptResult = res;
        finished = true;
        queue.push({ kind: 'done' });
      })
      .catch((err) => {
        finished = true;
        queue.push({ kind: 'error', error: err });
      });

    // Handle cancellation
    const abortHandler = () => {
      this.notify('session/cancel', { sessionId: acpSessionId });
    };
    if (options.signal) {
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      while (!finished || queue.items.length > 0) {
        const item = await queue.next();
        if (!item) break;

        if (item.kind === 'thought') {
          if (!reasoningStarted) {
            reasoningStarted = true;
            yield { type: 'block-start', index: 0, blockType: 'reasoning' };
          }
          accumulatedReasoning += item.text;
          yield { type: 'reasoning-delta', index: 0, text: item.text };
        } else if (item.kind === 'text' || item.kind === 'tool') {
          // If reasoning was active and not closed, close it first
          if (reasoningStarted && !reasoningEnded) {
            reasoningEnded = true;
            yield {
              type: 'block-end',
              index: 0,
              block: { type: 'reasoning', text: accumulatedReasoning },
            };
          }
          if (!textStarted) {
            textStarted = true;
            yield { type: 'block-start', index: 1, blockType: 'text' };
          }
          accumulatedText += item.text;
          yield { type: 'text-delta', index: 1, text: item.text };
        } else if (item.kind === 'error') {
          throw item.error;
        } else if (item.kind === 'done') {
          break;
        }
      }

      // Cleanup trailing blocks
      if (reasoningStarted && !reasoningEnded) {
        yield {
          type: 'block-end',
          index: 0,
          block: { type: 'reasoning', text: accumulatedReasoning },
        };
      }
      if (textStarted && !textEnded) {
        yield {
          type: 'block-end',
          index: 1,
          block: { type: 'text', text: accumulatedText },
        };
      } else if (!textStarted) {
        yield { type: 'block-start', index: 1, blockType: 'text' };
        yield { type: 'text-delta', index: 1, text: '' };
        yield { type: 'block-end', index: 1, block: { type: 'text', text: '' } };
      }

      // Yield token usage if available
      if (promptResult && promptResult.usage) {
        const u = promptResult.usage;
        yield {
          type: 'usage',
          usage: {
            inputTokens: u.inputTokens || 0,
            outputTokens: (u.outputTokens || 0) + (u.thoughtTokens || 0),
            totalTokens: u.totalTokens || (u.inputTokens || 0) + (u.outputTokens || 0),
            reasoningTokens: u.thoughtTokens || 0,
          },
        };
      }

      yield { type: 'finish', reason: { kind: 'stop' } };
    } finally {
      this.activePromptHandlers.delete(acpSessionId);
      if (options.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  dispose() {
    if (this.child) {
      try {
        this.child.kill();
      } catch {}
      this.child = null;
    }
    this.initialized = false;
    this.initPromise = null;
    this.pending.clear();
    this.sessionMap.clear();
  }
}

/**
 * Multi-Engine ACP Adapter implementing DSH LlmAdapter.
 */
export class MultiAcpAdapter {
  constructor(engines = {}) {
    this.engines = engines;
    this.daemons = new Map();
  }

  getDaemon(provider) {
    if (!this.daemons.has(provider)) {
      const engine = this.engines[provider];
      if (!engine) {
        throw new Error(`Unknown ACP engine provider "${provider}"`);
      }
      this.daemons.set(provider, new AcpDaemon(engine));
    }
    return this.daemons.get(provider);
  }

  providerInfo(provider) {
    const engine = this.engines[provider];
    return {
      id: provider,
      name: engine?.name || `ACP (${provider})`,
    };
  }

  providerRetryPolicy(_provider) {
    return undefined;
  }

  imageRequestPricing(_provider, _model) {
    return undefined;
  }

  async listModels(provider) {
    const engine = this.engines[provider];
    if (!engine) return [];

    if (Array.isArray(engine.models) && engine.models.length > 0) {
      return engine.models.map((m) => ({
        provider,
        id: m.id,
        name: m.name || m.id,
        description: m.description || `Model ${m.id} via ${engine.name}`,
        inputModalities: m.inputModalities || ['text', 'image'],
      }));
    }

    // Dynamic model discovery via ACP protocol
    try {
      const daemon = this.getDaemon(provider);
      return await daemon.discoverModels(provider);
    } catch (e) {
      console.warn(`[acp-multi] Model discovery failed for provider "${provider}":`, e.message || e);
      return [];
    }
  }

  async resolveModel(provider, model) {
    const engine = this.engines[provider];
    const declared = engine?.models?.find((m) => m.id === model);
    const name = declared?.name || model;

    let defaultEffort = declared?.defaultEffort || 'high';
    if (model.endsWith('-low')) defaultEffort = 'low';
    else if (model.endsWith('-medium')) defaultEffort = 'medium';

    return {
      provider,
      id: model,
      name,
      description: declared?.description || `Model ${name} via ${engine?.name || provider}`,
      context: { contextWindow: declared?.contextWindow || 1048576 },
      defaultMaxTokens: declared?.maxTokens || 65536,
      inputModalities: declared?.inputModalities || ['text', 'image'],
      reasoning: {
        efforts: [
          { id: 'low', name: 'Low' },
          { id: 'medium', name: 'Medium' },
          { id: 'high', name: 'High' },
        ],
        defaultEffort,
      },
    };
  }

  async prepareCall(provider, model, signal) {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options) => this.stream(options),
    };
  }

  async *stream(options) {
    const provider = options.provider;
    const daemon = this.getDaemon(provider);
    yield* daemon.stream(options);
  }

  dispose() {
    for (const daemon of this.daemons.values()) {
      daemon.dispose();
    }
    this.daemons.clear();
  }
}

export function apply(ctx, config) {
  // Merge engines from config with persistent custom engines
  const allEngines = { ...(config?.engines || {}) };
  try {
    const custom = loadCustomEngines();
    for (const [key, eng] of Object.entries(custom)) {
      if (!allEngines[key]) {
        allEngines[key] = eng;
      } else {
        allEngines[key] = { ...allEngines[key], ...eng };
      }
    }
  } catch (err) {
    console.warn('[acp-multi] Could not load persistent engines:', err.message);
  }

  const adapter = new MultiAcpAdapter(allEngines);
  const activeKeys = Object.keys(adapter.engines).filter((k) => !adapter.engines[k].disabled);
  console.log('[acp-multi] Loading Multi-Engine ACP plugin with active providers:', activeKeys);

  // Register all active provider routes with DSH's LLM runtime
  let registration = ctx.llm.registerAdapter(activeKeys, adapter);

  for (const key of activeKeys) {
    console.log(`[acp-multi] Registered provider "${key}" ("${adapter.engines[key].name}")`);
    ctx.logger?.info(`Registered ACP provider "${key}" ("${adapter.engines[key].name}")`);
  }

  // Inject Web UI if webServer is loaded
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    try {
      const webServer = webCtx.webServer;
      console.log('[acp-web] Registering ACP settings API');

      const handler = createAcpWebHandler({
        adapter,
        createDaemon: engine => new AcpDaemon(engine),
        getRegistration: () => registration,
        setRegistration: (reg) => {
          registration = reg;
        },
        ctx: webCtx,
      });

      const disposeRoute = webServer.register({
        kind: 'prefix',
        path: '/api/acp',
        handler: (req, res) => {
          if (!webCtx.connection.authorizeIndex(req, res)) return;
          const requestOrigin = `${webServer.protocol}//${req.headers.host}`;
          if (req.method !== 'GET' && req.headers.origin !== requestOrigin) {
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request origin does not match this host' }));
            return;
          }
          return handler(req, res);
        },
      });

      webCtx.effect(() => () => {
        try {
          disposeRoute();
        } catch {}
        console.log('[acp-web] Disposed ACP Web UI route');
      });
    } catch (e) {
      console.warn('[acp-web] Failed to register web UI:', e.message);
    }
  });

  ctx.effect(() => () => {
    try {
      registration();
    } catch {}
    adapter.dispose();
    ctx.logger?.info('Multi-Engine ACP adapter disposed');
  });
}

export default {
  name,
  inject,
  Config,
  apply,
};
