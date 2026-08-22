"use client";

import { X } from "lucide-react";
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
        <TextField label="FirstName" value={tourist.firstName} onChange={(value) => onChange({ ...tourist, firstName: value })} />
        <TextField label="MiddleName" value={tourist.middleName} onChange={(value) => onChange({ ...tourist, middleName: value })} />
        <TextField label="LastName" value={tourist.lastName} onChange={(value) => onChange({ ...tourist, lastName: value })} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <TextField label="BirthDate" placeholder="YYYY-MM-DD" value={tourist.birthDate} onChange={(value) => onChange({ ...tourist, birthDate: value })} />
        <SelectField label="GenderTypeCode" value={tourist.genderTypeCode} onChange={(value) => onChange({ ...tourist, genderTypeCode: value as EstiTouristDraft["genderTypeCode"] })}>
          <option value="">Избери</option>
          <option value="M">M</option>
          <option value="F">F</option>
        </SelectField>
        <TextField label="IdentityNumber" value={tourist.identityNumber} maxLength={10} onChange={(value) => onChange({ ...tourist, identityNumber: value })} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <SelectField label="IdentityDocumentTypeCode" value={tourist.identityDocumentTypeCode} onChange={(value) => onChange({ ...tourist, identityDocumentTypeCode: value as EstiTouristDraft["identityDocumentTypeCode"] })}>
          <option value="">Избери</option>
          <option value="ICA">ICA</option>
          <option value="PAS">PAS</option>
          <option value="DRL">DRL</option>
        </SelectField>
        <TextField label="IdentityDocumentNumber" value={tourist.identityDocumentNumber} maxLength={20} onChange={(value) => onChange({ ...tourist, identityDocumentNumber: value })} />
        <TextField label="IdentityDocumentCountryCode" value={tourist.identityDocumentCountryCode} maxLength={2} onChange={(value) => onChange({ ...tourist, identityDocumentCountryCode: value.toUpperCase() })} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <SelectField label="Room" value={tourist.room} onChange={(value) => onChange({ ...tourist, room: value })}>
          <option value="">Избери стая</option>
          {roomOptions.map((room) => (
            <option key={room} value={room}>Стая {room}</option>
          ))}
        </SelectField>
        <TextField label="Floor" value={tourist.floor} onChange={(value) => onChange({ ...tourist, floor: value })} />
        <SelectField label="TouristPackage" value={tourist.touristPackage} onChange={(value) => onChange({ ...tourist, touristPackage: value as EstiTouristDraft["touristPackage"] })}>
          <option value="FALSE">FALSE</option>
          <option value="TRUE">TRUE</option>
        </SelectField>
        <TextField label="AvgNightPrice" inputMode="decimal" value={tourist.avgNightPrice} onChange={(value) => onChange({ ...tourist, avgNightPrice: value })} />
      </div>
    </section>
  );
}

function TextField({ label, value, onChange, type = "text", inputMode, maxLength, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; inputMode?: "decimal"; maxLength?: number; placeholder?: string }) {
  return (
    <label className="block text-xs font-black uppercase tracking-wide text-clay">
      {label}
      <input
        className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold normal-case tracking-normal text-ink outline-none focus:ring-2 focus:ring-brand-100"
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

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="block text-xs font-black uppercase tracking-wide text-clay">
      {label}
      <select
        className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold normal-case tracking-normal text-ink outline-none focus:ring-2 focus:ring-brand-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}
