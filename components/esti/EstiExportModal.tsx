"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PROPERTIES, type Reservation } from "@/domain/reservations/types";
import { buildEstiCsvRows } from "@/lib/esti/csv";
import { ESTI_CSV_HEADERS, type EstiExportDraft, type EstiTouristDraft } from "@/lib/esti/types";
import { getAllowedRooms, type EstiValidationError, validateEstiExport } from "@/lib/esti/validation";
import { estiRequest, downloadBatch } from "@/lib/esti/client";
import { isLocked, type EstiRecord } from "@/lib/esti/register";
import { applyEstiDefaults, estiReservation, isEstiProperty } from "@/lib/esti/defaults";
import { EstiGuestForm } from "./EstiGuestForm";

type EstiExportModalProps = {
  reservation: Reservation;
  onClose: () => void;
};

export function EstiExportModal({ reservation, onClose }: EstiExportModalProps) {
  const [record, setRecord] = useState<EstiRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const locked = isLocked(record);
  useEffect(() => {
    let cancelled = false;
    estiRequest().then(result => {
      if (cancelled) return;
      const saved = result.records[reservation.id];
      if (saved) { setRecord(saved); setDraft(isLocked(saved) ? saved.draft : applyEstiDefaults(reservation, saved.draft)); if (isLocked(saved)) setStep(2); }
      setLoaded(true);
    }).catch(error => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, [reservation.id, reservation.propertyId]);
  async function persist() {
    if (busy || !loaded || locked) return;
    setBusy(true); setMessage("");
    try {
      const result = await estiRequest({ reservationId: reservation.id, action: "save", revision: record?.revision || 0, draft });
      setRecord(result.record); setDirty(false); setMessage("Гостите са запазени. Можеш да продължиш по-късно.");
      return result.record;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Неуспешен запис."); }
    finally { setBusy(false); }
  }
  function close() {
    if (busy) return;
    if (!dirty || window.confirm("Има незапазени промени по гостите. Да затворя без запазване?")) onClose();
  }
  const [step, setStep] = useState<1 | 2 | 3>(() => isEstiProperty(reservation.propertyId) ? 2 : 1);
  const [previewGeneratedAt, setPreviewGeneratedAt] = useState<Date | null>(null);
  const [draft, setDraft] = useState<EstiExportDraft>(() => createInitialDraft(reservation, getAllowedRooms(reservation)));
  const effectiveReservation = useMemo(() => estiReservation(reservation, draft), [reservation, draft]);
  const roomOptions = useMemo(() => getAllowedRooms(effectiveReservation), [effectiveReservation]);
  const errors = useMemo(() => validateEstiExport(effectiveReservation, draft), [draft, effectiveReservation]);
  const previewRows = useMemo(() => buildEstiCsvRows(effectiveReservation, draft, previewGeneratedAt || new Date()), [draft, previewGeneratedAt, effectiveReservation]);
  const property = PROPERTIES.find((item) => item.id === effectiveReservation.propertyId);

  function updateTourist(index: number, tourist: EstiTouristDraft) {
    setDirty(true);
    setDraft((current) => ({
      ...current,
      tourists: current.tourists.map((item, itemIndex) => itemIndex === index ? tourist : item)
    }));
  }

  function addTourist() {
    setDirty(true);
    setDraft((current) => ({
      ...current,
      tourists: [...current.tourists, createTouristDraft(reservation, roomOptions, current.tourists.length)]
    }));
    setStep(2);
  }

  function removeTourist(index: number) {
    setDirty(true);
    setDraft((current) => ({
      ...current,
      tourists: current.tourists.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  function goToPreview() {
    const nextErrors = validateEstiExport(effectiveReservation, draft);
    if (nextErrors.length > 0) return;
    setPreviewGeneratedAt(new Date());
    setStep(3);
  }

  async function downloadCsv() {
    if (busy || !loaded || locked || errors.length) return;
    setBusy(true); setMessage("");
    try {
      const saved = await estiRequest({ reservationId: reservation.id, action: "save", revision: record?.revision || 0, draft });
      setRecord(saved.record); setDirty(false);
      const result = await estiRequest({ reservationId: reservation.id, action: "export", revision: saved.record.revision });
      setRecord(result.record);
      downloadBatch(result.record.batches[result.record.batches.length - 1], reservation.propertyId);
      setMessage("Файлът е подготвен. Качи го в ЕСТИ и отбележи резултата в меню ЕСТИ → История.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Неуспешен експорт."); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/35 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="esti-export-title">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <header className="flex items-start justify-between gap-3 border-b border-stone-200 p-4 sm:p-5">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-clay">Регистър на гостите</p>
            <h3 id="esti-export-title" className="text-2xl font-black text-ink">ЕСТИ</h3>
            <p className="mt-1 text-sm font-semibold text-clay">
              {property?.name || reservation.propertyId} · {reservation.checkin} - {reservation.checkout} · {reservation.guestName || "Без име"}
            </p>
          </div>
          <button type="button" className="tap-target inline-flex h-11 w-11 items-center justify-center rounded-full border border-stone-200 bg-cream text-clay shadow-sm" onClick={close} aria-label="Затвори">
            <X size={18} />
          </button>
        </header>

        <div className="max-h-[calc(92vh-84px)] overflow-y-auto p-4 sm:p-5">
          {message && <p role="status" className="mb-3 rounded-xl bg-amber-50 p-3 text-ink">{message}</p>}
          {!loaded && <p>Зареждане на запазените гости… При грешка затвори и отвори отново.</p>}
          {locked && <p className="mb-3 rounded-xl bg-brand-50 p-3">Има изтеглен или приет файл. Данните са само за преглед. Отбележи резултата в ЕСТИ → История.</p>}
          <fieldset disabled={!loaded || busy || locked} onChange={() => setDirty(true)}>
          <button type="button" className="mb-4 rounded-xl bg-brand-600 px-4 py-3 font-bold text-white disabled:opacity-50" onClick={persist}> {busy ? "Запазване…" : "Запази гостите за по-късно"} </button>
          <div className="mb-4 grid gap-2 text-sm font-black text-clay sm:grid-cols-3">
            <StepPill active={step === 1} complete={step > 1} label="1. Данни за престой" />
            <StepPill active={step === 2} complete={step > 2} label="2. Туристи" />
            <StepPill active={step === 3} complete={false} label="3. Проверка и файл" />
          </div>

          <p className="mb-4 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
            Тази версия генерира нови регистрации (NEW). Промяна или анулиране на вече подадени записи не се поддържа.
          </p>

          {step === 1 && (
            <section className="grid gap-4">
              <div className="rounded-3xl border border-stone-200 bg-cream p-4">
                {!isEstiProperty(reservation.propertyId) ? (
                  <label className="block text-sm font-black text-clay">Обект
                    <select className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2" value={draft.propertyId || ""}
                      onChange={event => {
                        const propertyId = event.target.value;
                        if (!isEstiProperty(propertyId)) return;
                        setDraft(current => applyEstiDefaults(reservation, { ...current, propertyId, tourists: current.tourists.map(t => ({ ...t, room: "" })) }));
                      }}>
                      <option value="" disabled>Избери обект</option>
                      <option value="house">Къщата</option><option value="villa">Вилата</option>
                    </select>
                  </label>
                ) : <p className="font-bold">{property?.name}</p>}
                <p className="mt-2 text-sm text-clay">{draft.accomodationPlaceUin ? `ЕСТИ / НТР: ${draft.accomodationPlaceUin} · попълнен автоматично` : "Избери обекта, за който регистрираш гостите."}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-black text-clay">
                    Час на настаняване
                    <input
                      className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-base font-bold text-ink outline-none focus:ring-2 focus:ring-brand-100"
                      type="time"
                      value={draft.checkInTime}
                      onChange={(event) => setDraft({ ...draft, checkInTime: event.target.value })}
                    />
                  </label>
                  <label className="block text-sm font-black text-clay">
                    Час на напускане
                    <input
                      className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-base font-bold text-ink outline-none focus:ring-2 focus:ring-brand-100"
                      type="time"
                      value={draft.checkOutTime}
                      onChange={(event) => setDraft({ ...draft, checkOutTime: event.target.value })}
                    />
                  </label>
                </div>
              </div>
              <FooterActions onClose={close} primaryLabel="Към туристи" onPrimary={() => setStep(2)} disabled={!draft.accomodationPlaceUin} />
            </section>
          )}

          {step === 2 && (
            <section className="grid gap-3">
              {draft.tourists.map((tourist, index) => (
                <EstiGuestForm
                  key={tourist.id}
                  tourist={tourist}
                  index={index}
                  roomOptions={roomOptions}
                  canRemove={draft.tourists.length > 1}
                  onChange={(nextTourist) => updateTourist(index, nextTourist)}
                  onRemove={() => removeTourist(index)}
                />
              ))}
              <button type="button" className="tap-target inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-black text-clay shadow-sm sm:w-auto" onClick={addTourist}>
                <Plus size={17} /> Добави турист
              </button>
              <ValidationErrors errors={errors} />
              <FooterActions onClose={close} secondaryLabel="Назад" onSecondary={() => setStep(1)} primaryLabel="Провери за ЕСТИ" onPrimary={goToPreview} disabled={errors.length > 0} />
            </section>
          )}

          {step === 3 && (
            <section className="grid gap-4">
              <ValidationErrors errors={errors} />
              <div className="rounded-2xl bg-brand-50 p-4"><strong>{draft.tourists.length} гости · {reservation.checkin} → {reservation.checkout}</strong><p>Обект: {draft.accomodationPlaceUin}. След изтеглянето качи CSV файла в ЕСТИ за този обект.</p>{draft.tourists.map(t => <p key={t.id}>{t.firstName} {t.lastName} · Стая {t.room}</p>)}</div>
              <details><summary className="cursor-pointer p-3 font-bold">Технически преглед на файла</summary><div className="overflow-x-auto rounded-3xl border border-stone-200 bg-cream">
                <table className="min-w-[1200px] text-left text-xs font-bold text-stone-700">
                  <thead className="bg-white text-[10px] uppercase text-clay">
                    <tr>
                      {ESTI_CSV_HEADERS.map((header) => <th key={header} className="border-b border-stone-200 px-2 py-2">{header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, index) => (
                      <tr key={row.AccomodationRegisterUin || index} className="odd:bg-white/70">
                        {ESTI_CSV_HEADERS.map((header) => <td key={header} className="max-w-40 truncate border-b border-stone-100 px-2 py-2">{row[header]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div></details>
              <FooterActions onClose={close} secondaryLabel="Назад" onSecondary={() => setStep(2)} primaryLabel="Изтегли CSV за ЕСТИ" onPrimary={downloadCsv} disabled={errors.length > 0} />
            </section>
          )}
        </fieldset></div>
      </div>
    </div>
  );
}

function StepPill({ label, active, complete }: { label: string; active: boolean; complete: boolean }) {
  return (
    <span className={`rounded-full px-3 py-2 text-center ${active ? "bg-brand-600 text-white" : complete ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-100" : "bg-cream text-clay ring-1 ring-stone-200"}`}>
      {label}
    </span>
  );
}

function FooterActions({ onClose, primaryLabel, onPrimary, secondaryLabel, onSecondary, disabled = false }: { onClose: () => void; primaryLabel: string; onPrimary: () => void; secondaryLabel?: string; onSecondary?: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-2 font-black text-clay shadow-sm" onClick={secondaryLabel && onSecondary ? onSecondary : onClose}>
        {secondaryLabel || "Затвори"}
      </button>
      <button type="button" className="tap-target rounded-2xl bg-brand-600 px-5 py-3 font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50" onClick={onPrimary} disabled={disabled}>
        {primaryLabel}
      </button>
    </div>
  );
}

function ValidationErrors({ errors }: { errors: EstiValidationError[] }) {
  if (!errors.length) return null;
  return (
    <div className="rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">
      <p className="font-black">Провери преди изтегляне:</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {errors.slice(0, 8).map((error) => <li key={`${error.field}-${error.message}`}>{error.message}</li>)}
      </ul>
      {errors.length > 8 && <p className="mt-1">Има още {errors.length - 8} грешки.</p>}
    </div>
  );
}

function createInitialDraft(reservation: Reservation, roomOptions: string[]): EstiExportDraft {
  const roomsAreWholeProperty = reservation.rooms.includes("all");
  return applyEstiDefaults(reservation, {
    accomodationPlaceUin: "",
    checkInTime: "14:00",
    checkOutTime: "12:00",
    tourists: [createTouristDraft(reservation, roomOptions, 0, !roomsAreWholeProperty)]
  });
}

function createTouristDraft(reservation: Reservation, roomOptions: string[], index: number, preselectRoom = true): EstiTouristDraft {
  const names = splitGuestName(index === 0 ? reservation.guestName : "");

  return {
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
    firstName: names.firstName,
    middleName: names.middleName,
    lastName: names.lastName,
    birthDate: "",
    genderTypeCode: "",
    identityNumber: "",
    identityDocumentTypeCode: "ICA",
    identityDocumentNumber: "",
    identityDocumentCountryCode: "BG",
    floor: "",
    room: preselectRoom ? roomOptions[0] || "" : "",
    touristPackage: "FALSE",
    avgNightPrice: ""
  };
}

function splitGuestName(value: string): { firstName: string; middleName: string; lastName: string } {
  // Ignore trailing reservation annotations such as amounts or phone numbers.
  const parts: string[] = [];
  for (const token of value.trim().split(/\s+/).filter(Boolean)) {
    if (!/^[\p{L}\p{M}]+(?:[-’'][\p{L}\p{M}]+)*$/u.test(token)) break;
    parts.push(token);
  }
  if (parts.length <= 1) return { firstName: parts[0] || "", middleName: "", lastName: "" };
  if (parts.length === 2) return { firstName: parts[0], middleName: "", lastName: parts[1] };
  return { firstName: parts[0], middleName: parts.slice(1, -1).join(" "), lastName: parts[parts.length - 1] };
}
