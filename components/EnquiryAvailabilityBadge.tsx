import type { EnquiryAvailability } from "@/domain/enquiries/availability";

export function EnquiryAvailabilityBadge({ availability, expanded = false }: { availability: EnquiryAvailability; expanded?: boolean }) {
  const tone = availability.status === "available" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : availability.status === "occupied" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900";
  return <div className={expanded ? `rounded-2xl border p-4 ${tone}` : "mt-2"}>
    <span title={availability.detail} className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-bold ${tone}`}>
      <span aria-hidden="true">{availability.status === "available" ? "✓" : availability.status === "occupied" ? "×" : "?"}</span>{availability.label}
    </span>
    {expanded && <><p className="mt-2 text-sm font-semibold leading-relaxed">{availability.detail}</p><p className="mt-2 text-xs leading-relaxed">Проверка по вътрешния календар. Не блокира стаи и не потвърждава резервация.</p></>}
  </div>;
}
