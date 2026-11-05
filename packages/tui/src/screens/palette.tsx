import { useRef, useState } from 'react';
import { Box, Text, measureElement, useInput, type DOMElement } from 'ink';
import { useMouse } from '../hooks/use-mouse.js';
import type { CommandSearchResult, LocalState } from '@yaroslavlky/mink-core';
import { safeText } from '../actions.js';
import { commandKind, rankCommands } from '../model/commands.js';
import { CommandDetails } from '../components/command-details.js';
import { EmptyState, KindBadge, Panel } from '../components/ui.js';
import type { Viewport } from '../components/frame.js';
import { colors } from '../theme.js';
import { t } from '../i18n.js';
export function PaletteScreen({
  active,
  matches,
  query,
  onQuery,
  state,
  viewport,
  onChoose,
  onFavorite,
}: {
  active: boolean;
  matches: CommandSearchResult[];
  query: string;
  onQuery: (query: string) => void;
  state: LocalState;
  viewport: Viewport;
  onChoose: (id: string) => void;
  onFavorite: (id: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const ranked = rankCommands(matches, query, state),
    selected = Math.min(index, Math.max(0, ranked.length - 1)),
    picked = ranked[selected];
  const contentHeight = viewport.height;
  const showDetails = viewport.wide || contentHeight >= 14;
  const listHeight = viewport.wide || !showDetails ? contentHeight : contentHeight - 6;
  const listWidth = viewport.wide ? Math.floor(viewport.width * 0.56) : viewport.width;
  const visible = Math.max(1, listHeight - 7),
    offset = Math.max(0, selected - visible + 1);
  const list = useRef<DOMElement>(null);
  useMouse(active, (button, x, y) => {
    if (!list.current) return;
    const bounds = measureElement(list.current);
    if (x < bounds.x || x >= bounds.x + bounds.width || y < bounds.y || y >= bounds.y + bounds.height) return;
    if ((button & ~29) === 64) {
      setIndex((value) => Math.max(0, Math.min(ranked.length - 1, value + (button & 1 ? 3 : -3))));
    } else if (button === 0) {
      const next = offset + y - bounds.y;
      if (next < ranked.length) setIndex(next);
    }
  });
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'f' && picked) {
        onFavorite(picked.id);
        return;
      }
      if (key.ctrl && input === 'u') {
        onQuery('');
        setIndex(0);
        return;
      }
      if (key.ctrl || key.meta || key.escape) return;
      if (key.upArrow) {
        setIndex((value) => Math.max(0, value - 1));
        return;
      }
      if (key.downArrow) {
        setIndex((value) => Math.min(ranked.length - 1, value + 1));
        return;
      }
      if (key.return) {
        if (picked) onChoose(picked.id);
        return;
      }
      if (
        key.tab ||
        key.leftArrow ||
        key.rightArrow ||
        key.home ||
        key.end ||
        key.pageDown ||
        key.pageUp
      )
        return;
      onQuery(
        key.backspace || key.delete
          ? query.slice(0, -1)
          : query + safeText(input).replace(/[\n\t]/g, ''),
      );
      setIndex(0);
    },
    { isActive: active },
  );
  return (
    <Box flexDirection="column" height={viewport.height}>
      <Box
        flexDirection={viewport.wide ? 'row' : 'column'}
        gap={viewport.wide ? 1 : 0}
        height={contentHeight}
        flexShrink={0}
      >
        <Panel
          title={t('tab.commands')}
          meta={<Text color={colors.muted}>{t('palette.matches', { count: ranked.length })}</Text>}
          active
          width={listWidth}
          height={listHeight}
        >
          <Box
            borderStyle="round"
            borderColor={colors.accent}
            paddingX={1}
            height={3}
            flexShrink={0}
          >
            <Text wrap="truncate">
              <Text color={colors.accent}>{t('palette.search')}</Text>
              {safeText(query)}
              <Text inverse> </Text>
            </Text>
          </Box>
          <Box ref={list} flexGrow={1} flexDirection="column" overflow="hidden">
            {!ranked.length && (
              <EmptyState title={t('palette.emptyTitle')} detail={t('palette.emptyDetail')} />
            )}
            {ranked.slice(offset, offset + visible).map((match, row) => (
              <Box key={match.id} height={1} justifyContent="space-between">
                <Box flexGrow={1} overflow="hidden">
                  <Text
                    wrap="truncate"
                    backgroundColor={offset + row === selected ? colors.focus : undefined}
                  >
                    <Text color={colors.accent}>{offset + row === selected ? '› ' : '  '}</Text>
                    <Text bold={offset + row === selected}>
                      {state.favorites.includes(match.id) ? '★ ' : ''}
                      {safeText(match.id)}
                    </Text>
                    <Text color={offset + row === selected ? colors.text : colors.muted}>
                      {' '}
                      · {safeText(match.entry.name)}
                    </Text>
                  </Text>
                </Box>
                <KindBadge kind={commandKind(match.entry)} />
              </Box>
            ))}
          </Box>
          <Text color={colors.muted} wrap="truncate">
            {t('palette.footer', {
              count: ranked.length ? `${selected + 1}/${ranked.length}` : '0',
            })}
          </Text>
        </Panel>
        {showDetails && (
          <CommandDetails
            id={picked?.id}
            entry={picked?.entry}
            width={viewport.wide ? viewport.width - listWidth - 1 : viewport.width}
            height={viewport.wide ? contentHeight : 6}
            compact={!viewport.wide}
          />
        )}
      </Box>
    </Box>
  );
}
