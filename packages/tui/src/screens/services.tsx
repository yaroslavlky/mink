import { useContext, useRef, useState } from 'react';
import { LogInputContext } from '../components/log-input.js';
import { Box, Text, measureElement, useInput, type DOMElement } from 'ink';
import { useMouse } from '../hooks/use-mouse.js';
import type { ServiceInfo } from '@yaroslavlky/mink-core';
import type { LogBuffer } from '../model/log-buffer.js';
import { Panel, EmptyState, StatusBadge } from '../components/ui.js';
import { LogView } from '../components/log-view.js';
import type { Viewport } from '../components/frame.js';
import { safeText } from '../actions.js';
import { colors } from '../theme.js';
import { t } from '../i18n.js';
export function ServicesScreen({
  active,
  services,
  logs,
  viewport,
  onStop,
  onRestart,
  onOpen,
}: {
  active: boolean;
  services: ServiceInfo[];
  logs: LogBuffer;
  viewport: Viewport;
  onStop: (instance: string, force?: boolean) => void;
  onRestart: (instance: string) => void;
  onOpen: (url: string) => void;
}) {
  const [index, setIndex] = useState(0),
    selected = Math.min(index, Math.max(0, services.length - 1)),
    service = services[selected];
  const { editingRef } = useContext(LogInputContext);
  const list = useRef<DOMElement>(null);
  const listHeightForMouse = viewport.wide ? viewport.height : Math.min(7, viewport.height - 6);
  const visibleForMouse = Math.max(1, listHeightForMouse - 3);
  const offsetForMouse = Math.max(0, selected - visibleForMouse + 1);
  useMouse(active, (button, x, y) => {
    if (!list.current || editingRef.current) return;
    const b = measureElement(list.current);
    if (x < b.x || x >= b.x + b.width || y < b.y || y >= b.y + b.height) return;
    if ((button & ~29) === 64) setIndex((value) => Math.max(0, Math.min(services.length - 1, value + (button & 1 ? 3 : -3))));
    else if (button === 0 && offsetForMouse + y - b.y < services.length) setIndex(offsetForMouse + y - b.y);
  });
  useInput(
    (input, key) => {
      if (editingRef.current || key.ctrl || key.meta) return;
      if (key.upArrow) setIndex((value) => Math.max(0, value - 1));
      if (key.downArrow) setIndex((value) => Math.min(services.length - 1, value + 1));
      if (!service) return;
      if (input === 's') onStop(service.instance);
      if (input === 'k') onStop(service.instance, true);
      if (input === 'r') onRestart(service.instance);
      if (input === 'o' && service.url) onOpen(service.url);
    },
    { isActive: active },
  );
  if (!service)
    return (
      <Panel title={t('services.ownedTitle')} width={viewport.width} height={viewport.height}>
        <EmptyState title={t('services.emptyTitle')} detail={t('services.emptyDetail')} />
      </Panel>
    );
  const width = viewport.wide ? Math.floor(viewport.width * 0.38) : viewport.width,
    listHeight = viewport.wide ? viewport.height : Math.min(7, viewport.height - 6);
  const visible = Math.max(1, listHeight - 3),
    offset = Math.max(0, selected - visible + 1),
    outputHeight = viewport.wide ? viewport.height : viewport.height - listHeight;
  return (
    <Box
      flexDirection={viewport.wide ? 'row' : 'column'}
      gap={viewport.wide ? 1 : 0}
      height={viewport.height}
    >
      <Panel
        title={t('common.services')}
        width={width}
        height={listHeight}
        meta={<Text color={colors.muted}>{t('services.owned', { count: services.length })}</Text>}
      >
        <Box ref={list} flexDirection="column" flexGrow={1} overflow="hidden">
        {services.slice(offset, offset + visible).map((owned, row) => (
          <Text
            key={owned.instance}
            backgroundColor={offset + row === selected ? colors.focus : undefined}
            wrap="truncate"
          >
            <Text color={colors.accent}>{offset + row === selected ? '›' : ' '} </Text>
            <Text bold>{safeText(owned.id)}</Text> <StatusBadge state={owned.state} />
          </Text>
        ))}
        </Box>
      </Panel>
      <Panel
        title={t('services.output')}
        active
        width={viewport.wide ? viewport.width - width - 1 : viewport.width}
        height={outputHeight}
        meta={<StatusBadge state={service.state} />}
      >
        <Text wrap="truncate" color={colors.muted}>
          {safeText(service.id)} · {Math.floor((Date.now() - service.started) / 1000)}s ·{' '}
          {safeText(service.url ?? t('services.noHealth'))}
        </Text>
        <LogView
          active={active}
          key={service.instance}
          lines={logs.lines({ instance: service.instance })}
          height={outputHeight - 4}
          truncated={logs.truncated}
          showOwner={false}
        />
      </Panel>
    </Box>
  );
}
