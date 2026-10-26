import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { RunResult } from './runtime/process.js';

export function generateCi(provider: 'github' | 'gitlab', task = 'ci'): string {
  if (provider === 'github')
    return `name: Mink\non: [push, pull_request]\njobs:\n  mink:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n          cache: pnpm\n      - run: corepack enable && pnpm install --frozen-lockfile\n      - run: pnpm exec mink ci run ${task} --github-summary\n`;
  return `image: node:24\nstages: [test]\nmink:\n  stage: test\n  script:\n    - corepack enable\n    - pnpm install --frozen-lockfile\n    - pnpm exec mink ci run ${task} --junit mink-junit.xml\n  artifacts:\n    when: always\n    reports:\n      junit: mink-junit.xml\n`;
}

export async function writeJunit(file: string, id: string, result: RunResult): Promise<void> {
  const failed = result.state === 'failed';
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="mink" tests="1" failures="${failed ? 1 : 0}" time="${result.durationMs / 1000}"><testcase classname="mink" name="${xml(id)}" time="${result.durationMs / 1000}">${failed ? `<failure message="${xml(result.error ?? `exit ${result.exitCode}`)}"/>` : ''}</testcase></testsuite>\n`;
  await writeFile(file, body, { flag: 'wx' });
}

export async function exportOtlp(endpoint: string, id: string, result: RunResult): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'mink' } }] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: randomHex(32),
                  spanId: randomHex(16),
                  name: id,
                  startTimeUnixNano: '0',
                  endTimeUnixNano: String(result.durationMs * 1_000_000),
                  status: { code: result.state === 'failed' ? 2 : 1 },
                },
              ],
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenTelemetry export failed: ${response.status}`);
}
function randomHex(length: number): string {
  return randomBytes(length / 2).toString('hex');
}
function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}
