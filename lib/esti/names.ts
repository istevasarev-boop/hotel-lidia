import type { EstiTouristDraft } from "./types";

// Reservation labels may append a deposit, currency or note after the guest's name.
export function splitGuestName(value: string) {
  const name = value.split(/\d|[€$£]|\b(?:капаро|депозит|лв|лева|eur|bgn)\b/iu)[0].trim();
  const parts = name.split(/\s+/).filter(part => /^[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*$/u.test(part));
  return { firstName: parts[0] || "", middleName: "", lastName: parts.length > 1 ? parts[parts.length - 1] : "" };
}

// Repair only the exact erroneous auto-fill produced by the old parser.
// Never rewrite manually corrected names or already exported snapshots.
export function repairAutofilledName(tourist: EstiTouristDraft, source: string): EstiTouristDraft {
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3 || !/\d/.test(tourist.lastName) ||
    tourist.firstName !== parts[0] || tourist.lastName !== parts[parts.length - 1] ||
    tourist.middleName !== parts.slice(1, -1).join(" ")) return tourist;
  const names = splitGuestName(source);
  return names.firstName && names.lastName ? { ...tourist, ...names } : tourist;
}
