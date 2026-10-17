import { describe, expect, it } from "vitest";
import { convertedEnquiryIds, enquiryReceivedMonth, enquirySummary, isInternalEnquiry } from "@/domain/enquiries/reporting";
import type { Reservation } from "@/domain/reservations/types";

describe("enquiry conversion reporting", () => {
  it("counts explicit, non-cancelled links once and never guesses from guest identity", () => {
    const converted = convertedEnquiryIds([
      { notes: "[enquiry:a]", status: "pending" },
      { notes: "[enquiry:a]", status: "deposit_paid" },
      { notes: "[enquiry:b]", status: "cancelled" },
      { notes: "guest@example.com", status: "pending" }
    ] as Reservation[]);
    expect([...converted]).toEqual(["a"]);
    const rows = [
      { id: "a", email: "guest@example.com", status: "dismissed", createdAt: "2026-10-01" },
      { id: "b", email: "other@example.com", status: "new", createdAt: "2026-10-02" },
      { id: "test", email: " ISTEVASAREV@gmail.com ", status: "new", createdAt: "2026-10-02" }
    ] as const;
    expect(enquirySummary([...rows], converted)).toMatchObject({ total: 2, converted: 1, conversion: 50, new: 1, archived: 0 });
    expect(enquirySummary([], converted).conversion).toBeNull();
  });
  it("uses Bulgarian local month boundaries and excludes only confirmed internal senders", () => {
    expect(enquiryReceivedMonth("2026-09-30T22:30:00Z")).toBe("2026-10");
    expect(isInternalEnquiry({ email: "codex-qa@example.invalid" })).toBe(true);
    expect(isInternalEnquiry({ email: "test.customer@gmail.com" })).toBe(false);
  });
});
