import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
import { GET } from '@/app/api/marketing/route';
const old = { period: '01–17.10.2026', updatedAt: '2026-10-18', campaigns: [{id:'old'}], website: { sessions: 123 }, events: [['Запитване', 4]] };
const update = { period: '01–28.10.2026', updatedAt: '2026-10-29', campaigns: [{id:'google',currency:'EUR',cost:10}], metaCampaigns: [{id:'meta',currency:'USD',cost:2,conversions:null}], campaignDaily: [{date:'2026-10-28'}], metaDaily: [], website: {sessions:999}, events: [] };
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'test-key');
  vi.stubEnv('MARKETING_SNAPSHOT_JSON', JSON.stringify(old));
  vi.stubEnv('CAMPAIGNS_SNAPSHOT_JSON', JSON.stringify(update));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {status:200})));
});
afterEach(() => {vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('one-time campaign export', () => {
  it('requires authentication before exposing reports', async () => {
    expect((await GET(new NextRequest('http://localhost/api/marketing'))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refreshes both ad platforms while retaining website data and its actual dates', async () => {
    const response=await GET(new NextRequest('http://localhost/api/marketing',{headers:{'x-firebase-id-token':'test'}}));
    const data=await response.json();
    expect(data.website).toEqual(old.website);
    expect(data.events).toEqual(old.events);
    expect(data.period).toBe(old.period);
    expect(data.updatedAt).toBe(old.updatedAt);
    expect(data.campaignPeriod).toBe(update.period);
    expect(data.campaignUpdatedAt).toBe(update.updatedAt);
    expect(data.campaigns).toEqual(update.campaigns);
    expect(data.metaCampaigns).toEqual(update.metaCampaigns);
    expect(data.campaignDaily).toEqual(update.campaignDaily);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('supports the original export when no update is installed', async () => {
    vi.stubEnv('CAMPAIGNS_SNAPSHOT_JSON','');
    expect(await (await GET(new NextRequest('http://localhost/api/marketing',{headers:{'x-firebase-id-token':'test'}}))).json()).toEqual(old);
  });
});
