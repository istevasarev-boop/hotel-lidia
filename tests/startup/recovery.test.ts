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
  it('returns a usable recovery page when navigation fails', async () => {
    const response = await navigate(worker(vi.fn().mockRejectedValue(new TypeError('offline'))));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('Опитай отново');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('preserves a successful server response', async () => {
    const response = new Response('app');
    expect(await navigate(worker(vi.fn().mockResolvedValue(response)))).toBe(response);
  });
  it('provides recovery on server errors', async () => {
    const response = await navigate(worker(vi.fn().mockResolvedValue(new Response('', { status: 504 }))));
    expect(await response.text()).toContain('Опитай отново');
  });
  it('does not intercept API or Firebase requests', () => {
    const respondWith = vi.fn();
    worker(vi.fn())({ request: { method: 'GET', mode: 'cors' }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });
  it('aborts stalled navigation and returns recovery', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_request, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))));
    const result = navigate(worker(fetch as any));
    await vi.advanceTimersByTimeAsync(15000);
    expect((await result).status).toBe(503);
  });
  it('bounds waiting for a stalled SDK operation', async () => {
    vi.useFakeTimers();
    const pending = withDeadline(new Promise(() => {}), 100);
    const assertion = expect(pending).rejects.toThrow('твърде дълго');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});
