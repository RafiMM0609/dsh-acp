# ACP providers for DeepSeek Harness

Open **Settings → ACP providers** in DSH Web or Desktop to add, edit, enable, disable, remove, or test agent connections. The panel uses DSH's client module and Settings slot system. There is no separate dashboard route or floating chat button.

Choose a provider preset and enter a display name. The panel detects supported installed executables and creates a unique engine ID. Models are ordinary name/ID rows; **Load models from agent** opens a temporary ACP session with the agent's existing sign-in and offers the reported models as checkboxes. Review your selection and save to update the model routes. Discovery never sends a chat prompt, does not save automatically, and stops its temporary process on completion, disconnect or a 15-second timeout. If the agent reports no catalog, existing model rows remain available for manual editing.

**Advanced** contains the executable, launch arguments (one input per argument), and optional environment variables (name/value rows). Paths under the host home appear as `~/…`; an executable path entered with `~/` or `~\` is expanded on the machine running DSH before probing, discovery or chat. A command such as `agy` is resolved through that machine's PATH. Executable detection runs on the host, including for remote browser connections.

Saving updates model routes without restarting DSH. Configuration is stored on the host in `~/.dsh/acp-engines.json`; environment values are stored as plain text and masked in the editor. Changes to a connection stop its existing daemon. Manual/preset models are declarations, not proof of account access. Use discovery for an agent-reported catalog; it supports model configuration choices, grouped choices, and the ACP `models.availableModels` response. Agents without those fields still need manual model entries.

The panel uses `/api/acp/*`, protected by DSH's browser authentication. Mutation requests must come from the same origin. Restart DSH and reload the client after installing or updating this plugin's browser module.

Antigravity and OpenCode presets use ACP. Codex app-server and Pi RPC are different protocols; their appearance in an existing configuration or a successful initialize probe does not prove that chat works through this ACP adapter. The new-provider picker offers the ACP presets only. Model availability and account authentication remain controlled by the agent runtime.

Run `node --test test/*.test.mjs` with the adjacent `deepseek-harness` checkout's dependencies installed to check editing, discovery, home paths, validation and disposal.
