import { useRef, useState } from 'react';
import { Box, Text, measureElement, useInput, type DOMElement } from 'ink';
import { useMouse } from '../hooks/use-mouse.js';
import type { ExecutionPlan } from '@yaroslavlky/mink-core';
import { safeText } from '../actions.js';
import { commandKind, commandPreview, planRows, type CommandEntry } from '../model/commands.js';
import { KindBadge, Panel } from '../components/ui.js';
import { PipelineSteps } from '../components/pipeline-steps.js';
import type { Viewport } from '../components/frame.js';
import { colors } from '../theme.js';
import { t } from '../i18n.js';
export function PreviewScreen({
  active,
  id,
  entry,
  plan,
  error,
  viewport,
  onRun,
  onEdit,
  onPreset,
  onSave,
  onCopy,
  onForeground,
}: {
  active: boolean;
  id: string;
  entry: CommandEntry;
  plan?: ExecutionPlan;
  error?: string;
  viewport: Viewport;
  onRun: () => void;
  onEdit: () => void;
  onPreset: () => void;
  onSave: () => void;
  onCopy: () => void;
  onForeground?: () => void;
}) {
  const [offset, setOffset] = useState(0),
    rows = plan ? planRows(plan) : [];
  const headerHeight = entry.kind === 'pipeline' ? 6 : Math.min(10, viewport.height - 5),
    graphHeight = viewport.height - headerHeight;
  const visible = Math.max(1, graphHeight - 4);
  const graph = useRef<DOMElement>(null);
  useMouse(active, (button, x, y) => {
    if (!graph.current || (button & ~29) !== 64) return;
    const b = measureElement(graph.current);
    if (x < b.x || x >= b.x + b.width || y < b.y || y >= b.y + b.height) return;
    setOffset((value) => Math.max(0, Math.min(Math.max(0, rows.length - visible), value + (button & 1 ? 3 : -3))));
  });
  useInput(
    (input, key) => {
      if (key.ctrl || key.meta || key.escape) return;
      if (key.return && plan) {
        if (key.shift && onForeground) onForeground();
        else onRun();
      }
      if (input === 'e') onEdit();
      if (input === 'p') onPreset();
      if (input === 's') onSave();
      if (input === 'c' && plan) onCopy();
      if (key.pageDown)
        setOffset((value) => Math.min(Math.max(0, rows.length - visible), value + visible));
      if (key.pageUp) setOffset((value) => Math.max(0, value - visible));
    },
    { isActive: active },
  );
  return (
    <Box flexDirection="column" height={viewport.height}>
      <Panel
        title={t('preview.review')}
        active
        height={headerHeight}
        meta={<KindBadge kind={commandKind(entry)} />}
      >
        <Text bold wrap="truncate">
          {safeText(id)} · {safeText(entry.name)}
        </Text>
        <Text color={colors.muted} wrap="truncate">
          {t('preview.cwd', { cwd: safeText(plan?.prepared?.cwd ?? t('preview.repositoryDir')) })}
        </Text>
        {plan?.prepared && (
          <Box
            flexGrow={1}
            borderStyle={viewport.height >= 16 ? 'single' : undefined}
            borderColor={colors.muted}
            paddingX={1}
            overflow="hidden"
          >
            <Text>{safeText(commandPreview(plan.prepared, entry))}</Text>
          </Box>
        )}
        {entry.kind === 'pipeline' && (
          <Text color={colors.pipeline}>
            {t('preview.graph', {
              parallel:
                plan?.maxParallel === Infinity ? t('common.unlimited') : (plan?.maxParallel ?? '—'),
            })}
          </Text>
        )}
        {error && (
          <Text color={colors.danger} wrap="truncate">
            {safeText(error)}
          </Text>
        )}
      </Panel>
      <Panel
        title={entry.kind === 'pipeline' ? t('preview.steps') : t('preview.plan')}
        height={graphHeight}
        meta={<Text color={colors.muted}>PgUp/PgDn</Text>}
      >
        <Box ref={graph} flexDirection="column" flexGrow={1} overflow="hidden">
          <PipelineSteps rows={rows.slice(offset)} limit={visible} />
        </Box>
        <Text color={colors.muted} wrap="truncate">
          {t('preview.footer')}
        </Text>
      </Panel>
    </Box>
  );
}
