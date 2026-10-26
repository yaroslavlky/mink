import { useContext, useEffect, useEffectEvent, useRef, useState } from 'react';
import { Box, Text, measureElement, useInput, useStdin, useStdout, type DOMElement } from 'ink';
import { filterLogLines, type LogLine } from '../model/log-buffer.js';
import { LogInputContext } from './log-input.js';
import { Input } from './input.js';
import { colors } from '../theme.js';
import { safeText } from '../actions.js';
import { t } from '../i18n.js';
export function LogView({
  active = true,
  lines: source,
  height,
  truncated,
  showOwner = true,
}: {
  active?: boolean;
  lines: LogLine[];
  height: number;
  truncated: boolean;
  showOwner?: boolean;
}) {
  const [anchor, setAnchor] = useState<string>();
  const [query, setQuery] = useState(''),
    [editing, edit] = useState(false),
    [stream, setStream] = useState('all'),
    [owner, setOwner] = useState<string>();
  const { setEditing } = useContext(LogInputContext);
  useEffect(() => {
    if (active) setEditing(editing);
    return () => {
      if (active) setEditing(false);
    };
  }, [active, editing, setEditing]);
  const lines = filterLogLines(source, query, stream, owner);
  const count = Math.max(1, height - 2),
    tail = Math.max(0, lines.length - count);
  const start = anchor
    ? Math.max(
        0,
        lines.findIndex((line) => line.key === anchor),
      )
    : tail;
  const box = useRef<DOMElement>(null);
  const { stdin } = useStdin();
  const { stdout } = useStdout();
  const wheel = useEffectEvent((button: number, x: number, y: number) => {
    if (editing || !box.current || (button & ~29) !== 64) return;
    const bounds = measureElement(box.current);
    if (
      x < bounds.x ||
      x >= bounds.x + bounds.width ||
      y < bounds.y ||
      y >= bounds.y + bounds.height
    )
      return;
    setAnchor((current) => {
      const position = current
        ? Math.max(
            0,
            lines.findIndex((line) => line.key === current),
          )
        : tail;
      const next = Math.max(0, Math.min(tail, position + (button & 1 ? 3 : -3)));
      return next === tail ? undefined : lines[next]?.key;
    });
  });
  useEffect(() => {
    if (!active || !('isTTY' in stdin) || !stdin.isTTY) return;
    const terminal = 'isTTY' in stdout && stdout.isTTY;
    // SGR mouse reporting preserves coordinates beyond the legacy 223-column limit.
    if (terminal) stdout.write('\u001b[?1000h\u001b[?1006h');
    let pending = '';
    const data = (chunk: string | Buffer) => {
      pending += chunk.toString();
      // eslint-disable-next-line no-control-regex -- Terminal mouse escape sequence.
      const reports = /\u001b\[<(\d+);(\d+);(\d+)([Mm])/g;
      for (const report of pending.matchAll(reports)) {
        if (report[4] === 'M')
          wheel(Number(report[1]), Number(report[2]) - 1, Number(report[3]) - 1);
      }
      // Keep only an incomplete mouse report when a read splits an escape sequence.
      // eslint-disable-next-line no-control-regex -- Partial terminal mouse escape sequence.
      pending = pending.match(/\u001b(?:\[(?:<(?:\d*(?:;\d*){0,2}))?)?$/)?.[0] ?? '';
    };
    stdin.on('data', data);
    return () => {
      stdin.off('data', data);
      if (terminal) stdout.write('\u001b[?1006l\u001b[?1000l');
    };
  }, [active, stdin, stdout]);
  useInput(
    (input, key) => {
      if (editing) {
        if (key.escape) edit(false);
        return;
      }
      if (input === '/' && !key.ctrl && !key.meta) {
        setEditing(true);
        edit(true);
        return;
      }
      if (key.ctrl && input === 'u') {
        setQuery('');
        setOwner(undefined);
        setStream('all');
        setAnchor(undefined);
        return;
      }
      if (key.ctrl && input === 'l') {
        setStream((value) => (value === 'all' ? 'stdout' : value === 'stdout' ? 'stderr' : 'all'));
        setAnchor(undefined);
        return;
      }
      if (key.ctrl && input === 'n') {
        const owners = [...new Set(source.map((line) => line.id))];
        const next = owner ? owners[owners.indexOf(owner) + 1] : owners[0];
        setOwner(next);
        setAnchor(undefined);
        return;
      }
      if (key.pageUp) setAnchor(lines[Math.max(0, start - count)]?.key);
      if (key.pageDown) {
        const next = Math.min(tail, start + count);
        setAnchor(next === tail ? undefined : lines[next]?.key);
      }
      if (key.home) setAnchor(lines[0]?.key);
      if (key.end) setAnchor(undefined);
    },
    { isActive: active },
  );
  return (
    <Box ref={box} flexDirection="column" height={height} overflow="hidden">
      <Box height={1} flexShrink={0}>
        {editing ? (
          <>
            <Text color={colors.accent}>/ </Text>
            <Input
              active={active}
              initial={query}
              submit={(value) => {
                setQuery(value);
                edit(false);
                setAnchor(undefined);
              }}
            />
          </>
        ) : (
          <Text color={colors.muted} wrap="truncate">
            {t('log.filters', { stream, owner: owner ?? '*', query: query || '—' })}
          </Text>
        )}
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {!lines.length && <Text color={colors.muted}>{t('log.waiting')}</Text>}
        {lines.slice(start, start + count).map((line) => (
          <Text key={line.key} wrap="truncate">
            {showOwner && <Text color={colors.muted}>[{safeText(line.id)}] </Text>}
            <Text color={line.stream === 'stderr' ? colors.danger : colors.text}>
              {line.text || ' '}
            </Text>
          </Text>
        ))}
      </Box>
      <Text wrap="truncate" color={anchor ? colors.warning : colors.muted}>
        <Text color={anchor ? colors.warning : colors.success}>
          {anchor ? t('log.paused') : t('log.live')}
        </Text>{' '}
        ·{' '}
        {lines.length
          ? `${start + 1}–${Math.min(start + count, lines.length)}/${lines.length}`
          : t('log.lines', { count: 0 })}{' '}
        · {t('log.footer')}
        {truncated ? ` · ${t('log.trimmed')}` : ''}
      </Text>
    </Box>
  );
}
