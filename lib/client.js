/* Browser plugin: ACP configuration lives in the DSH Settings dialog with T3 Code 3-step wizard. */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-antigravity-acp',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const ICONS = {
      codex: (size = 20) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'currentColor' },
        h('path', { d: 'M22.28 10.37a5.55 5.55 0 0 0-.47-4.47 5.68 5.68 0 0 0-4.87-2.82 5.58 5.58 0 0 0-1.74.28 5.56 5.56 0 0 0-4.14-1.86 5.67 5.67 0 0 0-5.38 3.86 5.56 5.56 0 0 0-3.37 2.45 5.68 5.68 0 0 0-.68 5.6 5.57 5.57 0 0 0 .47 4.47 5.68 5.68 0 0 0 4.87 2.82 5.58 5.58 0 0 0 1.74-.28 5.56 5.56 0 0 0 4.14 1.86 5.67 5.67 0 0 0 5.38-3.86 5.56 5.56 0 0 0 3.37-2.45 5.68 5.68 0 0 0 .68-5.6zm-1.8 4.22a4.18 4.18 0 0 1-.36 3.3 4.24 4.24 0 0 1-3.64 2.1 4.2 4.2 0 0 1-1.3-.21v-3.74a1.44 1.44 0 0 0-.72-1.25l-3.23-1.87v-1.73l4.73-2.73a4.25 4.25 0 0 1 4.52.41 4.16 4.16 0 0 1 1.44 3.72zm-7.69 7.42a4.18 4.18 0 0 1-3.32-.37 4.23 4.23 0 0 1-2.1-3.64 4.2 4.2 0 0 1 .21-1.3h3.74a1.44 1.44 0 0 0 1.25-.72l1.87-3.23h1.73v5.47a4.26 4.26 0 0 1-3.38 3.79zm-7.42-7.69a4.18 4.18 0 0 1 .37-3.32 4.23 4.23 0 0 1 3.64-2.1 4.2 4.2 0 0 1 1.3.21v3.74a1.44 1.44 0 0 0 .72 1.25l3.23 1.87v1.73l-4.73 2.73a4.25 4.25 0 0 1-4.53-.41 4.16 4.16 0 0 1-1.44-3.72zm1.8-4.22a4.18 4.18 0 0 1 .36-3.3 4.24 4.24 0 0 1 3.64-2.1 4.2 4.2 0 0 1 1.3.21v3.74a1.44 1.44 0 0 0 .72 1.25l3.23 1.87v1.73L9.7 13.91a4.25 4.25 0 0 1-4.52-.41 4.16 4.16 0 0 1-1.44-3.72zm7.69-7.42a4.18 4.18 0 0 1 3.32.37 4.23 4.23 0 0 1 2.1 3.64 4.2 4.2 0 0 1 2.1 3.64 4.2 4.2 0 0 1-.21 1.3h-3.74a1.44 1.44 0 0 0-1.25.72l-1.87 3.23H9.25V3.71a4.26 4.26 0 0 1 3.38-3.79z' })),
      claude: (size = 20) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: '#d97706' },
        h('path', { d: 'M13.8 2.2h-3.6v5.4L6.4 3.8 3.8 6.4l3.8 3.8H2.2v3.6h5.4l-3.8 3.8 2.6 2.6 3.8-3.8v5.4h3.6v-5.4l3.8 3.8 2.6-2.6-3.8-3.8h5.4v-3.6h-5.4l3.8-3.8-2.6-2.6-3.8 3.8V2.2z' })),
      cursor: (size = 20) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: '#e4e4e7', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M12 2L3 7v10l9 5 9-5V7l-9-5z' }),
        h('path', { d: 'M12 22V12' }),
        h('path', { d: 'M12 12L3 7' }),
        h('path', { d: 'M12 12l9-5' })),
      grok: (size = 20) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: '#e4e4e7', strokeWidth: '2', strokeLinecap: 'round' },
        h('circle', { cx: '12', cy: '12', r: '9' }),
        h('path', { d: 'M5 19L19 5' })),
      opencode: (size = 20) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'currentColor' },
        h('rect', { x: '3', y: '4', width: '18', height: '16', rx: '3', fill: 'none', stroke: 'currentColor', strokeWidth: '2' }),
        h('rect', { x: '6', y: '7', width: '12', height: '10', rx: '1' })),
      antigravity: (size = 20) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none' },
        h('path', { d: 'M12 2.5L2.5 21h4.8l2.1-4.2h9.2l-2.1-4.2H11.5l2.4-4.8 2.8 5.6 2.1 4.2H21.5L12 2.5z', fill: '#3b82f6' }),
        h('path', { d: 'M12 2.5l-4.5 9h9l-4.5-9z', fill: '#10b981' })),
      muse: (size = 20) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: '#0081fb', strokeWidth: '2.5', strokeLinecap: 'round' },
        h('path', { d: 'M6 16c-3 0-4-3-4-4s1-4 4-4c3 0 4 3 6 4 2-1 3-4 6-4s4 3 4 4-1 4-4 4c-3 0-4-3-6-4-2 1-3 4-6 4z' })),
      pi: (size = 20) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'currentColor' },
        h('rect', { x: '4', y: '5', width: '16', height: '3', rx: '1' }),
        h('path', { d: 'M8 8v11M16 8v11', stroke: 'currentColor', strokeWidth: '2.5', strokeLinecap: 'round' })),
      custom: (size = 20) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round' },
        h('circle', { cx: '12', cy: '12', r: '3' }),
        h('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' })),
      check: (size = 14) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: '#fff', strokeWidth: '3', strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M20 6L9 17l-5-5' })),
      info: (size = 16) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: '#3b82f6', strokeWidth: '2', strokeLinecap: 'round' },
        h('circle', { cx: '12', cy: '12', r: '10' }),
        h('line', { x1: '12', y1: '16', x2: '12', y2: '12' }),
        h('line', { x1: '12', y1: '8', x2: '12.01', y2: '8' })),
      close: (size = 18) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round' },
        h('path', { d: 'M18 6L6 18M6 6l12 12' })),
    };

    const ACCENT_COLORS = ['#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#f97316'];

    const empty = {
      id: '', name: '', command: '', args: ['acp'], env: [], models: [], disabled: false,
      presetId: 'codex', configDirVar: 'CODEX_HOME', configDir: '~/.codex',
      autoCompactTokens: '', compactIdleThreads: 'default', accentColor: '#3b82f6',
    };

    async function request(action, body, signal) {
      const response = await fetch(`/api/acp/${action}`, {
        credentials: 'same-origin', signal,
        ...(body === undefined ? {} : {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || `ACP request failed (${response.status})`);
      if (!data.ok) throw new Error(data.error || data.message || 'ACP operation failed');
      return data;
    }

    function AcpSettings() {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [draft, setDraft] = React.useState(null);
      const [originalId, setOriginalId] = React.useState(null);
      const [wizardStep, setWizardStep] = React.useState(1);
      const [showMore, setShowMore] = React.useState(false);
      const [selectedModels, setSelectedModels] = React.useState(null);
      const pending = React.useRef(null);

      const edit = (engine, existing = false) => {
        setOriginalId(existing ? engine.id : null);
        const preset = data?.presets?.find(p => p.id === engine.presetId || p.id === engine.id)
          || data?.presets?.find(p => p.id === 'codex')
          || data?.presets?.[0];
        const detected = data?.installedScan?.find(item => item.id === (engine.presetId || engine.id) && item.installed);
        const configDirVar = engine.configDirVar || preset?.configDirVar || 'CONFIG_DIR';
        const configDir = engine.configDir || (configDirVar && engine.env?.[configDirVar]) || preset?.defaultConfigDir || '';

        setDraft({
          ...empty,
          ...engine,
          presetId: engine.presetId || preset?.id || 'custom',
          name: existing ? engine.name : (engine.name || preset?.name || ''),
          id: existing ? engine.id : (engine.id || preset?.id || ''),
          command: existing ? engine.command : (detected?.resolvedPath || engine.command || preset?.command || ''),
          configDirVar,
          configDir,
          autoCompactTokens: engine.autoCompactTokens !== undefined ? engine.autoCompactTokens : '',
          compactIdleThreads: engine.compactIdleThreads || 'default',
          accentColor: engine.accentColor || '#3b82f6',
          args: [...(engine.args || preset?.args || ['acp'])],
          env: Array.isArray(engine.env)
            ? engine.env
            : Object.entries(engine.env || {}).filter(([k]) => k !== configDirVar).map(([name, value]) => ({ name, value })),
          models: (engine.models || preset?.models || []).map(m => ({ ...m })),
        });
        setWizardStep(existing ? 2 : 1);
        setSelectedModels(null);
        setError(''); setNotice('');
      };

      const selectPreset = (preset) => {
        const detected = data?.installedScan?.find(item => item.id === preset.id && item.installed);
        setDraft(curr => ({
          ...curr,
          presetId: preset.id,
          name: preset.name,
          id: curr.id && originalId ? curr.id : preset.id,
          command: detected?.resolvedPath || preset.command || '',
          configDirVar: preset.configDirVar || 'CONFIG_DIR',
          configDir: preset.defaultConfigDir || '',
          args: [...(preset.args || ['acp'])],
          models: (preset.models || []).map(m => ({ ...m })),
        }));
      };

      async function run(operation) {
        if (pending.current) return;
        const controller = new AbortController();
        pending.current = controller;
        setBusy(true); setError(''); setNotice('');
        try { await operation(controller.signal); }
        catch (err) { if (!controller.signal.aborted) setError(err.message); }
        finally {
          if (pending.current === controller) { pending.current = null; setBusy(false); }
        }
      }

      const reload = signal => request('engines', undefined, signal).then(setData);

      React.useEffect(() => {
        run(reload);
        return () => { pending.current?.abort(); pending.current = null; };
      }, []);

      const parsed = () => {
        const baseId = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider';
        let id = originalId || draft.id || (/^[a-z]/.test(baseId) ? baseId : `provider-${baseId}`);
        if (!originalId) {
          const stem = id;
          for (let suffix = 2; data?.engines.some(engine => engine.id === id); suffix++) id = `${stem}-${suffix}`;
        }
        const env = {};
        for (const row of draft.env) {
          if (!row.name.trim() && !row.value) continue;
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name)) throw new Error('Enter a valid environment variable name.');
          if (Object.hasOwn(env, row.name)) throw new Error(`Variable ${row.name} is listed twice.`);
          Object.defineProperty(env, row.name, { value: row.value, enumerable: true });
        }
        if (draft.configDirVar && draft.configDir) {
          env[draft.configDirVar] = draft.configDir;
        }
        if (!draft.name.trim()) throw new Error('Enter a display name.');
        if (!draft.models.every(model => model.id.trim())) throw new Error('Enter an ID for each model, or remove the empty row.');
        if (new Set(draft.models.map(model => model.id.trim())).size !== draft.models.length) throw new Error('Each model ID must be unique.');
        if (!draft.command.trim()) throw new Error('Executable is required.');

        return {
          ...draft,
          id,
          env,
          models: draft.models.map(model => ({ ...model, id: model.id.trim(), name: model.name?.trim() || model.id.trim() })),
        };
      };

      const button = (label, onClick, variant = 'default', extraProps = {}) =>
        h('button', { type: 'button', disabled: busy, onClick, className: `dsh-acp-btn dsh-acp-btn-${variant}`, ...extraProps }, label);

      const action = (name, body) => run(async signal => {
        const result = await request(name, body, signal);
        if (name === 'probe') setNotice(`Handshake successful${result.latencyMs == null ? '' : ` (${result.latencyMs} ms)`}.`);
        else await reload(signal);
      });

      const updateRow = (key, index, patch) => setDraft(value => ({ ...value,
        [key]: value[key].map((row, i) => i === index ? { ...row, ...patch } : row) }));
      const removeRow = (key, index) => setDraft(value => ({ ...value, [key]: value[key].filter((_, i) => i !== index) }));

      const currentPreset = data?.presets?.find(p => p.id === draft?.presetId) || data?.presets?.[0];
      const presetsList = data?.presets?.filter(p => p.id !== 'custom') || [];
      const visiblePresets = showMore ? (data?.presets || []) : presetsList;

      return h('section', { className: 'dsh-acp-settings', 'aria-label': 'ACP providers', 'aria-busy': busy },
        h('h2', null, 'ACP providers'),
        h('p', null, 'Manage agent connections and the models available in chat.'),
        h('div', { className: 'dsh-acp-actions' },
          button('Add provider', () => edit(empty), 'primary'),
          button('Refresh', () => run(reload))),
        error && h('p', { role: 'alert', className: 'dsh-acp-alert' }, error),
        notice && h('p', { role: 'status', className: 'dsh-acp-notice' }, notice),
        !data && !error && h('p', null, 'Loading providers…'),

        data && !draft && h('div', { className: 'dsh-acp-cards' }, ...data.engines.map(engine => h('article', { key: engine.id },
          h('div', { className: 'dsh-acp-card-header' },
            h('span', { className: 'dsh-acp-accent-indicator', style: { backgroundColor: engine.accentColor || '#3b82f6' } }),
            h('h3', null, engine.name),
            h('span', { className: `dsh-acp-badge ${engine.disabled ? 'disabled' : engine.daemon?.running ? 'running' : 'ready'}` },
              engine.disabled ? 'Disabled' : engine.daemon?.running ? 'Running' : 'Ready'),
          ),
          h('p', null, engine.disabled ? 'Disabled' : engine.daemon?.running ? 'Running' : 'Ready · starts when used'),
          h('code', null, engine.command),
          h('p', null, engine.models.map(model => model.name || model.id).join(' · ') || 'No configured models'),
          h('div', { className: 'dsh-acp-actions' },
            button('Edit', () => edit(engine, true)),
            button(engine.disabled ? 'Enable' : 'Disable', () => action('toggle', { id: engine.id, disabled: !engine.disabled })),
            button('Test connection', () => action('probe', { command: engine.command, args: engine.args, env: engine.env })),
            button('Reset connection', () => action('restart', { id: engine.id })),
            button('Remove', () => {
              if (window.confirm(`Remove ${engine.name}?`)) action('delete', { id: engine.id });
            })),
        ))),

        draft && h('div', { className: 'dsh-acp-modal-overlay' },
          h('form', {
            className: 'dsh-acp-wizard-dialog',
            onSubmit: event => {
              event.preventDefault();
              run(async signal => {
                await request('save', parsed(), signal);
                await reload(signal); setDraft(null); setNotice('Provider saved. Available models have been updated.');
              });
            },
          },
            // Header
            h('div', { className: 'dsh-acp-dialog-header' },
              h('div', null,
                h('h2', { className: 'dsh-acp-dialog-title' }, originalId ? 'Edit provider' : 'Add provider'),
                h('p', { className: 'dsh-acp-dialog-subtitle' }, `Add an account or configure a provider on ${data?.hostname || 'this machine'}.`),
              ),
              h('button', {
                type: 'button', className: 'dsh-acp-close-btn', 'aria-label': 'Close',
                onClick: () => setDraft(null),
              }, ICONS.close(18)),
            ),

            // Stepper pills
            h('div', { className: 'dsh-acp-stepper' },
              // Step 1 pill
              h('div', {
                className: `dsh-acp-step ${wizardStep === 1 ? 'active' : wizardStep > 1 ? 'completed' : 'inactive'}`,
                onClick: () => setWizardStep(1),
              },
                h('span', { className: 'dsh-acp-step-badge' }, wizardStep > 1 ? ICONS.check(12) : '1'),
                h('span', { className: 'dsh-acp-step-text' }, 'Provider'),
              ),
              // Step 2 pill
              h('div', {
                className: `dsh-acp-step ${wizardStep === 2 ? 'active' : wizardStep > 2 ? 'completed' : 'inactive'}`,
                onClick: () => { if (draft.presetId || originalId) setWizardStep(2); },
              },
                h('span', { className: 'dsh-acp-step-badge' }, wizardStep > 2 ? ICONS.check(12) : '2'),
                h('span', { className: 'dsh-acp-step-text' }, 'Identity'),
              ),
              // Step 3 pill
              h('div', {
                className: `dsh-acp-step ${wizardStep === 3 ? 'active' : 'inactive'}`,
                onClick: () => { if (draft.presetId || originalId) setWizardStep(3); },
              },
                h('span', { className: 'dsh-acp-step-badge' }, '3'),
                h('span', { className: 'dsh-acp-step-text' }, 'Config'),
              ),
            ),

            // Wizard Step 1: Provider selection
            wizardStep === 1 && h('div', { className: 'dsh-acp-wizard-body' },
              h('h3', { className: 'dsh-acp-section-heading' }, 'Provider'),
              h('div', { className: 'dsh-acp-presets-grid' },
                ...visiblePresets.map(preset => {
                  const isSelected = draft.presetId === preset.id;
                  const iconFn = ICONS[preset.id] || ICONS.custom;
                  return h('div', {
                    key: preset.id,
                    className: `dsh-acp-preset-card ${isSelected ? 'selected' : ''}`,
                    onClick: () => selectPreset(preset),
                  },
                    h('div', { className: 'dsh-acp-preset-info' },
                      iconFn(22),
                      h('span', { className: 'dsh-acp-preset-name' }, preset.name),
                    ),
                    isSelected && h('div', { className: 'dsh-acp-selected-check' }, ICONS.check(12)),
                  );
                }),
              ),
              currentPreset?.infoCallout && h('div', { className: 'dsh-acp-callout' },
                ICONS.info(18),
                h('span', null, currentPreset.infoCallout),
              ),
              h('button', {
                type: 'button', className: 'dsh-acp-show-more-btn',
                onClick: () => setShowMore(v => !v),
              }, showMore ? 'Show less ∧' : 'Show more ∨'),
              h('div', { className: 'dsh-acp-footer' },
                button('Cancel', () => setDraft(null), 'secondary'),
                h('div', { className: 'dsh-acp-footer-right' },
                  button('Configure manually', () => {
                    const customPreset = data?.presets?.find(p => p.id === 'custom') || { id: 'custom', name: 'Custom provider', command: '', args: ['--stdio'] };
                    selectPreset(customPreset);
                    setWizardStep(2);
                  }, 'secondary'),
                  h('button', {
                    type: 'button',
                    className: 'dsh-acp-btn dsh-acp-btn-primary dsh-acp-continue-btn',
                    onClick: () => setWizardStep(2),
                  },
                    draft.presetId === 'codex' && ICONS.codex(18),
                    draft.presetId === 'codex' ? 'Continue with ChatGPT' : 'Continue',
                  ),
                ),
              ),
            ),

            // Wizard Step 2: Identity
            wizardStep === 2 && h('div', { className: 'dsh-acp-wizard-body' },
              // Row 1: Label
              h('label', { className: 'dsh-acp-form-row' },
                h('div', { className: 'dsh-acp-row-left' },
                  h('span', { className: 'dsh-acp-row-title' }, 'Label'),
                  h('small', { className: 'dsh-acp-row-desc' }, 'Shown in the provider list.'),
                ),
                h('div', { className: 'dsh-acp-row-right' },
                  h('input', {
                    type: 'text', value: draft.name, disabled: busy,
                    placeholder: currentPreset?.name || 'Provider name',
                    onChange: e => setDraft(v => ({ ...v, name: e.target.value })),
                  }),
                ),
              ),
              // Row 2: Instance ID
              h('label', { className: 'dsh-acp-form-row' },
                h('div', { className: 'dsh-acp-row-left' },
                  h('span', { className: 'dsh-acp-row-title' }, 'Instance ID'),
                  h('small', { className: 'dsh-acp-row-desc' }, "Letters, digits, '-', or '_'."),
                ),
                h('div', { className: 'dsh-acp-row-right' },
                  h('input', {
                    type: 'text', value: draft.id, disabled: busy || originalId !== null,
                    placeholder: 'e.g. claudeAgent_2',
                    onChange: e => setDraft(v => ({ ...v, id: e.target.value })),
                  }),
                ),
              ),
              // Row 3: Accent color
              h('div', { className: 'dsh-acp-form-row' },
                h('div', { className: 'dsh-acp-row-left' },
                  h('span', { className: 'dsh-acp-row-title' }, 'Accent color'),
                  h('small', { className: 'dsh-acp-row-desc' }, 'Optional marker shown in the picker.'),
                ),
                h('div', { className: 'dsh-acp-row-right dsh-acp-accent-palette' },
                  ...ACCENT_COLORS.map(color => h('button', {
                    key: color, type: 'button',
                    className: `dsh-acp-swatch ${draft.accentColor === color ? 'selected' : ''}`,
                    style: { backgroundColor: color },
                    onClick: () => setDraft(v => ({ ...v, accentColor: color })),
                  }, draft.accentColor === color && ICONS.check(12))),
                  h('label', { className: 'dsh-acp-swatch-custom' },
                    '+',
                    h('input', {
                      type: 'color', value: draft.accentColor || '#3b82f6',
                      style: { opacity: 0, position: 'absolute', pointerEvents: 'none' },
                      onChange: e => setDraft(v => ({ ...v, accentColor: e.target.value })),
                    }),
                  ),
                ),
              ),
              // Step 2 Footer
              h('div', { className: 'dsh-acp-footer' },
                button('Back', () => setWizardStep(1), 'secondary'),
                h('div', { className: 'dsh-acp-footer-right' },
                  button('Next', () => {
                    if (!draft.name.trim()) { setError('Enter a display name.'); return; }
                    setError('');
                    setWizardStep(3);
                  }, 'primary'),
                ),
              ),
            ),

            // Wizard Step 3: Config
            wizardStep === 3 && h('div', { className: 'dsh-acp-wizard-body' },
              // Row 1: Binary path
              h('label', { className: 'dsh-acp-form-row' },
                h('div', { className: 'dsh-acp-row-left' },
                  h('span', { className: 'dsh-acp-row-title' }, 'Binary path'),
                  h('small', { className: 'dsh-acp-row-desc' }, `Path to the ${currentPreset?.name || 'provider'} binary used by this instance.`),
                ),
                h('div', { className: 'dsh-acp-row-right' },
                  h('input', {
                    type: 'text', value: draft.command, disabled: busy,
                    placeholder: currentPreset?.command || 'e.g. claude or agy',
                    onChange: e => setDraft(v => ({ ...v, command: e.target.value })),
                  }),
                ),
              ),
              // Row 2: <PROVIDER>_CONFIG_DIR path
              h('label', { className: 'dsh-acp-form-row' },
                h('div', { className: 'dsh-acp-row-left' },
                  h('span', { className: 'dsh-acp-row-title' }, `${draft.configDirVar || 'CONFIG_DIR'} path`),
                  h('small', { className: 'dsh-acp-row-desc' }, `Custom ${currentPreset?.name || 'provider'} home and config directory. Keeps config and auth separate.`),
                ),
                h('div', { className: 'dsh-acp-row-right' },
                  h('input', {
                    type: 'text', value: draft.configDir || '', disabled: busy,
                    placeholder: currentPreset?.defaultConfigDir || '~/.config',
                    onChange: e => setDraft(v => ({ ...v, configDir: e.target.value })),
                  }),
                ),
              ),
              // Row 3: Auto-compact after
              h('label', { className: 'dsh-acp-form-row' },
                h('div', { className: 'dsh-acp-row-left' },
                  h('span', { className: 'dsh-acp-row-title' }, 'Auto-compact after'),
                  h('small', { className: 'dsh-acp-row-desc' }, `Compact after 100,000 to 1,000,000 tokens. Leave empty to use ${currentPreset?.name || 'provider'}'s default.`),
                ),
                h('div', { className: 'dsh-acp-row-right' },
                  h('input', {
                    type: 'text', value: draft.autoCompactTokens, disabled: busy,
                    placeholder: 'e.g. 300000',
                    onChange: e => setDraft(v => ({ ...v, autoCompactTokens: e.target.value })),
                  }),
                ),
              ),
              // Row 4: Compact idle threads
              h('label', { className: 'dsh-acp-form-row' },
                h('div', { className: 'dsh-acp-row-left' },
                  h('span', { className: 'dsh-acp-row-title' }, 'Compact idle threads'),
                  h('small', { className: 'dsh-acp-row-desc' }, 'When to compact an idle thread over 200,000 tokens: after you return, just before its prompt cache expires, or never. Overrides the default in Providers > Advanced.'),
                ),
                h('div', { className: 'dsh-acp-row-right' },
                  h('select', {
                    value: draft.compactIdleThreads || 'default', disabled: busy,
                    onChange: e => setDraft(v => ({ ...v, compactIdleThreads: e.target.value })),
                  },
                    h('option', { value: 'default' }, 'Use default'),
                    h('option', { value: 'after-return' }, 'After return'),
                    h('option', { value: 'cache-expiry' }, 'Before prompt cache expires'),
                    h('option', { value: 'never' }, 'Never'),
                  ),
                ),
              ),
              // Row 5: Launch arguments
              h('label', { className: 'dsh-acp-form-row' },
                h('div', { className: 'dsh-acp-row-left' },
                  h('span', { className: 'dsh-acp-row-title' }, 'Launch arguments'),
                  h('small', { className: 'dsh-acp-row-desc' }, 'Additional CLI arguments passed on session start.'),
                ),
                h('div', { className: 'dsh-acp-row-right' },
                  h('input', {
                    type: 'text', value: draft.args.join(' '), disabled: busy,
                    placeholder: 'e.g. --chrome',
                    onChange: e => setDraft(v => ({ ...v, args: e.target.value.split(' ').filter(Boolean) })),
                  }),
                ),
              ),

              // Models & Discovery
              h('div', { className: 'dsh-acp-models-section' },
                h('div', { className: 'dsh-acp-section-header' },
                  h('h4', null, 'Models'),
                  button('Load models from agent', () => run(async signal => {
                    const result = await request('discover', parsed(), signal);
                    if (result.models.length === 0) throw new Error('The agent did not report any models. Check its sign-in, or add a model manually.');
                    setSelectedModels(result.models);
                    setNotice('Choose models below, then save the provider.');
                  }), 'secondary'),
                ),
                h('small', { className: 'dsh-acp-row-desc' }, 'Opens a temporary agent session using its current sign-in.'),
                selectedModels && h('fieldset', { className: 'dsh-acp-models-discovery' },
                  h('legend', null, 'Available models'),
                  ...selectedModels.map(model => h('label', { className: 'dsh-acp-choice', key: model.id },
                    h('input', {
                      type: 'checkbox', disabled: busy, checked: draft.models.some(item => item.id === model.id),
                      onChange: event => setDraft(value => ({ ...value, models: event.target.checked
                        ? [...value.models, { ...model }] : value.models.filter(item => item.id !== model.id) })),
                    }),
                    h('span', null, model.name || model.id),
                  )),
                ),
                h('div', { className: 'dsh-acp-models-list' },
                  ...draft.models.map((model, index) => h('div', { className: 'dsh-acp-model-item', key: `model-${index}` },
                    h('label', { className: 'dsh-acp-inline-field' },
                      h('span', null, 'Model name'),
                      h('input', {
                        type: 'text', value: model.name || '', disabled: busy,
                        onChange: e => updateRow('models', index, { name: e.target.value }),
                      }),
                    ),
                    h('label', { className: 'dsh-acp-inline-field' },
                      h('span', null, 'Model ID'),
                      h('input', {
                        type: 'text', value: model.id, disabled: busy,
                        onChange: e => updateRow('models', index, { id: e.target.value }),
                      }),
                    ),
                    button('Remove model', () => removeRow('models', index), 'danger'),
                  )),
                ),
                button('Add model manually', () => setDraft(value => ({ ...value, models: [...value.models, { id: '', name: '' }] })), 'secondary'),
              ),

              // Advanced details (Environment variables & executable detection)
              h('details', { className: 'dsh-acp-advanced' },
                h('summary', null, 'Advanced'),
                h('div', { className: 'dsh-acp-advanced-body' },
                  button('Detect executable', () => run(async signal => {
                    const current = await request('engines', undefined, signal);
                    setData(current);
                    const found = current.installedScan?.find(item => item.installed && item.id === (draft.presetId || draft.id));
                    if (!found) throw new Error('Executable not detected. Enter its path manually.');
                    setDraft(value => ({ ...value, command: found.resolvedPath }));
                    setNotice('Executable detected.');
                  }), 'secondary'),
                  h('h4', null, 'Launch arguments list'),
                  ...draft.args.map((arg, index) => h('div', { className: 'dsh-acp-row', key: `arg-${index}` },
                    h('label', { className: 'dsh-acp-field' },
                      h('span', null, `Argument ${index + 1}`),
                      h('input', {
                        value: arg, disabled: busy,
                        onChange: e => setDraft(v => ({ ...v, args: v.args.map((item, i) => i === index ? e.target.value : item) })),
                      }),
                    ),
                    button('Remove argument', () => removeRow('args', index), 'danger'),
                  )),
                  button('Add argument', () => setDraft(v => ({ ...v, args: [...v.args, ''] })), 'secondary'),
                  h('h4', null, 'Environment variables'),
                  h('small', null, 'Optional. Values are stored as plain text on this host.'),
                  ...draft.env.map((row, index) => h('div', { className: 'dsh-acp-row', key: `env-${index}` },
                    h('label', { className: 'dsh-acp-field' },
                      h('span', null, 'Variable name'),
                      h('input', {
                        value: row.name, disabled: busy,
                        onChange: e => updateRow('env', index, { name: e.target.value }),
                      }),
                    ),
                    h('label', { className: 'dsh-acp-field' },
                      h('span', null, 'Value'),
                      h('input', {
                        type: 'password', value: row.value, disabled: busy,
                        onChange: e => updateRow('env', index, { value: e.target.value }),
                      }),
                    ),
                    button('Remove variable', () => removeRow('env', index), 'danger'),
                  )),
                  button('Add variable', () => setDraft(value => ({ ...value, env: [...value.env, { name: '', value: '' }] })), 'secondary'),
                ),
              ),

              // Step 3 Footer
              h('div', { className: 'dsh-acp-footer' },
                button('Back', () => setWizardStep(2), 'secondary'),
                h('div', { className: 'dsh-acp-footer-right' },
                  button('Test connection', () => run(async signal => {
                    const result = await request('probe', parsed(), signal);
                    setNotice(`Handshake successful${result.latencyMs == null ? '' : ` (${result.latencyMs} ms)`}.`);
                  }), 'secondary'),
                  h('button', {
                    type: 'submit', disabled: busy,
                    className: 'dsh-acp-btn dsh-acp-btn-primary',
                  }, originalId ? 'Save provider' : 'Add instance'),
                ),
              ),
            ),
          ),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = `
.dsh-acp-settings { color: inherit; max-width: 860px; padding: 12px 0; font-family: inherit; }
.dsh-acp-settings p { margin: 8px 0; color: #9ca3af; font-size: 13px; }
.dsh-acp-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
.dsh-acp-btn { font: inherit; font-size: 13px; font-weight: 500; border-radius: 6px; padding: 7px 14px; cursor: pointer; transition: all .15s; border: 1px solid #374151; background: #1f2937; color: #f3f4f6; display: inline-flex; align-items: center; gap: 8px; }
.dsh-acp-btn:hover:not(:disabled) { background: #374151; }
.dsh-acp-btn-primary { background: #2563eb; border-color: #1d4ed8; color: #ffffff; font-weight: 600; }
.dsh-acp-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.dsh-acp-btn-secondary { background: transparent; border-color: #374151; color: #d1d5db; }
.dsh-acp-btn-secondary:hover:not(:disabled) { background: #1f2937; }
.dsh-acp-btn-danger { background: transparent; border-color: #7f1d1d; color: #f87171; }
.dsh-acp-btn-danger:hover:not(:disabled) { background: #991b1b; color: #fff; }
.dsh-acp-btn:disabled { opacity: 0.5; cursor: default; }

.dsh-acp-cards { display: grid; gap: 14px; margin: 18px 0; }
.dsh-acp-cards article { background: #141518; border: 1px solid #27272a; border-radius: 10px; padding: 16px; }
.dsh-acp-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.dsh-acp-card-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
.dsh-acp-accent-indicator { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.dsh-acp-badge { font-size: 11px; padding: 2px 8px; border-radius: 12px; font-weight: 500; }
.dsh-acp-badge.ready { background: rgba(16, 185, 129, 0.15); color: #10b981; }
.dsh-acp-badge.running { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
.dsh-acp-badge.disabled { background: rgba(107, 114, 128, 0.15); color: #9ca3af; }

/* Wizard Modal Dialog */
.dsh-acp-modal-overlay { margin: 20px 0; }
.dsh-acp-wizard-dialog { background: #0d0e12; border: 1px solid #27272a; border-radius: 12px; padding: 24px; box-shadow: 0 8px 30px rgba(0,0,0,0.5); }
.dsh-acp-dialog-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.dsh-acp-dialog-title { margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #f3f4f6; }
.dsh-acp-dialog-subtitle { margin: 0; font-size: 13px; color: #9ca3af; }
.dsh-acp-close-btn { background: none; border: none; color: #9ca3af; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
.dsh-acp-close-btn:hover { color: #f3f4f6; background: #27272a; }

/* Stepper */
.dsh-acp-stepper { display: flex; gap: 8px; background: #16171b; border: 1px solid #27272a; border-radius: 8px; padding: 4px; margin-bottom: 24px; }
.dsh-acp-step { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 6px; font-size: 13px; color: #71717a; cursor: pointer; user-select: none; transition: all .15s; }
.dsh-acp-step.active { background: #23252b; color: #f3f4f6; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
.dsh-acp-step.completed { color: #e4e4e7; }
.dsh-acp-step-badge { width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; background: #27272a; color: #a1a1aa; }
.dsh-acp-step.active .dsh-acp-step-badge { background: #3b82f6; color: #fff; }
.dsh-acp-step.completed .dsh-acp-step-badge { background: #2563eb; color: #fff; }

/* Section & Grid (Step 1) */
.dsh-acp-section-heading { margin: 0 0 14px; font-size: 14px; font-weight: 600; color: #e4e4e7; }
.dsh-acp-presets-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 14px; }
.dsh-acp-preset-card { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #141518; border: 1px solid #27272a; border-radius: 8px; cursor: pointer; transition: all .15s; }
.dsh-acp-preset-card:hover { border-color: #3f3f46; background: #1a1b20; }
.dsh-acp-preset-card.selected { border-color: #2563eb; background: rgba(37, 99, 235, 0.08); box-shadow: 0 0 0 1px #2563eb; }
.dsh-acp-preset-info { display: flex; align-items: center; gap: 12px; }
.dsh-acp-preset-name { font-size: 14px; font-weight: 600; color: #f3f4f6; }
.dsh-acp-selected-check { width: 20px; height: 20px; border-radius: 50%; background: #2563eb; display: flex; align-items: center; justify-content: center; }

.dsh-acp-callout { display: flex; align-items: center; gap: 10px; background: rgba(37, 99, 235, 0.06); border: 1px solid rgba(37, 99, 235, 0.25); border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #93c5fd; margin: 14px 0; }
.dsh-acp-show-more-btn { background: none; border: none; color: #9ca3af; font-size: 13px; cursor: pointer; padding: 6px 0; display: inline-flex; align-items: center; gap: 4px; }
.dsh-acp-show-more-btn:hover { color: #f3f4f6; }

/* Horizontal Row Layout (Step 2 & 3) */
.dsh-acp-form-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding: 16px 0; border-bottom: 1px solid #1f2024; }
.dsh-acp-row-left { flex: 1; max-width: 380px; display: flex; flex-direction: column; gap: 4px; }
.dsh-acp-row-title { font-size: 14px; font-weight: 600; color: #f3f4f6; }
.dsh-acp-row-desc { font-size: 12px; color: #9ca3af; line-height: 1.4; }
.dsh-acp-row-right { width: 320px; max-width: 100%; display: flex; align-items: center; }
.dsh-acp-row-right input, .dsh-acp-row-right select { width: 100%; box-sizing: border-box; background: #131417; border: 1px solid #2e3038; border-radius: 6px; padding: 8px 12px; color: #f3f4f6; font-size: 13px; font-family: inherit; }
.dsh-acp-row-right input:focus, .dsh-acp-row-right select:focus { outline: none; border-color: #3b82f6; }

/* Accent Swatches */
.dsh-acp-accent-palette { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsh-acp-swatch { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; transition: transform .1s; }
.dsh-acp-swatch:hover { transform: scale(1.1); }
.dsh-acp-swatch.selected { border-color: #ffffff; box-shadow: 0 0 0 1px #3b82f6; }
.dsh-acp-swatch-custom { width: 22px; height: 22px; border-radius: 50%; border: 1px dashed #4b5563; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #9ca3af; cursor: pointer; position: relative; }

/* Models and Advanced (Step 3) */
.dsh-acp-models-section { padding: 18px 0; border-bottom: 1px solid #1f2024; }
.dsh-acp-section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.dsh-acp-section-header h4 { margin: 0; font-size: 14px; font-weight: 600; }
.dsh-acp-models-discovery { border: 1px solid #27272a; border-radius: 8px; padding: 12px; margin: 12px 0; background: #131417; }
.dsh-acp-models-discovery legend { font-size: 12px; color: #9ca3af; padding: 0 4px; }
.dsh-acp-choice { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 13px; cursor: pointer; }
.dsh-acp-models-list { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.dsh-acp-model-item { display: flex; align-items: flex-end; gap: 8px; background: #131417; border: 1px solid #27272a; border-radius: 6px; padding: 8px 12px; }
.dsh-acp-inline-field { flex: 1; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #9ca3af; }
.dsh-acp-inline-field input { background: #0d0e12; border: 1px solid #27272a; border-radius: 4px; padding: 6px 8px; color: #f3f4f6; font-size: 13px; }

.dsh-acp-advanced { margin: 18px 0; }
.dsh-acp-advanced summary { font-size: 13px; font-weight: 600; color: #9ca3af; cursor: pointer; }
.dsh-acp-advanced-body { padding: 12px 0; display: flex; flex-direction: column; gap: 10px; }
.dsh-acp-row { display: flex; align-items: flex-end; gap: 8px; }
.dsh-acp-field { flex: 1; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #9ca3af; }
.dsh-acp-field input { background: #131417; border: 1px solid #27272a; border-radius: 4px; padding: 6px 8px; color: #f3f4f6; font-size: 13px; }

/* Dialog Footer */
.dsh-acp-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 24px; padding-top: 18px; border-top: 1px solid #1f2024; }
.dsh-acp-footer-right { display: flex; gap: 10px; align-items: center; }

.dsh-acp-alert { color: #f87171; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 8px 12px; margin: 12px 0; font-size: 13px; }
.dsh-acp-notice { color: #34d399; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 8px 12px; margin: 12px 0; font-size: 13px; }
`;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'acp-settings: styles');
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'acp-providers', order: 25, label: () => 'ACP providers',
        }, AcpSettings)), 'acp-settings: section');
      },
    };
  },
});
