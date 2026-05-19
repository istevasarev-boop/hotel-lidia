const BG_MONTHS = [
  "\u042f\u043d\u0443\u0430\u0440\u0438",
  "\u0424\u0435\u0432\u0440\u0443\u0430\u0440\u0438",
  "\u041c\u0430\u0440\u0442",
  "\u0410\u043f\u0440\u0438\u043b",
  "\u041c\u0430\u0439",
  "\u042e\u043d\u0438",
  "\u042e\u043b\u0438",
  "\u0410\u0432\u0433\u0443\u0441\u0442",
  "\u0421\u0435\u043f\u0442\u0435\u043c\u0432\u0440\u0438",
  "\u041e\u043a\u0442\u043e\u043c\u0432\u0440\u0438",
  "\u041d\u043e\u0435\u043c\u0432\u0440\u0438",
  "\u0414\u0435\u043a\u0435\u043c\u0432\u0440\u0438",
];

export function formatBulgarianDateRange(checkin: string, checkout: string): string {
  const start = parseISODateParts(checkin);
  const end = parseISODateParts(checkout);
  if (!start || !end) return `${checkin || ""}${checkin && checkout ? " - " : ""}${checkout || ""}`.trim();

  return `\u041e\u0442 ${formatBulgarianDayOrdinal(start.day)} ${BG_MONTHS[start.month - 1]} \u0434\u043e ${formatBulgarianDayOrdinal(end.day)} ${BG_MONTHS[end.month - 1]}`;
}

export function formatBulgarianDayOrdinal(day: number): string {
  if (day === 1 || day === 21 || day === 31) return `${day}\u0432\u0438`;
  if (day === 2 || day === 22) return `${day}\u0440\u0438`;
  if (day === 7 || day === 8) return `${day}\u043c\u0438`;
  return `${day}\u0442\u0438`;
}

function parseISODateParts(value: string): { day: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;

  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day, month };
}
