import { useEffect, useEffectEvent } from 'react';
import { useStdin } from 'ink';

/** Subscribe to SGR mouse reports, including reports split across reads. */
export function useMouse(active: boolean, handler: (button: number, x: number, y: number) => void) {
  const { stdin } = useStdin();
  const onMouse = useEffectEvent(handler);
  useEffect(() => {
    if (!active || !('isTTY' in stdin) || !stdin.isTTY) return;
    let pending = '';
    const data = (chunk: string | Buffer) => {
      pending += chunk.toString();
      // eslint-disable-next-line no-control-regex -- SGR terminal mouse reports.
      for (const report of pending.matchAll(/\u001b\[<(\d+);(\d+);(\d+)([Mm])/g)) {
        if (report[4] === 'M')
          onMouse(Number(report[1]), Number(report[2]) - 1, Number(report[3]) - 1);
      }
      // eslint-disable-next-line no-control-regex -- retain incomplete SGR report.
      pending = pending.match(/\u001b(?:\[(?:<(?:\d*(?:;\d*){0,2}))?)?$/)?.[0] ?? '';
    };
    stdin.on('data', data);
    return () => {
      stdin.off('data', data);
    };
  }, [active, stdin]);
}
