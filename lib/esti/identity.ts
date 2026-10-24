import type { EstiTouristDraft } from "./types";

export function parseEgn(value: string): { birthDate: string; gender: "M" | "F" } | null {
  if (!/^\d{10}$/.test(value)) return null;
  const digits = [...value].map(Number);
  const sum = [2, 4, 8, 5, 10, 9, 7, 3, 6].reduce((n, weight, i) => n + weight * digits[i], 0) % 11;
  if ((sum === 10 ? 0 : sum) !== digits[9]) return null;
  let year = Number(value.slice(0, 2)) + 1900;
  let month = Number(value.slice(2, 4));
  if (month > 40) { year += 100; month -= 40; }
  else if (month > 20) { year -= 100; month -= 20; }
  const day = Number(value.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getTime() > Date.now()) return null;
  return { birthDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, gender: digits[8] % 2 === 0 ? "M" : "F" };
}
export function identityMode(tourist: EstiTouristDraft) {
  return tourist.identificationMode || (tourist.identityNumber ? "egn" : "birthDate");
}
