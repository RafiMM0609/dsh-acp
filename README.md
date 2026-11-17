# ACP providers for DeepSeek Harness

Open **Settings → ACP providers** in DSH Web or Desktop to add, edit, enable, disable, remove, or test agent connections. The panel uses DSH's client module and Settings slot system. There is no separate dashboard route or floating chat button.

Each provider has an engine ID, display name, executable, JSON argument array, environment variables, and JSON model list. Saving updates the available model routes without restarting DSH. Configuration is stored on the host in `~/.dsh/acp-engines.json`; environment values are stored as plain text. Changes to a connection stop its existing daemon.

The panel uses `/api/acp/*`, protected by DSH's browser authentication. Mutation requests must come from the same origin. Restart DSH and reload the client after installing or updating this plugin's browser module.

Antigravity and OpenCode presets use ACP. Codex app-server and Pi RPC are different protocols; their appearance in an existing configuration or a successful initialize probe does not prove that chat works through this ACP adapter. The new-provider picker offers the ACP presets only. Model availability and account authentication remain controlled by the agent runtime.

Run `node --test test/settings.test.mjs` with the adjacent `deepseek-harness` checkout's dependencies installed to check the native editor's save, validation, toggle and disposal behavior.
