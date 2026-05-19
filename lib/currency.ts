export function eur(value: number): string {
  return new Intl.NumberFormat("bg-BG", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2
  }).format(Number(value || 0));
}
