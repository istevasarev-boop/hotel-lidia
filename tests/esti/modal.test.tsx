// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { EstiExportModal } from "@/components/esti/EstiExportModal";
import type { Reservation } from "@/domain/reservations/types";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/esti/client", () => ({ estiRequest: request, downloadBatch: vi.fn() }));
const reservation: Reservation = { id: "res_test", propertyId: "villa", rooms: ["10"], checkin: "2026-10-23", checkout: "2026-10-25", guestName: "Test Guest", phone: "", notes: "", totalAmount: 200, depositAmount: 0, status: "pending", createdAt: "", updatedAt: "" };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("guest editor workflow", () => {
  it("saves incomplete guests and restores them on reopening without editing reservation", async () => {
    let saved: unknown;
    request.mockImplementation(async body => {
      if (!body) return { records: saved ? { res_test: saved } : {} };
      saved = { revision: 1, draft: body.draft, batches: [], updatedAt: "2026-10-23" };
      return { record: saved };
    });
    const before = JSON.stringify(reservation);
    const first = render(<EstiExportModal reservation={reservation} onClose={() => undefined} />);
    await waitFor(() => expect((screen.getByText("Запази гостите за по-късно") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("ЕСТИ / НТР номер на мястото за настаняване"), { target: { value: "BG-TEST" } });
    fireEvent.click(screen.getByText("Запази гостите за по-късно"));
    await screen.findByText("Гостите са запазени. Можеш да продължиш по-късно.");
    first.unmount();
    render(<EstiExportModal reservation={reservation} onClose={() => undefined} />);
    await waitFor(() => expect((screen.getByLabelText("ЕСТИ / НТР номер на мястото за настаняване") as HTMLInputElement).value).toBe("BG-TEST"));
    expect(JSON.stringify(reservation)).toBe(before);
  });
  it("shows storage failure and keeps writes disabled", async () => {
    request.mockRejectedValue(new Error("Няма достъп"));
    render(<EstiExportModal reservation={reservation} onClose={() => undefined} />);
    await screen.findByText("Няма достъп");
    expect(screen.getByText("Запази гостите за по-късно").closest("fieldset")?.disabled).toBe(true);
  });
});
