"use client";

import { useEffect, useRef, useState } from "react";
import { EnquiryAvailabilityBadge } from "@/components/EnquiryAvailabilityBadge";
import { getEnquiryAvailability, type AvailabilityRequest } from "@/domain/enquiries/availability";
import { validateReservationConflict } from "@/domain/reservations/conflicts";
import type { Reservation } from "@/domain/reservations/types";

const enquiries: Array<AvailabilityRequest & { id: string; name: string; interest: string; phone: string; email: string; notes: string }> = [
  { id: "whole-free", name: "Примерен гост 1", phone: "+359 88 XXX XXXX", email: "guest1@example.com", notes: "Примерна бележка: очакваме да пристигнем след 15:00 ч.", interest: "Вила Лидия · Целият имот", propertyId: "villa", checkin: "2026-11-13", checkout: "2026-11-15", requestedRooms: ["whole"], adults: 8, children: 0 },
  { id: "whole-busy", name: "Примерен гост 2", phone: "+359 88 XXX XXXX", email: "guest2@example.com", notes: "Примерна бележка: очакваме да пристигнем след 15:00 ч.", interest: "Къща Лидия · Целият имот", propertyId: "house", checkin: "2026-11-13", checkout: "2026-11-15", requestedRooms: ["whole"], adults: 6, children: 0 },
  { id: "room", name: "Примерен гост 3", phone: "+359 88 XXX XXXX", email: "guest3@example.com", notes: "Примерна бележка: очакваме да пристигнем след 15:00 ч.", interest: "Вила Лидия · Стая с джакузи", propertyId: "villa", checkin: "2026-11-13", checkout: "2026-11-15", requestedRooms: ["jacuzzi"], adults: 2, children: 1 },
  { id: "busy-room", name: "Примерен гост 4", phone: "+359 88 XXX XXXX", email: "guest4@example.com", notes: "Примерна бележка: очакваме да пристигнем след 15:00 ч.", interest: "Къща Лидия · Стая без джакузи", propertyId: "house", checkin: "2026-11-13", checkout: "2026-11-15", requestedRooms: ["no_jacuzzi"], adults: 2, children: 0 }
];
const occupiedHouse: Reservation = { id: "demo-house", propertyId: "house", rooms: ["all"], checkin: "2026-11-14", checkout: "2026-11-16", guestName: "Демо", phone: "", notes: "", totalAmount: 0, depositAmount: 0, status: "pending", createdAt: "", updatedAt: "" };

