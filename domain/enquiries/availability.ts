import { PROPERTIES, type Reservation } from "../reservations/types";
import { rangesOverlap } from "../reservations/dateRange";

export type AvailabilityRequest = { propertyId: string; checkin: string; checkout: string; requestedRooms: string[]; adults: number; children: number };
export type EnquiryAvailability = { status: "available" | "occupied" | "check"; label: string; detail: string; freeRooms: string[] };
const JACUZZI_ROOMS = new Set(["1", "3", "5", "6", "9", "10"]);
function result(status: EnquiryAvailability["status"], detail: string, freeRooms: string[] = []): EnquiryAvailability {
  return { status, label: status === "available" ? "Свободно по календар" : status === "occupied" ? "Заето" : "Нужна е проверка", detail, freeRooms };
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function getEnquiryAvailability(request: AvailabilityRequest, reservations: Reservation[], calendarReady = true): EnquiryAvailability {
  if (!calendarReady) return result("check", "Няма актуална връзка с календара. Обновете преди потвърждение.");
  const property = PROPERTIES.find(item => item.id === request.propertyId);
  if (!property || !validDate(request.checkin) || !validDate(request.checkout) || request.checkout <= request.checkin) return result("check", "Проверете обекта и датите на престоя.");
  const active = reservations.filter(item => item.propertyId === property.id && item.status !== "cancelled");
  if (active.some(item => !validDate(item.checkin) || !validDate(item.checkout) || item.checkout <= item.checkin)) return result("check", "Има резервация с невалидни дати в календара.");
  const overlapping = active.filter(item => rangesOverlap(request.checkin, request.checkout, item.checkin, item.checkout));
  if (overlapping.some(item => !item.rooms.length || item.rooms.some(room => room !== "all" && !property.rooms.includes(room)))) return result("check", "Има резервация без ясно разпределение по стаи за периода.");
  const whole = request.requestedRooms.includes("whole") || request.requestedRooms.includes("all");
  if (whole) return overlapping.length
    ? result("occupied", "Целият имот не е свободен: има резервирана стая или цял имот за част от престоя.")
    : result("available", "Всички стаи са свободни за целия престой. Капацитетът за посочените гости се потвърждава отделно.", property.rooms);
  if (!request.requestedRooms.length || request.requestedRooms.length !== 1) return result("check", "Уточнете вида и броя стаи. Избраните категории не определят разпределението на гостите.");
  const requested = request.requestedRooms[0];
  const candidates = property.rooms.filter(room => requested === "jacuzzi" ? JACUZZI_ROOMS.has(room) : requested === "no_jacuzzi" ? !JACUZZI_ROOMS.has(room) : requested === room);
  if (!candidates.length) return result("check", "Типът настаняване не е разпознат. Проверете стаите в календара.");
  const freeRooms = candidates.filter(room => !overlapping.some(item => item.rooms.includes("all") || item.rooms.includes(room)));
  if (!freeRooms.length) return result("occupied", "Няма стая от избрания тип, свободна за целия престой без преместване.");
  // The calendar has no verified bed capacities or requested room count. Never infer them from guest totals.
  return result("check", `Свободни по календар стаи: ${freeRooms.join(", ")}. Потвърдете броя стаи и капацитета за ${request.adults + request.children} гости.`, freeRooms);
}
