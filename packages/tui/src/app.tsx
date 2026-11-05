import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useInput, useStdout } from 'ink';
import {
  parameterFields,
  redactSecrets,
  type Mink,
  type Settings,
  type RunResult,
} from '@yaroslavlky/mink-core';
import { copyText, openUrl } from './actions.js';
import { clipboardCommand, type Values } from './model/commands.js';
import { Frame, ScreenSlot } from './components/frame.js';
import { adjacentTab, tabForScreen, type Screen } from './model/navigation.js';
import { useTerminalSize } from './hooks/use-terminal-size.js';
import { useProjectState } from './hooks/use-project-state.js';
import { useSession } from './hooks/use-session.js';
import { PaletteScreen } from './screens/palette.js';
import { ParametersScreen } from './screens/parameters.js';
import { PreviewScreen } from './screens/preview.js';
import { OutputScreen } from './screens/output.js';
import { ServicesScreen } from './screens/services.js';
import { PresetScreen } from './screens/preset.js';
import { SettingsScreen } from './screens/settings.js';
import { applyTheme } from './theme.js';
import { setLanguage, t } from './i18n.js';
import { LogInputContext } from './components/log-input.js';
interface Draft {
  id: string;
  values: Values;
  revision: number;
}
// Screens that take typed text; `?` must reach them as input.
const typing: Screen[] = ['palette', 'form', 'preset', 'save'];

