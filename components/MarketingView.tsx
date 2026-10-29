"use client";

import { useEffect, useState } from "react";
import { MarketingDashboard } from "./MarketingDashboard";
import { getCurrentIdToken } from "@/lib/firebase/auth";

export type Campaign = { id: string; name: string; status: string; currency: string; impressions: number; clicks: number; cost: number; conversions: number | null; allConversions?: number | null; landingPageViews?: number | null; date?: string };
export type Snapshot = {
  period: string; updatedAt: string; hostname: string;
  campaigns: Campaign[];
  metaCampaigns?: Campaign[]; campaignDaily?: Campaign[]; metaDaily?: Campaign[];
  campaignPeriod?: string; campaignUpdatedAt?: string; metaAttribution?: string;
  website: { sessions: number; users: number; newUsers: number; engagedSessions: number; views: number; averageSessionSeconds: number };
  cities: [string, number][]; devices: [string, number][]; sources: [string, number][]; events: [string, number][];
};
const number = (value: number, decimals = 0) => value.toLocaleString("bg-BG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const percent = (value: number, total: number) => total > 0 ? `${number(value / total * 100, 1)}%` : "—";
const money = (value: number, currency: string) => new Intl.NumberFormat("bg-BG", { style: "currency", currency }).format(value);

export function MarketingView({ tab = "campaigns" }: { tab?: "campaigns" | "website" }) {
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
  return <MarketingDashboard data={data} tab={tab} campaignDetails={<><CampaignPanel title="Google Ads" campaigns={data.campaigns} daily={data.campaignDaily} />{data.metaCampaigns && <CampaignPanel title="Meta Ads" campaigns={data.metaCampaigns} daily={data.metaDaily} meta />}</>} />;
}

function Stat({label,value,detail}:{label:string;value:string;detail?:string}) { return <div className="min-w-0 rounded-2xl bg-white p-4"><p className="text-sm text-clay">{label}</p><p className="my-2 break-words text-2xl font-bold tabular-nums text-ink">{value}</p>{detail && <p className="text-xs text-clay">{detail}</p>}</div>; }
function Panel({title,children}:{title:string;children:React.ReactNode}) { return <div className="min-w-0 rounded-2xl bg-white p-4"><h3 className="mb-3 text-lg font-bold text-ink">{title}</h3>{children}</div>; }
function Rows({rows}:{rows:[string,string][]}) { return <dl>{rows.map(([label,value]) => <div key={label} className="flex items-start justify-between gap-3 border-b border-stone-100 py-3 text-sm"><dt className="min-w-0 break-words text-clay">{label}</dt><dd className="shrink-0 text-right font-semibold tabular-nums text-ink">{value}</dd></div>)}</dl>; }

function CampaignPanel({ title, campaigns, daily = [], meta = false }: { title: string; campaigns: Campaign[]; daily?: Campaign[]; meta?: boolean }) {
  const metric = (value: number | null | undefined) => value == null ? "—" : number(value, Number.isInteger(value) ? 0 : 2);
  const currencies = [...new Set(campaigns.map(row => row.currency))];
  const dailyRows = [...daily].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.name.localeCompare(b.name));
  return <div className="space-y-3">
    <h3 className="text-xl font-bold text-ink">{title}</h3>
    {currencies.map(currency => {
      const rows = campaigns.filter(row => row.currency === currency);
      const totals = rows.reduce((s, r) => ({ cost: s.cost + r.cost, clicks: s.clicks + r.clicks, impressions: s.impressions + r.impressions }), { cost: 0, clicks: 0, impressions: 0 });
      return <div key={currency} className="grid grid-cols-2 gap-3 lg:grid-cols-3"><Stat label={`Разход · ${currency}`} value={money(totals.cost, currency)} /><Stat label={meta ? "Кликове по линка" : "Кликове"} value={number(totals.clicks)} detail={`CTR ${percent(totals.clicks, totals.impressions)}`} /><Stat label="Средна цена на клик" value={totals.clicks ? money(totals.cost / totals.clicks, currency) : "—"} /></div>;
    })}
    {campaigns.map(row => <Panel key={row.id} title={row.name}>
      <p className="text-sm text-emerald-700">{["enabled", "active"].includes(row.status.toLowerCase()) ? "Активна" : "Спряна"} · статус към експорта</p>
      <Rows rows={[["Разход", money(row.cost, row.currency)], ["Показвания", number(row.impressions)], [meta ? "Кликове по линка" : "Кликове", number(row.clicks)], ["CTR", percent(row.clicks, row.impressions)], ["Цена на клик", row.clicks ? money(row.cost / row.clicks, row.currency) : "—"], [meta ? "Запитвания през сайта (Meta)" : "Основни конверсии", metric(row.conversions)], [meta ? "Зареждания на страницата" : "Всички конверсии", metric(meta ? row.landingPageViews : row.allConversions)]]} />
    </Panel>)}
    {dailyRows.length > 0 && <details className="rounded-2xl bg-white p-4"><summary className="cursor-pointer font-bold text-ink">Дневна разбивка · {title}</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-clay">{["Дата", "Кампания", "Показвания", meta ? "Кликове по линка" : "Кликове", "Разход", meta ? "Запитвания" : "Основни конверсии", meta ? "Зареждания" : "Всички конверсии"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{dailyRows.map(row => <tr className="border-t border-stone-200" key={`${row.date}-${row.id}`}><td className="whitespace-nowrap p-2">{row.date?.split("-").reverse().join(".")}</td><td className="min-w-40 p-2">{row.name}</td>{[number(row.impressions), number(row.clicks), money(row.cost, row.currency), metric(row.conversions), metric(meta ? row.landingPageViews : row.allConversions)].map((value, i) => <td className="whitespace-nowrap p-2 text-right tabular-nums" key={i}>{value}</td>)}</tr>)}</tbody></table></div></details>}
  </div>;
}
