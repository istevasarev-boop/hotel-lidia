"use client";

import { useEffect, useState } from "react";
import { getCurrentIdToken } from "@/lib/firebase/auth";

type Snapshot = {
  period: string; updatedAt: string; hostname: string;
  campaigns: { id: string; name: string; status: string; currency: string; impressions: number; clicks: number; cost: number; conversions: number }[];
  website: { sessions: number; users: number; newUsers: number; engagedSessions: number; views: number; averageSessionSeconds: number };
  cities: [string, number][]; devices: [string, number][]; sources: [string, number][]; events: [string, number][];
};
const number = (value: number, decimals = 0) => value.toLocaleString("bg-BG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const percent = (value: number, total: number) => total > 0 ? `${number(value / total * 100, 1)}%` : "—";
const money = (value: number, currency: string) => new Intl.NumberFormat("bg-BG", { style: "currency", currency }).format(value);

export function MarketingView() {
  const [tab, setTab] = useState<"campaigns" | "website">("campaigns");
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const token = await getCurrentIdToken();
        const response = await fetch("/api/marketing", { headers: token ? { "x-firebase-id-token": token } : {}, cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Report unavailable");
        const snapshot: Snapshot = await response.json();
        if (!controller.signal.aborted) setData(snapshot);
      } catch { if (!controller.signal.aborted) setError(true); }
    }
    void load();
    return () => controller.abort();
  }, []);
  if (error) return <p role="alert" className="p-5 text-clay">Отчетът не може да бъде зареден. Отвори раздела отново или влез отново в приложението.</p>;
  if (!data) return <p role="status" className="p-5 text-clay">Зареждане на маркетинговия отчет…</p>;
  const totals = data.campaigns.reduce((sum, row) => ({ cost: sum.cost + row.cost, clicks: sum.clicks + row.clicks, impressions: sum.impressions + row.impressions }), { cost: 0, clicks: 0, impressions: 0 });
  const enquiries = data.events.find(([name]) => name === "Изпратено запитване")?.[1];
  return <div className="space-y-5">
    <div><h2 className="text-2xl font-bold text-ink">Маркетинг и резултати</h2><p className="mt-2 text-sm text-clay">{data.period} · Експорт през Supermetrics: {data.updatedAt.split('-').reverse().join('.')}</p><p className="mt-1 text-sm text-clay">Google Ads + GA4 · {data.hostname}</p></div>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Маркетингови отчети">{([['campaigns', 'Кампании'], ['website', 'Сайт и аудитория']] as const).map(([id, label]) => <button type="button" key={id} id={`marketing-${id}-tab`} role="tab" aria-selected={tab === id} aria-controls={`marketing-${id}-panel`} className={`min-h-11 rounded-xl px-4 py-2 text-sm font-bold ${tab === id ? 'bg-pine text-white' : 'bg-white text-clay'}`} onClick={() => setTab(id)}>{label}</button>)}</div>
    <section id="marketing-campaigns-panel" role="tabpanel" aria-labelledby="marketing-campaigns-tab" hidden={tab !== 'campaigns'} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3"><Stat label="Разход · Google Ads" value={money(totals.cost, 'EUR')} /><Stat label="Кликове" value={number(totals.clicks)} detail={`CTR ${percent(totals.clicks, totals.impressions)}`} /><Stat label="Средна цена на клик" value={totals.clicks ? money(totals.cost / totals.clicks, 'EUR') : '—'} /></div>
      <div className="rounded-2xl bg-white p-4"><h3 className="mb-3 text-lg font-bold text-ink">Активни кампании · Google Ads</h3>
        <table className="hidden w-full text-sm lg:table"><thead><tr className="text-left text-clay"><th className="py-3">Кампания</th>{['Импресии','Кликове','Разход','CTR','Конверсии Ads'].map(label => <th className="p-2 text-right" key={label}>{label}</th>)}</tr></thead><tbody>{data.campaigns.map(row => <tr className="border-t border-stone-200" key={row.id}><td className="py-4">{row.name}<span className="block text-xs text-emerald-700">Активна</span></td>{[number(row.impressions),number(row.clicks),money(row.cost,row.currency),percent(row.clicks,row.impressions),number(row.conversions)].map((value,i) => <td className="p-2 text-right tabular-nums" key={i}>{value}</td>)}</tr>)}</tbody></table>
        <div className="space-y-5 lg:hidden">{data.campaigns.map(row => <div key={row.id}><h4 className="break-words font-bold">{row.name}</h4><p className="mb-2 text-sm text-emerald-700">Активна</p><Rows rows={[["Разход",money(row.cost,row.currency)],["Импресии / кликове",`${number(row.impressions)} / ${number(row.clicks)}`],["CTR",percent(row.clicks,row.impressions)],["Цена на клик",row.clicks ? money(row.cost/row.clicks,row.currency) : '—'],["Конверсии Ads",number(row.conversions)]]} /></div>)}</div>
      </div><p className="rounded-xl bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-950">Конверсиите в Google Ads и запитванията от всички източници на сайта се показват отделно. CPA и ROAS: няма надеждни данни за атрибуция и приходи.</p>
    </section>
    <section id="marketing-website-panel" role="tabpanel" aria-labelledby="marketing-website-tab" hidden={tab !== 'website'} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3"><Stat label="Посещения (сесии)" value={number(data.website.sessions)} detail={`${number(data.website.users)} потребители`} /><Stat label="Изпратени запитвания" value={enquiries === undefined ? "—" : number(enquiries)} detail="Събития, всички източници" /><Stat label="Ангажираност" value={percent(data.website.engagedSessions,data.website.sessions)} detail={`${data.website.engagedSessions} ангажирани сесии`} /></div>
      <div className="grid gap-4 lg:grid-cols-2"><Panel title="Градове"><Rows rows={data.cities.map(([city,sessions]) => [city,`${sessions} · ${percent(sessions,data.website.sessions)}`])} /></Panel><Panel title="Устройства"><Rows rows={data.devices.map(([device,sessions]) => [device,`${sessions} · ${percent(sessions,data.website.sessions)}`])} /></Panel><Panel title="Източници на посещения"><Rows rows={data.sources.map(([source,sessions]) => [source,number(sessions)])} /></Panel><Panel title="Действия на сайта"><Rows rows={data.events.map(([event,count]) => [event,number(count)])} /></Panel><Panel title="Други KPI"><Rows rows={[["Нови потребители",number(data.website.newUsers)],["Прегледи на страници",number(data.website.views)],["Прегледи на сесия",number(data.website.views/data.website.sessions,2)],["Средна сесия",`${number(data.website.averageSessionSeconds)} сек.`]]} /></Panel></div>
      <p className="rounded-xl bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-950">Само {data.hostname}, без тестовия сайт. Събитията не са уникални хора или потвърдени резервации. generate_lead не се добавя повторно към enquiry_submitted.</p>
    </section>
    <p className="text-xs leading-relaxed text-clay">Експорт към {data.updatedAt.split('-').reverse().join('.')} · Автоматичните синхронизации още не са настроени.</p>
  </div>;
}
function Stat({label,value,detail}:{label:string;value:string;detail?:string}) { return <div className="min-w-0 rounded-2xl bg-white p-4"><p className="text-sm text-clay">{label}</p><p className="my-2 break-words text-2xl font-bold tabular-nums text-ink">{value}</p>{detail && <p className="text-xs text-clay">{detail}</p>}</div>; }
function Panel({title,children}:{title:string;children:React.ReactNode}) { return <div className="min-w-0 rounded-2xl bg-white p-4"><h3 className="mb-3 text-lg font-bold text-ink">{title}</h3>{children}</div>; }
function Rows({rows}:{rows:[string,string][]}) { return <dl>{rows.map(([label,value]) => <div key={label} className="flex items-start justify-between gap-3 border-b border-stone-100 py-3 text-sm"><dt className="min-w-0 break-words text-clay">{label}</dt><dd className="shrink-0 text-right font-semibold tabular-nums text-ink">{value}</dd></div>)}</dl>; }