export function MinkApp({
  mink,
  overrides = {},
  onForeground,
}: {
  mink: Mink;
  overrides?: Partial<Settings>;
  onForeground?: (id: string, values: Values) => void;
}) {
  const { exit } = useApp(),
    size = useTerminalSize(),
    session = useSession(mink);
  const [screen, setScreen] = useState<Screen>('palette'),
    [draft, setDraft] = useState<Draft>({ id: '', values: {}, revision: 0 });
  const [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [helpOpen, setHelpOpen] = useState(false),
    [logEditing, setLogEditing] = useState(false),
    [sessionOverrides, setSessionOverrides] = useState(overrides);
  const { stdout } = useStdout();
  useEffect(() => {
    if (!stdout.isTTY) return;
    stdout.write('\u001b[?1000h\u001b[?1006h');
    return () => { stdout.write('\u001b[?1006l\u001b[?1000l'); };
  }, [stdout]);
  const commandsScreen = useRef<Screen>('palette');
  const logEditingRef = useRef(false);
  const changeLogEditing = useCallback((editing: boolean) => {
    logEditingRef.current = editing;
    setLogEditing(editing);
  }, []);
  const project = useProjectState(mink, setError);
  const settings = { ...project.settings, ...sessionOverrides };
  applyTheme(settings.theme);
  setLanguage(settings.language);
  const at = (name: Screen) => !helpOpen && screen === name;
  const config = useMemo(() => mink.getConfig(), [mink]),
    matches = useMemo(() => mink.searchCommands(query), [mink, query]);
  const entry = config.commands[draft.id],
    busy = session.invocation?.busy ?? false;
  const viewport = {
    width: size.columns,
    height: size.rows - 6 - (error || notice ? 3 : 0),
    wide: size.columns >= 100,
  };
  async function perform(action: () => Promise<unknown>) {
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }
  function navigate(next: Screen) {
    changeLogEditing(false);
    setError('');
    setNotice('');
    setHelpOpen(false);
    if (tabForScreen(next) === 'palette') commandsScreen.current = next;
    setScreen(next);
  }
  function choose(id: string) {
    if (busy) {
      navigate('output');
      setNotice(t('notice.cancelBeforeStart'));
      return;
    }
    setDraft((previous) => ({ id, values: {}, revision: previous.revision + 1 }));
    navigate(parameterFields(config.commands[id]).length ? 'form' : 'preview');
  }
  function run(target: Pick<Draft, 'id' | 'values'>, retryFailed?: RunResult) {
    void perform(async () => {
      mink.plan(target.id, target.values);
      commandsScreen.current = 'palette';
      navigate('output');
      await session.start(target.id, target.values, retryFailed);
      await project.reload();
    });
  }
  useInput((input, key) => {
    if (
      logEditingRef.current &&
      ['output', 'services'].includes(screen) &&
      !key.tab &&
      !(key.ctrl && input === 'c')
    )
      return;
    if (helpOpen && (input === '?' || key.escape)) {
      setHelpOpen(false);
      return;
    }
    if (input === '?' && !key.ctrl && !key.meta && !typing.includes(screen)) {
      setHelpOpen(true);
      return;
    }
    if (key.tab && !key.ctrl && !key.meta) {
      const next = adjacentTab(screen, key.shift ? -1 : 1);
      navigate(next === 'palette' ? commandsScreen.current : next);
      return;
    }
    if (key.ctrl && (input === 'g' || input === '\u0007' || input === ',' || input === '\u001c')) {
      navigate('settings');
      return;
    }
    if (key.ctrl && input === 'c') {
      if (busy) {
        session.cancel();
        setNotice(t('notice.cancelling'));
      } else exit();
      return;
    }
    if (key.ctrl && input === 'p') {
      navigate('palette');
      return;
    }
    if (key.ctrl && input === 'o') {
      navigate('output');
      return;
    }
    if (key.ctrl && input === 's') {
      navigate('services');
      return;
    }
    if (key.escape) {
      if (screen === 'palette') exit();
      else navigate('palette');
    }
  });
  let preview;
  if (screen === 'preview' && entry) {
    try {
      preview = { plan: mink.plan(draft.id, draft.values) };
    } catch (failure) {
      preview = { error: failure instanceof Error ? failure.message : String(failure) };
    }
  }
  return (
    <LogInputContext.Provider
      value={{ editing: logEditing, editingRef: logEditingRef, setEditing: changeLogEditing }}
    >
      <Frame
        onTab={(tab) => navigate(tab === 'palette' ? commandsScreen.current : tab)}
        repository={config.repository?.name ?? 'repository control center'}
        directory={mink.directory}
        screen={screen}
        {...size}
        busy={busy}
        serviceCount={
          session.services.filter((service) =>
            ['starting', 'ready', 'unhealthy'].includes(service.state),
          ).length
        }
        error={error}
        notice={notice}
        helpOpen={helpOpen}
      >
        <ScreenSlot active={at('palette')}>
          <PaletteScreen
            active={at('palette')}
            matches={matches}
            query={query}
            onQuery={setQuery}
            state={project.state}
            viewport={viewport}
            onChoose={choose}
            onFavorite={(id) => {
              void perform(() => project.favorite(id));
            }}
          />
        </ScreenSlot>
        {entry && (
          <ScreenSlot active={at('form')}>
            <ParametersScreen
              key={`${draft.id}:${draft.revision}`}
              id={draft.id}
              entry={entry}
              active={at('form')}
              initial={draft.values}
              viewport={viewport}
              onComplete={(values) => {
                setDraft({ ...draft, values });
                navigate('preview');
              }}
            />
          </ScreenSlot>
        )}
        {entry && (
          <ScreenSlot active={at('preview')}>
            <PreviewScreen
              key={`${draft.id}:${draft.revision}`}
              active={at('preview')}
              id={draft.id}
              entry={entry}
              {...preview}
              viewport={viewport}
              onRun={() => run(draft)}
              onEdit={() => {
                setDraft((previous) => ({ ...previous, revision: previous.revision + 1 }));
                navigate(parameterFields(entry, draft.values).length ? 'form' : 'preview');
              }}
              onPreset={() => navigate('preset')}
              onSave={() => navigate('save')}
              onCopy={() => {
                void perform(async () => {
                  if (
                    Object.entries(entry.params ?? {}).some(
                      ([name, parameter]) =>
                        parameter.type === 'secret' && Object.hasOwn(draft.values, name),
                    )
                  )
                    throw new Error(t('error.secretCopy'));
                  await copyText(clipboardCommand(mink.prepare(draft.id, draft.values)));
                  setNotice(t('notice.copied'));
                });
              }}
              onForeground={
                onForeground
                  ? () => {
                      if (busy) return;
                      mink.plan(draft.id, draft.values);
                      onForeground(draft.id, draft.values);
                      exit();
                    }
                  : undefined
              }
            />
          </ScreenSlot>
        )}
        <ScreenSlot active={at('output')}>
          <OutputScreen
            active={at('output')}
            session={session}
            viewport={viewport}
            onRerun={() => {
              if (session.invocation)
                run({ id: session.invocation.id, values: session.invocation.values });
            }}
            onRetryFailed={() => {
              const invocation = session.invocation;
              if (invocation?.result)
                run({ id: invocation.id, values: invocation.values }, invocation.result);
            }}
            onCopy={() => {
              const lines = session.logs.lines(
                session.runId ? { runId: session.runId } : undefined,
              );
              if (!lines.length) return;
              void perform(async () => {
                const text = lines.map((line) => `[${line.id}] ${line.text}`).join('\n');
                await copyText(
                  session.invocation ? redactSecrets(text, session.invocation.plan) : text,
                );
                setNotice(t('notice.outputCopied'));
              });
            }}
          />
        </ScreenSlot>
        <ScreenSlot active={at('settings')}>
          <SettingsScreen
            active={at('settings')}
            settings={settings}
            viewport={viewport}
            onChange={(change) => {
              setSessionOverrides((current) => {
                const next = { ...current };
                for (const key of Object.keys(change) as (keyof Settings)[]) delete next[key];
                return next;
              });
              void perform(() => project.saveSettings(change));
            }}
            onClose={() => navigate('palette')}
          />
        </ScreenSlot>
        <ScreenSlot active={at('services')}>
          <ServicesScreen
            active={at('services')}
            services={session.services}
            logs={session.logs}
            viewport={viewport}
            onStop={(instance, force) => {
              void perform(() => session.stop(instance, force));
            }}
            onRestart={(instance) => {
              void perform(() => session.restart(instance));
            }}
            onOpen={(url) => {
              void perform(() => openUrl(url));
            }}
          />
        </ScreenSlot>
        {entry &&
          (['preset', 'save'] as const).map((mode) => (
            <ScreenSlot key={mode} active={at(mode)}>
              <PresetScreen
                key={`${draft.id}:${draft.revision}:${mode}`}
                active={at(mode)}
                saving={mode === 'save'}
                names={Object.keys({ ...entry.presets, ...project.state.presets[draft.id] })}
                viewport={viewport}
                onSubmit={(name) =>
                  perform(async () => {
                    if (mode === 'save') {
                      await project.savePreset(draft.id, name, draft.values);
                      navigate('preview');
                      setNotice(t('notice.presetSaved'));
                    } else {
                      const values = await project.loadPreset(draft.id, name);
                      setDraft((previous) => ({
                        ...previous,
                        values,
                        revision: previous.revision + 1,
                      }));
                      navigate(parameterFields(entry, values).length ? 'form' : 'preview');
                    }
                  })
                }
              />
            </ScreenSlot>
          ))}
      </Frame>
    </LogInputContext.Provider>
  );
}
