"use client";

import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { eachNight } from "@/domain/reservations/dateRange";
import { PROPERTIES, type Reservation } from "@/domain/reservations/types";
import { buildEstiCsvRows, makeEstiFilename, serializeEstiCsv } from "@/lib/esti/csv";
import { ESTI_CSV_HEADERS, type EstiExportDraft, type EstiTouristDraft } from "@/lib/esti/types";
import { getAllowedRooms, type EstiValidationError, validateEstiExport } from "@/lib/esti/validation";
import { EstiGuestForm } from "./EstiGuestForm";

type EstiExportModalProps = {
  reservation: Reservation;
  onClose: () => void;
};

export function EstiExportModal({ reservation, onClose }: EstiExportModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [previewGeneratedAt, setPreviewGeneratedAt] = useState<Date | null>(null);
  const roomOptions = useMemo(() => getAllowedRooms(reservation), [reservation]);
  const [draft, setDraft] = useState<EstiExportDraft>(() => createInitialDraft(reservation, roomOptions));
  const errors = useMemo(() => validateEstiExport(reservation, draft), [draft, reservation]);
  const accomodationPlaceUinError = errors.find((error) => error.field === "accomodationPlaceUin");
  const previewRows = useMemo(() => buildEstiCsvRows(reservation, draft, previewGeneratedAt || new Date()), [draft, previewGeneratedAt, reservation]);
  const nights = Math.max(1, eachNight(reservation.checkin, reservation.checkout).length);
  const suggestedNightPrice = reservation.totalAmount > 0 ? (reservation.totalAmount / nights).toFixed(2) : "";
  const property = PROPERTIES.find((item) => item.id === reservation.propertyId);

  function updateTourist(index: number, tourist: EstiTouristDraft) {
    setDraft((current) => ({
      ...current,
      tourists: current.tourists.map((item, itemIndex) => itemIndex === index ? tourist : item)
    }));
  }

  function addTourist() {
    setDraft((current) => ({
      ...current,
      tourists: [...current.tourists, createTouristDraft(reservation, roomOptions, current.tourists.length)]
    }));
    setStep(2);
  }

  function removeTourist(index: number) {
    setDraft((current) => ({
      ...current,
      tourists: current.tourists.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  function goToPreview() {
    const nextErrors = validateEstiExport(reservation, draft);
    if (nextErrors.length > 0) return;
    setPreviewGeneratedAt(new Date());
    setStep(3);
  }

  function downloadCsv() {
    const nextErrors = validateEstiExport(reservation, draft);
    if (nextErrors.length > 0) return;
    const rows = buildEstiCsvRows(reservation, draft, previewGeneratedAt || new Date());
    const blob = new Blob([serializeEstiCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = makeEstiFilename(reservation);
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/35 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="esti-export-title">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <header className="flex items-start justify-between gap-3 border-b border-stone-200 p-4 sm:p-5">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-clay">CSV export</p>
            <h3 id="esti-export-title" className="text-2xl font-black text-ink">ЕСТИ</h3>
            <p className="mt-1 text-sm font-semibold text-clay">
              {property?.name || reservation.propertyId} · {reservation.checkin} - {reservation.checkout} · {reservation.guestName || "Без име"}
            </p>
          </div>
          <button type="button" className="tap-target inline-flex h-11 w-11 items-center justify-center rounded-full border border-stone-200 bg-cream text-clay shadow-sm" onClick={onClose} aria-label="Затвори">
            <X size={18} />
          </button>
        </header>

        <div className="max-h-[calc(92vh-84px)] overflow-y-auto p-4 sm:p-5">
          <div className="mb-4 grid gap-2 text-sm font-black text-clay sm:grid-cols-3">
            <StepPill active={step === 1} complete={step > 1} label="1. Данни за престой" />
            <StepPill active={step === 2} complete={step > 2} label="2. Туристи" />
            <StepPill active={step === 3} complete={false} label="3. Preview" />
          </div>

          <p className="mb-4 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
            Тази версия генерира нови регистрации (NEW). Промяна или анулиране на вече подадени записи не се поддържа.
          </p>

          {step === 1 && (
            <section className="grid gap-4">
              <div className="rounded-3xl border border-stone-200 bg-cream p-4">
                <label className="block text-sm font-black text-clay">
                  ЕСТИ / НТР номер на мястото за настаняване
                  <input
                    className={`tap-target mt-1 w-full rounded-2xl border bg-white px-3 py-2 text-base font-bold text-ink outline-none focus:ring-2 ${accomodationPlaceUinError ? "border-rose-300 focus:ring-rose-100" : "border-stone-200 focus:ring-brand-100"}`}
                    value={draft.accomodationPlaceUin}
                    onChange={(event) => setDraft({ ...draft, accomodationPlaceUin: event.target.value })}
                    autoComplete="off"
                  />
                </label>
                <p className="mt-2 text-xs font-semibold text-clay">
                  Използвайте уникалния номер на мястото за настаняване, регистриран в ЕСТИ/Националния туристически регистър.
                </p>
                {accomodationPlaceUinError && (
                  <p className="mt-2 text-sm font-bold text-rose-700">{accomodationPlaceUinError.message}</p>
                )}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-black text-clay">
                    Check-in time
                    <input
                      className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-base font-bold text-ink outline-none focus:ring-2 focus:ring-brand-100"
                      type="time"
                      value={draft.checkInTime}
                      onChange={(event) => setDraft({ ...draft, checkInTime: event.target.value })}
                    />
                  </label>
                  <label className="block text-sm font-black text-clay">
                    Check-out time
                    <input
                      className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-base font-bold text-ink outline-none focus:ring-2 focus:ring-brand-100"
                      type="time"
                      value={draft.checkOutTime}
                      onChange={(event) => setDraft({ ...draft, checkOutTime: event.target.value })}
                    />
                  </label>
                </div>
              </div>
              <FooterActions onClose={onClose} primaryLabel="Към туристи" onPrimary={() => setStep(2)} />
            </section>
          )}

          {step === 2 && (
            <section className="grid gap-3">
              {suggestedNightPrice && (
                <p className="rounded-2xl bg-brand-50 px-3 py-2 text-sm font-bold text-brand-900">
                  Ориентир: обща сума / нощувки = {suggestedNightPrice}. Полето AvgNightPrice остава ръчно editable.
                </p>
              )}
              {reservation.rooms.includes("all") && (
                <p className="rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
                  Резервацията е за цял обект. Избери конкретна физическа стая за всеки турист.
                </p>
              )}
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
              <FooterActions onClose={onClose} secondaryLabel="Назад" onSecondary={() => setStep(1)} primaryLabel="Preview" onPrimary={goToPreview} disabled={errors.length > 0} />
            </section>
          )}

          {step === 3 && (
            <section className="grid gap-4">
              <ValidationErrors errors={errors} />
              <div className="overflow-x-auto rounded-3xl border border-stone-200 bg-cream">
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
              </div>
              <FooterActions onClose={onClose} secondaryLabel="Назад" onSecondary={() => setStep(2)} primaryLabel="Изтегли CSV за ЕСТИ" onPrimary={downloadCsv} disabled={errors.length > 0} />
            </section>
          )}
        </div>
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
      <p className="font-black">Провери преди export:</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {errors.slice(0, 8).map((error) => <li key={`${error.field}-${error.message}`}>{error.message}</li>)}
      </ul>
      {errors.length > 8 && <p className="mt-1">Има още {errors.length - 8} грешки.</p>}
    </div>
  );
}

function createInitialDraft(reservation: Reservation, roomOptions: string[]): EstiExportDraft {
  const roomsAreWholeProperty = reservation.rooms.includes("all");
  return {
    accomodationPlaceUin: "",
    checkInTime: "14:00",
    checkOutTime: "12:00",
    tourists: [createTouristDraft(reservation, roomOptions, 0, !roomsAreWholeProperty)]
  };
}

function createTouristDraft(reservation: Reservation, roomOptions: string[], index: number, preselectRoom = true): EstiTouristDraft {
  const names = splitGuestName(index === 0 ? reservation.guestName : "");
  const nights = Math.max(1, eachNight(reservation.checkin, reservation.checkout).length);
  const suggestedNightPrice = reservation.totalAmount > 0 ? (reservation.totalAmount / nights).toFixed(2) : "";
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
    avgNightPrice: suggestedNightPrice
  };
}

function splitGuestName(value: string): { firstName: string; middleName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || "", middleName: "", lastName: "" };
  if (parts.length === 2) return { firstName: parts[0], middleName: "", lastName: parts[1] };
  return { firstName: parts[0], middleName: parts.slice(1, -1).join(" "), lastName: parts[parts.length - 1] };
}
