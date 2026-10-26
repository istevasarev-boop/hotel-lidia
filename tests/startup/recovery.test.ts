import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { withDeadline } from '@/lib/deadline';
function worker(fetch: typeof globalThis.fetch) {
  const handlers: Record<string, (event: any) => void> = {};
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self: { addEventListener: (name: string, handler: any) => handlers[name] = handler },
    fetch, Response, AbortController, setTimeout, clearTimeout
  });
  return handlers.fetch;
}
function navigate(handler: ReturnType<typeof worker>) {
  let result!: Promise<Response>;
  handler({ request: { method: 'GET', mode: 'navigate' }, respondWith: (p: Promise<Response>) => result = p });
  return result;
}
afterEach(() => vi.useRealTimers());
describe('mobile startup recovery', () => {
  it('leaves navigation, scripts and API requests to the browser', () => {
    expect(worker(vi.fn())).toBeUndefined();
  });
  it('bounds waiting for a stalled SDK operation', async () => {
    vi.useFakeTimers();
    const pending = withDeadline(new Promise(() => {}), 100);
    const assertion = expect(pending).rejects.toThrow('твърде дълго');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});