export default function EnquiryAvailabilityDemo() {
  const [selectedId, setSelectedId] = useState(enquiries[0].id);
  const [villaOccupied, setVillaOccupied] = useState(false);
  const [calendarReady, setCalendarReady] = useState(true);
  const [saved, setSaved] = useState<Reservation[]>([]);
  const [draft, setDraft] = useState<Reservation | null>(null);
  const [capacityConfirmed, setCapacityConfirmed] = useState(false);
  const [formError, setFormError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hasDraft = !!draft;
  useEffect(() => { if (hasDraft) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [hasDraft]);
  const reservations: Reservation[] = [...saved, occupiedHouse, ...(villaOccupied ? [{ ...occupiedHouse, id: "demo-villa", propertyId: "villa" as const, rooms: ["5"], checkin: "2026-11-13" }] : [])];
  const selected = enquiries.find(item => item.id === selectedId)!;
  const availability = getEnquiryAvailability(selected, reservations, calendarReady);
  const alreadyCreated = saved.some(item => item.id === selected.id);
  const canCreate = calendarReady && !alreadyCreated && availability.status !== "occupied" && availability.freeRooms.length > 0;
  function openReservation() {
    if (!canCreate) return;
    setCapacityConfirmed(false);
    setFormError("");
    setDraft({ id: selected.id, propertyId: selected.propertyId as Reservation["propertyId"], rooms: selected.requestedRooms.includes("whole") ? ["all"] : [], checkin: selected.checkin, checkout: selected.checkout, guestName: selected.name, phone: selected.phone, notes: `Email: ${selected.email}\nГости: ${selected.adults} възрастни, ${selected.children} деца\nИнтерес: ${selected.interest}\n${selected.notes}`, source: "vilalidia.bg", depositAmount: 0, totalAmount: 0, status: "pending", createdAt: "", updatedAt: "" });
  }
  return <main className="min-h-screen bg-cream px-4 py-6 text-ink sm:p-8"><div className="mx-auto max-w-6xl">
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">ИНТЕРАКТИВНО ДЕМО · Измислени запитвания и календар. Няма запис в базата и не се изпращат съобщения.</div>
    <header className="my-6"><p className="text-sm font-bold text-brand-700">Hotel Lidia / Запитвания</p><h1 className="mt-2 text-3xl font-black">Наличността е на един поглед</h1><p className="mt-2 text-clay">Изберете запитване и променете примерната заетост.</p></header>
    <section className="mb-5 flex flex-wrap gap-3 rounded-2xl border border-stone-200 bg-white p-4" aria-label="Управление на демото">
      <button type="button" aria-pressed={villaOccupied} onClick={() => setVillaOccupied(value => !value)} className="rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">{villaOccupied ? "Освободи стая 5 във вилата" : "Симулирай резервация за стая 5"}</button>
      <button type="button" aria-pressed={!calendarReady} onClick={() => setCalendarReady(value => !value)} className="rounded-xl border border-stone-300 px-4 py-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{calendarReady ? "Симулирай липса на връзка" : "Възстанови връзката"}</button>
    </section>
    <div className="grid items-start gap-4 lg:grid-cols-[0.95fr_1.35fr]">
      <div className="grid gap-3">{enquiries.map(item => <button key={item.id} type="button" aria-pressed={item.id === selectedId} onClick={() => setSelectedId(item.id)} className={`rounded-2xl border bg-white p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 ${item.id === selectedId ? "border-brand-300 ring-2 ring-brand-100" : "border-stone-200"}`}>
        <div className="flex flex-wrap items-center gap-2"><strong>{item.name}</strong><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">Ново</span></div>
        <p className="mt-2 text-sm font-semibold text-clay">{item.interest}</p><p className="mt-3 text-sm text-clay">13 - 15 ноември 2026 · {item.adults + item.children} гости</p>
        <EnquiryAvailabilityBadge availability={getEnquiryAvailability(item, reservations, calendarReady)} />
      </button>)}</div>
      <article className="rounded-3xl border border-stone-200 bg-white p-5 sm:p-6">
        <p className="text-sm font-bold text-brand-700">Запитване от сайта</p><h2 className="mt-2 text-2xl font-black">{selected.name}</h2><p className="mt-2 font-semibold text-clay">{selected.interest}</p>
        <div className="my-5 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-cream p-3"><p className="text-xs font-bold text-clay">Период</p><p className="mt-1 font-bold">13 - 15 ноември</p></div><div className="rounded-2xl bg-cream p-3"><p className="text-xs font-bold text-clay">Гости</p><p className="mt-1 font-bold">{selected.adults} възр. · {selected.children} деца</p></div></div>
        <dl className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-stone-200 p-3"><dt className="text-xs font-bold text-clay">Телефон (примерен)</dt><dd className="mt-1 font-bold">{selected.phone}</dd></div>
          <div className="min-w-0 rounded-2xl border border-stone-200 p-3"><dt className="text-xs font-bold text-clay">Имейл (примерен)</dt><dd className="mt-1 break-all font-bold">{selected.email}</dd></div>
          <div className="rounded-2xl bg-cream p-3 sm:col-span-2"><dt className="text-xs font-bold text-clay">Бележка от госта</dt><dd className="mt-1 text-sm">{selected.notes}</dd></div>
        </dl>
        <div aria-live="polite"><EnquiryAvailabilityBadge availability={availability} expanded /></div>
        <button type="button" onClick={openReservation} disabled={!canCreate} className="mt-4 min-h-12 w-full rounded-xl bg-brand-600 px-4 py-3 font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-600">{alreadyCreated ? "✓ Създадена в демо календара" : "Създай резервация"}</button>
        <p className="mt-2 text-sm text-clay">{alreadyCreated ? "Само в тази сесия. Презареждането изчиства примерния запис." : canCreate ? "Един тап пренася данните. Допълвате цена, капаро и потвърждавате." : "Първо е нужна свободна стая и връзка с календара."}</p>
        <div className="mt-5 rounded-2xl bg-cream p-4"><h3 className="font-bold">Какво показва демо календарът</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-clay"><li>Къщата е резервирана от 14 до 16 ноември. Това пресича заявения престой.</li><li>{villaOccupied ? "Стая 5 във вилата вече е заета. Цялата вила не може да се предложи." : "Всички стаи във вилата са свободни през заявения период."}</li><li>За отделна стая показваме свободните номера. Леглата и разпределението на гостите изискват проверка.</li></ul></div>
      </article>
    </div>
  </div>
  <dialog ref={dialogRef} onCancel={() => setDraft(null)} onClose={() => setDraft(null)} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-3xl bg-white p-0 text-ink shadow-xl backdrop:bg-black/30">
    {draft && <form className="p-5 sm:p-6" onSubmit={event => {
      event.preventDefault();
      if (!calendarReady) { setFormError("Няма актуална връзка с календара."); return; }
      if (!draft.rooms.length) { setFormError("Изберете поне една свободна стая."); return; }
      const conflict = validateReservationConflict(draft, reservations);
      if (!conflict.ok) { setFormError(conflict.message || "Стаята вече е заета."); return; }
      if (!capacityConfirmed || draft.totalAmount <= 0 || draft.depositAmount < 0 || draft.depositAmount > draft.totalAmount) { setFormError("Потвърдете капацитета и проверете сумите."); return; }
      setSaved(current => [...current, { ...draft, status: draft.depositAmount > 0 ? "deposit_paid" : "pending" }]);
      setDraft(null);
    }}>
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black">Нова резервация</h2><p className="mt-1 text-sm font-bold text-amber-800">Демо - без реален запис</p></div><button type="button" onClick={() => setDraft(null)} className="min-h-11 rounded-xl border border-stone-200 px-3 font-bold">Затвори</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold">Име<input autoFocus readOnly value={draft.guestName} className="mt-1 w-full rounded-xl border border-stone-200 bg-cream p-3 text-base" /></label>
        <label className="text-sm font-bold">Телефон<input readOnly value={draft.phone} className="mt-1 w-full rounded-xl border border-stone-200 bg-cream p-3 text-base" /></label>
        <label className="text-sm font-bold sm:col-span-2">Имейл<input readOnly value={selected.email} className="mt-1 w-full rounded-xl border border-stone-200 bg-cream p-3 text-base" /></label>
        <label className="text-sm font-bold">Настаняване<input type="date" readOnly value={draft.checkin} className="mt-1 w-full min-w-0 rounded-xl border border-stone-200 bg-cream p-3 text-base" /></label>
        <label className="text-sm font-bold">Напускане<input type="date" readOnly value={draft.checkout} className="mt-1 w-full min-w-0 rounded-xl border border-stone-200 bg-cream p-3 text-base" /></label>
      </div>
      <p className="mt-4 font-bold">{selected.interest}</p><p className="mt-1 text-sm text-clay">{selected.adults} възрастни · {selected.children} деца · Източник: vilalidia.bg</p>
      {draft.rooms.includes("all") ? <p className="mt-3 rounded-xl bg-emerald-50 p-3 font-bold text-emerald-900">✓ Целият имот е избран</p> : <fieldset className="mt-4"><legend className="text-sm font-bold">Изберете стаи, свободни за целия престой</legend><div className="mt-2 flex flex-wrap gap-2">{availability.freeRooms.map(room => <label key={room} className="flex min-h-11 items-center gap-2 rounded-xl border border-stone-200 p-3"><input type="checkbox" checked={draft.rooms.some(item => item === room)} onChange={event => setDraft({ ...draft, rooms: event.target.checked ? [...draft.rooms, room] : draft.rooms.filter(item => item !== room) })} />Стая {room}</label>)}</div></fieldset>}
      <label className="mt-4 block text-sm font-bold">Пренесени данни и бележки<textarea readOnly rows={4} value={draft.notes} className="mt-1 w-full rounded-xl border border-stone-200 bg-cream p-3 text-base font-normal" /></label>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-sm font-bold">Обща цена (€)<input required type="number" inputMode="decimal" min="0.01" step="0.01" value={draft.totalAmount || ""} onChange={event => setDraft({ ...draft, totalAmount: Number(event.target.value) })} className="mt-1 w-full rounded-xl border border-stone-300 p-3 text-base" /></label>
        <label className="text-sm font-bold">Капаро (€)<input required type="number" inputMode="decimal" min="0" max={draft.totalAmount} step="0.01" value={draft.depositAmount} onChange={event => setDraft({ ...draft, depositAmount: Number(event.target.value) })} className="mt-1 w-full rounded-xl border border-stone-300 p-3 text-base" /></label>
      </div>
      <label className="mt-4 flex items-start gap-3 rounded-xl bg-cream p-3 text-sm"><input required type="checkbox" checked={capacityConfirmed} onChange={event => setCapacityConfirmed(event.target.checked)} className="mt-1" />Проверих, че избраното настаняване побира всички гости.</label>
      {formError && <p role="alert" className="mt-3 text-sm font-bold text-red-800">{formError}</p>}
      <button type="submit" className="mt-4 min-h-12 w-full rounded-xl bg-brand-600 p-3 font-bold text-white">Запази в демо календара</button>
      <p className="mt-2 text-xs text-clay">Само симулация в браузъра. Не създава реална резервация и не изпраща имейл.</p>
    </form>}
  </dialog></main>;
}
