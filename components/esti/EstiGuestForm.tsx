"use client";

import { X } from "lucide-react";
import { identityMode } from "@/lib/esti/identity";
import type { ReactNode } from "react";
import type { EstiTouristDraft } from "@/lib/esti/types";

type EstiGuestFormProps = {
  tourist: EstiTouristDraft;
  index: number;
  roomOptions: string[];
  canRemove: boolean;
  onChange: (tourist: EstiTouristDraft) => void;
  onRemove: () => void;
};

export function EstiGuestForm({ tourist, index, roomOptions, canRemove, onChange, onRemove }: EstiGuestFormProps) {
  const mode = identityMode(tourist);
  return (
    <section className="rounded-3xl border border-stone-200 bg-cream p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-base font-black text-ink">Турист {index + 1}</h4>
        {canRemove && (
          <button
            type="button"
            className="tap-target inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-clay shadow-sm"
            onClick={onRemove}
            aria-label={`Премахни турист ${index + 1}`}
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <TextField required label="Име" value={tourist.firstName} onChange={(value) => onChange({ ...tourist, firstName: value })} />
        <TextField label="Презиме" value={tourist.middleName} onChange={(value) => onChange({ ...tourist, middleName: value })} />
        <TextField required label="Фамилия" value={tourist.lastName} onChange={(value) => onChange({ ...tourist, lastName: value })} />
      </div>

      <p className="mt-3 text-sm text-clay">* Задължително поле. Попълни дата на раждане и пол или ЕГН.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <SelectField label="Идентификация" value={mode} onChange={value => onChange({ ...tourist, identificationMode: value as "egn" | "birthDate" })}>
          <option value="birthDate">Дата на раждане</option><option value="egn">ЕГН</option>
        </SelectField>
        {mode === "egn" ? <TextField required label="ЕГН" inputMode="numeric" value={tourist.identityNumber} maxLength={10} onChange={value => onChange({ ...tourist, identityNumber: value })} /> : <>
          <TextField required type="date" label="Дата на раждане" value={tourist.birthDate} onChange={value => onChange({ ...tourist, birthDate: value })} />
          <SelectField required label="Пол" value={tourist.genderTypeCode} onChange={value => onChange({ ...tourist, genderTypeCode: value as EstiTouristDraft["genderTypeCode"] })}>
            <option value="">Избери</option><option value="M">Мъж</option><option value="F">Жена</option>
          </SelectField>
        </>}
      </div>
      {mode === "egn" && <p className="mt-2 text-sm text-clay">Датата на раждане и полът се извличат автоматично от валидното ЕГН.</p>}
      <details className="mt-4"><summary className="cursor-pointer font-bold">Допълнителни данни (незадължителни във формата)</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <SelectField label="Вид документ" value={tourist.identityDocumentTypeCode} onChange={(value) => onChange({ ...tourist, identityDocumentTypeCode: value as EstiTouristDraft["identityDocumentTypeCode"] })}>
          <option value="">Избери</option>
          <option value="ICA">Лична карта</option>
          <option value="PAS">Паспорт</option>
          <option value="DRL">Шофьорска книжка</option>
        </SelectField>
        <TextField label="Номер на документа" value={tourist.identityDocumentNumber} maxLength={20} onChange={(value) => onChange({ ...tourist, identityDocumentNumber: value })} />
        <TextField label="Държава на документа (BG, DE…)" value={tourist.identityDocumentCountryCode} maxLength={2} onChange={(value) => onChange({ ...tourist, identityDocumentCountryCode: value.toUpperCase() })} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <SelectField label="Стая" value={tourist.room} onChange={(value) => onChange({ ...tourist, room: value })}>
          <option value="">Избери стая</option>
          {roomOptions.map((room) => (
            <option key={room} value={room}>Стая {room}</option>
          ))}
        </SelectField>
        <TextField label="Етаж" value={tourist.floor} onChange={(value) => onChange({ ...tourist, floor: value })} />
        <SelectField label="Туристически пакет" value={tourist.touristPackage} onChange={(value) => onChange({ ...tourist, touristPackage: value as EstiTouristDraft["touristPackage"] })}>
          <option value="FALSE">Не</option>
          <option value="TRUE">Да</option>
        </SelectField>

      </div>
      </details>
    </section>
  );
}

function TextField({ label, value, onChange, type = "text", inputMode, maxLength, placeholder, required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; inputMode?: "decimal" | "numeric"; maxLength?: number; placeholder?: string; required?: boolean }) {
  return (
    <label className="block text-xs font-black uppercase tracking-wide text-clay">
      {label}{required ? " *" : ""}
      <input
        className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold normal-case tracking-normal text-ink outline-none focus:ring-2 focus:ring-brand-100"
        required={required}
        type={type}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField({ label, value, onChange, children, required = false }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-black uppercase tracking-wide text-clay">
      {label}{required ? " *" : ""}
      <select
        required={required}
        className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold normal-case tracking-normal text-ink outline-none focus:ring-2 focus:ring-brand-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}
