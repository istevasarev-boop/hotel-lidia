"use client";
import { useEffect, useState } from "react";
import { PROPERTIES, type Reservation } from "@/domain/reservations/types";
import { estiRequest, downloadBatch } from "@/lib/esti/client";
import { type EstiRecord, type EstiBatch, isLocked } from "@/lib/esti/register";
import { validateEstiExport } from "@/lib/esti/validation";

const button = "rounded-xl border border-stone-200 bg-white px-4 py-3 font-bold text-ink disabled:opacity-50";
export function EstiRegister({ reservations, onOpen, refreshKey }: { reservations: Reservation[]; onOpen: (reservation: Reservation) => void; refreshKey: boolean }) {
  const [records, setRecords] = useState<Record<string, EstiRecord>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("pending");
  const [property, setProperty] = useState("all");
  const [month, setMonth] = useState(() => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Sofia" }).slice(0, 7));
  const [query, setQuery] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    estiRequest().then(result => { if (!cancelled) setRecords(result.records); }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt, refreshKey]);
  function status(r: Reservation) {
    const record = records[r.id];
    if (record?.batches.some(b => b.status === "accepted")) return "accepted";
    if (isLocked(record)) return "exported";
    return record && validateEstiExport(r, record.draft).length === 0 ? "ready" : "missing";
  }
  const labels: Record<string, string> = { missing: "Липсват данни", ready: "Готово за експорт", exported: "Чака резултат", accepted: "Прието · ръчно потвърдено" };
  const visible = reservations.filter(r => (!month || r.checkin.startsWith(month)) && (property === "all" || r.propertyId === property) && `${r.guestName} ${r.checkin} ${r.checkout}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.checkin.localeCompare(a.checkin));
  async function resolve(r: Reservation, batch: EstiBatch, action: "accepted" | "rejected") {
    const prompt = action === "accepted" ? "Потвърждаваш ли, че ЕСТИ е приела ВСИЧКИ гости от този файл? При частично приемане не потвърждавай целия файл." : "Потвърждаваш ли, че НИТО ЕДИН запис от файла не е приет? При частично приемане не генерирай повторен NEW файл.";
    if (!window.confirm(prompt)) return;
    setBusy(true); setError("");
    try { const result = await estiRequest({ reservationId: r.id, action, batchId: batch.id, revision: records[r.id].revision }); setRecords(current => ({ ...current, [r.id]: result.record })); }
    catch (e) { setError(e instanceof Error ? e.message : "Неуспешен запис."); }
    finally { setBusy(false); }
  }
  return <section className="soft-card rounded-3xl p-4 sm:p-6">
    <p className="text-xs font-bold uppercase tracking-widest text-clay">Регистър на гостите</p>
    <h2 className="mt-2 text-3xl font-black">ЕСТИ, с няколко стъпки.</h2>
    <p className="my-3 text-clay">Допълни гостите. Изтегли готовите регистрации. Отбележи резултата след импорта в ЕСТИ.</p>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3">{error}</p>}
    <button className={button} disabled={loading || busy} onClick={() => setAttempt(x => x + 1)}>Обнови</button>
    {loading ? <p className="p-4">Зареждане на регистъра…</p> : !error && <>
    <div className="my-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{Object.entries(labels).map(([key, label]) => <button key={key} className="rounded-2xl border border-stone-200 bg-white p-4 text-left" onClick={() => setView(key)}><span className="text-sm text-clay">{label}</span><strong className="mt-2 block text-3xl">{visible.filter(r => status(r) === key).length}</strong></button>)}</div>
    <div className="my-4 flex flex-wrap gap-2">{[["pending", "За довършване"], ["ready", "Готови"], ["history", "История"], ["all", "Всички"]].map(([key, label]) => <button key={key} className={`${button} ${view === key ? "ring-2 ring-brand-600" : ""}`} onClick={() => setView(key)}>{label}</button>)}
    <select aria-label="Обект" className={button} value={property} onChange={e => setProperty(e.target.value)}><option value="all">Всички обекти</option>{PROPERTIES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <label className="text-sm">Месец на настаняване<input aria-label="Месец на настаняване" type="month" className={button} value={month} onChange={e => setMonth(e.target.value)} /></label><button className={button} onClick={() => setMonth("")}>Всички месеци</button>
    <input aria-label="Търси гост или дата" placeholder="Търси гост или дата" className={button} value={query} onChange={e => setQuery(e.target.value)} /></div>
    <div className="grid gap-3">{visible.filter(r => view === "all" || (view === "pending" ? status(r) === "missing" : view === "history" ? records[r.id]?.batches.length : status(r) === view)).map(r => <article key={r.id} className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold">{r.guestName || "Без име"}</h3><p className="text-sm text-clay">{PROPERTIES.find(p => p.id === r.propertyId)?.name} · {r.checkin} → {r.checkout} · {records[r.id]?.draft.tourists.length || 0} гости</p><p className="mt-2 font-bold">{labels[status(r)]}</p></div><button className={button} onClick={() => onOpen(r)}>Гости / ЕСТИ</button></div>
      {(view === "history" || isLocked(records[r.id])) && records[r.id]?.batches.map(batch => <div key={batch.id} className="mt-4 rounded-xl bg-cream p-3"><p className="mb-2 text-sm">{new Date(batch.createdAt).toLocaleString("bg-BG", { timeZone: "Europe/Sofia" })} · {batch.rows.length} гости · {batch.status === "accepted" ? "Прието · ръчно потвърдено" : batch.status === "rejected" ? "Отхвърлено изцяло" : "Изтеглено · чака резултат"}</p><div className="flex flex-wrap gap-2"><button className={button} onClick={() => downloadBatch(batch, r.propertyId)}>Изтегли същия файл</button>{batch.status === "exported" && <><button className={button} disabled={busy} onClick={() => resolve(r, batch, "accepted")}>Всички са приети</button><button className={button} disabled={busy} onClick={() => resolve(r, batch, "rejected")}>Всички са отхвърлени</button></>}</div></div>)}
    </article>)}</div>
    {!visible.length && <p className="p-5">Няма резервации за избраните филтри.</p>}
    <p className="mt-5 text-sm text-clay">Файловете се качват ръчно в ЕСТИ за съответния обект. Изтегляне ≠ успешно подаване. При частично приемане или корекция на вече приети гости обработи записите в ЕСТИ; не подавай повторно целия файл.</p>
    </>}
  </section>;
}
