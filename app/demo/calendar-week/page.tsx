"use client";

import { useState } from "react";
import { CalendarView } from "@/components/HotelApp";
import { EMPTY_DATA, type Reservation } from "@/domain/reservations/types";

const reservations: Reservation[] = [
  { id: "demo-villa", propertyId: "villa", rooms: ["all"], checkin: "2026-10-09", checkout: "2026-10-11", depositAmount: 100, status: "deposit_paid" },
  { id: "demo-house", propertyId: "house", rooms: ["4"], checkin: "2026-10-09", checkout: "2026-10-11", depositAmount: 0, status: "pending" },
  { id: "demo-room", propertyId: "villa", rooms: ["7", "11"], checkin: "2026-10-05", checkout: "2026-10-06", depositAmount: 0, status: "pending" },
].map((item) => ({ guestName: "Демо гост", phone: "", notes: "Само демонстрация", totalAmount: 300, createdAt: "2026-10-01", updatedAt: "2026-10-01", ...item })) as Reservation[];

export default function CalendarWeekDemo() {
  const [month, setMonth] = useState("2026-10");
  const [action, setAction] = useState("");
  return <main className="mx-auto max-w-[1600px] p-3 sm:p-6">
    <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
      Демо с примерни данни. Нищо не се записва и не се изпращат съобщения. Избери „Седмица“, за да разгледаш новия изглед.
    </div>
    <CalendarView month={month} setMonth={setMonth} propertyId="villa" data={EMPTY_DATA} reservations={reservations}
      onNew={(property, date, room) => setAction(`Демо: нова резервация за ${property === "villa" ? "Вила" : "Къща"}, стая ${room || "по избор"}, ${date}.`)}
      onEdit={(reservation) => setAction(`Демо: отваряне на резервация за ${reservation.guestName}, стаи ${reservation.rooms.join(", ")}.`)}
    />
    <div role="status" className="mt-4 rounded-xl bg-white p-4 text-sm font-bold">{action || "Натисни дата за подробности или стая в седмичния изглед."}</div>
  </main>;
}
