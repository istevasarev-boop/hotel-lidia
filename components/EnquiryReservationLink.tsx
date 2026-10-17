"use client";

import { useState } from "react";
import type { Reservation } from "@/domain/reservations/types";
import { reservationMatchReasons, type EnquiryContact } from "@/domain/enquiries/reservationLink";
import { PROPERTIES } from "@/domain/reservations/types";

export function EnquiryReservationLink({ enquiry, reservations, ready, onLink }: {
  enquiry: EnquiryContact;
  reservations: Reservation[];
  ready: boolean;
  onLink: (enquiryId: string, reservationId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const candidates = reservations.filter(item => item.status !== "cancelled" && !/\[enquiry:[^\]]+\]/.test(item.notes))
    .map(item => ({ reservation: item, reasons: reservationMatchReasons(enquiry, item) }))
    .filter(({ reservation: item, reasons }) => (showAll || query.trim() || reasons.length) && `${item.guestName} ${item.phone} ${item.checkin} ${item.checkout}`.toLocaleLowerCase("bg").includes(query.trim().toLocaleLowerCase("bg")))
    .sort((a, b) => b.reasons.length - a.reasons.length || b.reservation.checkin.localeCompare(a.reservation.checkin));
  const selected = candidates.find(item => item.reservation.id === selectedId)?.reservation;
  function close() { setOpen(false); setSelectedId(""); setError(""); }
  async function submit() {
    if (!selected || !ready || saving) return;
    setSaving(true);
    setError("");
    try { await onLink(enquiry.id, selected.id); close(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Връзката не беше запазена. Опитайте отново."); }
    finally { setSaving(false); }
  }
  return <div className="mt-4 rounded-2xl border border-stone-200 bg-cream p-3">
    <button type="button" disabled={saving} aria-expanded={open} className="tap-target text-left text-sm font-black text-brand-800" onClick={() => open ? close() : setOpen(true)}>Свържи със съществуваща резервация {open ? "−" : "+"}</button>
    {open && <div className="mt-3 grid gap-3">
      <p className="text-sm text-clay">Предложения по телефон или имейл. Може да изберете и резервация с други дати или друг обект.</p>
      {!ready && <p role="status" className="text-sm font-bold text-clay">Изчакваме актуална връзка с календара.</p>}
      <input disabled={saving} aria-label="Търси съществуваща резервация" className="tap-target w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3 text-sm" placeholder="Търси по име, телефон или дата…" value={query} onChange={event => { setQuery(event.target.value); setSelectedId(""); }} />
      <button type="button" disabled={saving} className="tap-target text-left text-sm font-bold text-brand-800" onClick={() => { setShowAll(value => !value); setSelectedId(""); }}>{showAll ? "Само предложенията" : "Покажи всички несвързани резервации"}</button>
      <div className="grid max-h-72 gap-2 overflow-y-auto">
        {candidates.map(({ reservation: item, reasons }) => <label key={item.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border bg-white p-3 text-sm ${selectedId === item.id ? "border-brand-600 ring-1 ring-brand-600" : "border-stone-200"}`}>
          <input type="radio" name={`reservation-link-${enquiry.id}`} disabled={saving} className="mt-1" value={item.id} checked={selectedId === item.id} onChange={() => setSelectedId(item.id)} />
          <span className="min-w-0"><strong className="block break-words text-ink">{item.guestName || "Без име"}</strong><span className="block text-clay">{item.checkin} → {item.checkout}</span><span className="block text-clay">{PROPERTIES.find(property => property.id === item.propertyId)?.name} · {item.rooms.includes("all") ? "Целият обект" : `Стаи ${item.rooms.join(", ")}`}</span><span className="block text-clay">{item.phone || "Без телефон"}</span>{reasons.length > 0 && <span className="mt-1 block font-bold text-brand-800">{reasons.join(" · ")}</span>}</span>
        </label>)}
        {!candidates.length && <p className="text-sm text-clay">Няма намерени резервации. Потърсете по име или покажете всички.</p>}
      </div>
      {selected && <p className="text-sm font-bold text-ink">Свързвате {enquiry.name} с резервацията на {selected.guestName}, {selected.checkin} → {selected.checkout}.</p>}
      {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={!selected || !ready || saving} className="tap-target rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white disabled:bg-stone-200 disabled:text-stone-600" onClick={() => void submit()}>{saving ? "Запазване…" : "Потвърди връзката"}</button><button type="button" disabled={saving} className="tap-target rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-clay" onClick={close}>Отказ</button></div>
    </div>}
  </div>;
}
