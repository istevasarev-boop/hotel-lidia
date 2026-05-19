export function eur(value: number): string {
  const rounded = Math.round(Number(value || 0));
  const formatted = new Intl.NumberFormat("bg-BG", {
    maximumFractionDigits: 0
  }).format(rounded).replace(/\u00a0/g, " ");
  return `${formatted} €`;
}
