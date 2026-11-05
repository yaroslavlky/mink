import { useRef, type ReactNode } from 'react';
import { Box, Text, measureElement, type DOMElement } from 'ink';
import { useMouse } from '../hooks/use-mouse.js';
import { colors } from '../theme.js';
import { safeText } from '../actions.js';
import { Feedback, KeyHints, Panel } from './ui.js';
import { tabForScreen, type Screen, type Tab } from '../model/navigation.js';
import { t } from '../i18n.js';
import { LOGO_HEIGHT, LogoMark } from './logo.js';
export interface Viewport {
  width: number;
  height: number;
  wide: boolean;
}
const hints: Record<Screen, readonly (readonly [string, string])[]> = {
  palette: [
    ['↑↓', 'hint.select'],
    ['Enter', 'hint.configure'],
    ['^F', 'hint.favorite'],
    ['^G', 'hint.settings'],
  ],
  form: [
    ['Enter', 'hint.next'],
    ['^B', 'hint.previous'],
  ],
  preview: [
    ['Enter', 'hint.run'],
    ['e', 'hint.edit'],
    ['p', 'hint.preset'],
    ['s', 'hint.save'],
    ['c', 'hint.copy'],
  ],
  output: [
    ['r', 'hint.rerun'],
    ['y', 'hint.copyOutput'],
    ['PgUp/PgDn', 'hint.scroll'],
  ],
  services: [
    ['↑↓', 'hint.select'],
    ['s', 'hint.stop'],
    ['r', 'hint.restart'],
    ['k', 'hint.kill'],
    ['o', 'hint.open'],
  ],
  preset: [
    ['↑↓', 'hint.select'],
    ['Enter', 'hint.load'],
    ['^U', 'hint.clear'],
  ],
  save: [
    ['Enter', 'hint.save'],
    ['^U', 'hint.clear'],
  ],
  settings: [
    ['↑↓', 'hint.select'],
    ['←→', 'hint.change'],
    ['Esc', 'hint.close'],
  ],
};
function HelpPanel({ screen }: { screen: Screen }) {
  const rows: (readonly [string, string])[] = [
    ...hints[screen],
    ['Tab / ⇧Tab', 'help.tabs'],
    ['^P ^O ^S ^G', 'help.jump'],
    ['?', 'help.toggle'],
    ['Esc', 'hint.back'],
    ['^C', 'hint.exit'],
  ];
  return (
    <Panel
      title={t('help.title')}
      active
      flexGrow={1}
      meta={<Text color={colors.muted}>{t('help.close')}</Text>}
    >
      {rows.map(([key, label]) => (
        <Text key={`${key}:${label}`}>
          <Text bold color={colors.accent}>
            {key.padEnd(14)}
          </Text>
          <Text>{t(label)}</Text>
        </Text>
      ))}
    </Panel>
  );
}

export function Frame({
  repository,
  directory,
  screen,
  columns,
  rows,
  busy,
  serviceCount,
  error,
  notice,
  helpOpen,
  children,
  onTab,
}: {
  onTab: (tab: Tab) => void;
  repository: string;
  directory: string;
  screen: Screen;
  columns: number;
  rows: number;
  busy: boolean;
  serviceCount: number;
  error: string;
  notice: string;
  helpOpen: boolean;
  children: ReactNode;
}) {
  const section = tabForScreen(screen);
  const tabsRef = useRef<Record<string, DOMElement | null>>({});
  useMouse(!helpOpen, (button, x, y) => {
    if (button !== 0) return;
    for (const [name, node] of Object.entries(tabsRef.current)) {
      if (!node) continue;
      const b = measureElement(node);
      if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) onTab(name as Tab);
    }
  });
  return (
    <Box width={columns} height={rows} flexDirection="column">
      <Box
        height={LOGO_HEIGHT + 2}
        flexShrink={0}
        borderStyle="round"
        borderColor={colors.accent}
        paddingX={1}
        alignItems="center"
        justifyContent="space-between"
      >
        <Box gap={2} alignItems="center" flexShrink={1} overflow="hidden">
          <LogoMark />
          <Box flexDirection="column" overflow="hidden">
            <Text wrap="truncate" bold>
              {safeText(repository)}
            </Text>
            <Text wrap="truncate" color={colors.muted}>
              {safeText(directory)}
            </Text>
          </Box>
        </Box>
        {columns >= 90 && (
          <Text color={colors.muted}>{t('services.summary', { count: serviceCount })}</Text>
        )}
      </Box>
      <Box height={1} paddingX={1} gap={2} flexShrink={0}>
        {(
          [
            ['palette', 'tab.commands', '^P'],
            ['output', 'tab.output', '^O'],
            ['services', 'tab.services', '^S'],
            ['settings', 'tab.settings', '^G'],
          ] as const
        ).map(([name, label, key]) => (
          <Box key={name} ref={(node) => { tabsRef.current[name] = node; }}>
          <Text
            bold={section === name}
            color={section === name ? colors.accent : colors.muted}
            inverse={section === name}
          >
            {' '}
            {t(label)}
            {columns >= 80 ? ` ${key}` : ''}{' '}
          </Text>
          </Box>
        ))}
        <Text color={colors.muted}>{t('tab.hint')}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {columns < 48 || rows < 20 ? (
          <Text color={colors.warning}>{t('terminal.tooSmall')}</Text>
        ) : helpOpen ? (
          <HelpPanel screen={screen} />
        ) : (
          children
        )}
      </Box>
      <Feedback error={error} notice={notice} />
      <Box height={1} paddingX={1} flexShrink={0}>
        <Box flexGrow={1} overflow="hidden">
          <KeyHints items={hints[screen]} />
        </Box>
        <Box width={24} justifyContent="flex-end">
          <KeyHints
            items={[
              ['Esc', screen === 'palette' ? 'hint.quit' : 'hint.back'],
              ['^C', busy ? 'hint.cancel' : 'hint.exit'],
            ]}
          />
        </Box>
      </Box>
    </Box>
  );
}

export function ScreenSlot({ active, children }: { active: boolean; children: ReactNode }) {
  // Preserve local editing state; hidden screens must disable their useInput handlers.
  return (
    <Box display={active ? 'flex' : 'none'} flexDirection="column" flexGrow={1}>
      {children}
    </Box>
  );
}
