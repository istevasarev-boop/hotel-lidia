"use client";

import { useState } from "react";
import { EnquiryAvailabilityBadge } from "@/components/EnquiryAvailabilityBadge";
import { getEnquiryAvailability, type AvailabilityRequest } from "@/domain/enquiries/availability";
import type { Reservation } from "@/domain/reservations/types";

const enquiries: Array<AvailabilityRequest & { id: string; name: string; interest: string }> = [
  { id: "whole-free", name: "Примерен гост 1", interest: "Вила Лидия · Целият имот", propertyId: "villa", checkin: "2026-11-13", checkout: "2026-11-15", requestedRooms: ["whole"], adults: 8, children: 0 },
  { id: "whole-busy", name: "Примерен гост 2", interest: "Къща Лидия · Целият имот", propertyId: "house", checkin: "2026-11-13", checkout: "2026-11-15", requestedRooms: ["whole"], adults: 6, children: 0 },
  { id: "room", name: "Примерен гост 3", interest: "Вила Лидия · Стая с джакузи", propertyId: "villa", checkin: "2026-11-13", checkout: "2026-11-15", requestedRooms: ["jacuzzi"], adults: 2, children: 1 },
  { id: "busy-room", name: "Примерен гост 4", interest: "Къща Лидия · Стая без джакузи", propertyId: "house", checkin: "2026-11-13", checkout: "2026-11-15", requestedRooms: ["no_jacuzzi"], adults: 2, children: 0 }
];
const occupiedHouse: Reservation = { id: "demo-house", propertyId: "house", rooms: ["all"], checkin: "2026-11-14", checkout: "2026-11-16", guestName: "Демо", phone: "", notes: "", totalAmount: 0, depositAmount: 0, status: "pending", createdAt: "", updatedAt: "" };

export default function EnquiryAvailabilityDemo() {
  const [selectedId, setSelectedId] = useState(enquiries[0].id);
  const [villaOccupied, setVillaOccupied] = useState(false);
  const [calendarReady, setCalendarReady] = useState(true);
  const reservations: Reservation[] = [occupiedHouse, ...(villaOccupied ? [{ ...occupiedHouse, id: "demo-villa", propertyId: "villa" as const, rooms: ["5"], checkin: "2026-11-13" }] : [])];
  const selected = enquiries.find(item => item.id === selectedId)!;
  const availability = getEnquiryAvailability(selected, reservations, calendarReady);
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
        <div aria-live="polite"><EnquiryAvailabilityBadge availability={availability} expanded /></div>
        <div className="mt-5 rounded-2xl bg-cream p-4"><h3 className="font-bold">Какво показва демо календарът</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-clay"><li>Къщата е резервирана от 14 до 16 ноември. Това пресича заявения престой.</li><li>{villaOccupied ? "Стая 5 във вилата вече е заета. Цялата вила не може да се предложи." : "Всички стаи във вилата са свободни през заявения период."}</li><li>За отделна стая показваме свободните номера. Леглата и разпределението на гостите изискват проверка.</li></ul></div>
      </article>
    </div>
  </div></main>;
}
