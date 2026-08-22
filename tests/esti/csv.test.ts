import { describe, expect, it } from "vitest";
import type { Reservation } from "@/domain/reservations/types";
import { buildEstiCsvRows, escapeCsvValue, formatEstiDate, formatEstiDateTime, serializeEstiCsv } from "@/lib/esti/csv";
import { ESTI_CSV_HEADERS, type EstiExportDraft } from "@/lib/esti/types";
import { canGenerateEstiCsv, isValidAccomodationPlaceUin, validateEstiExport } from "@/lib/esti/validation";

const baseReservation: Reservation = {
  id: "res_test_1",
  propertyId: "villa",
  rooms: ["10"],
  checkin: "2026-05-18",
  checkout: "2026-05-20",
  guestName: "Иван Петров",
  phone: "0888123456",
  notes: "",
  depositAmount: 100,
  totalAmount: 240,
  status: "deposit_paid",
  createdAt: "2026-05-01T10:00:00.000Z",
  updatedAt: "2026-05-01T10:00:00.000Z"
};

function validDraft(partial?: Partial<EstiExportDraft>): EstiExportDraft {
  return {
    accomodationPlaceUin: "BG-ESTI-1",
    checkInTime: "14:00",
    checkOutTime: "12:00",
    tourists: [
      {
        id: "t1",
        firstName: "Иван",
        middleName: "Георгиев",
        lastName: "Петров",
        birthDate: "1980-04-05",
        genderTypeCode: "M",
        identityNumber: "8004050000",
        identityDocumentTypeCode: "ICA",
        identityDocumentNumber: "123456789",
        identityDocumentCountryCode: "BG",
        floor: "2",
        room: "10",
        touristPackage: "FALSE",
        avgNightPrice: "120.00"
      }
    ],
    ...partial
  };
}

describe("ESTI CSV export", () => {
  it("validates AccomodationPlaceUin basic required identifier rules", () => {
    expect(isValidAccomodationPlaceUin("")).toBe(false);
    expect(isValidAccomodationPlaceUin("   ")).toBe(false);
    expect(isValidAccomodationPlaceUin("фг")).toBe(false);
    expect(isValidAccomodationPlaceUin("BG-ESTI-TEST-1")).toBe(true);
  });

  it("blocks CSV generation when AccomodationPlaceUin is invalid", () => {
    expect(canGenerateEstiCsv(baseReservation, validDraft({ accomodationPlaceUin: "фг" }))).toBe(false);
  });

  it("allows CSV generation when AccomodationPlaceUin is valid", () => {
    expect(canGenerateEstiCsv(baseReservation, validDraft({ accomodationPlaceUin: "BG-ESTI-TEST-1" }))).toBe(true);
  });

  it("keeps the entered AccomodationPlaceUin exactly in generated CSV rows", () => {
    const rows = buildEstiCsvRows(baseReservation, validDraft({ accomodationPlaceUin: "BG-ESTI-TEST-1" }));
    const csv = serializeEstiCsv(rows, false);

    expect(rows[0].AccomodationPlaceUin).toBe("BG-ESTI-TEST-1");
    expect(csv.split("\r\n")[1].split(";")[0]).toBe("BG-ESTI-TEST-1");
  });

  it("exports single room reservation with one tourist", () => {
    const rows = buildEstiCsvRows(baseReservation, validDraft(), new Date(2026, 4, 18, 9, 7));
    const csv = serializeEstiCsv(rows, false);

    expect(rows).toHaveLength(1);
    expect(csv.split("\r\n")[0]).toBe(ESTI_CSV_HEADERS.join(";"));
    expect(rows[0].Room).toBe("10");
    expect(rows[0].RegistrationDate).toBe("18.05.2026 09:07");
    expect(rows[0].RegistrationTypeCode).toBe("NEW");
  });

  it("supports multi-room reservations with independently assigned tourists", () => {
    const reservation = { ...baseReservation, rooms: ["5", "7"] };
    const rows = buildEstiCsvRows(reservation, validDraft({
      tourists: [
        { ...validDraft().tourists[0], id: "t1", room: "5" },
        { ...validDraft().tourists[0], id: "t2", firstName: "Мария", lastName: "Петрова", room: "7" }
      ]
    }));

    expect(rows.map((row) => row.Room)).toEqual(["5", "7"]);
  });

  it("requires physical room for whole-property reservations and never exports all", () => {
    const reservation = { ...baseReservation, rooms: ["all"] as ["all"] };
    const invalidDraft = validDraft({ tourists: [{ ...validDraft().tourists[0], room: "all" }] });

    expect(validateEstiExport(reservation, invalidDraft).some((error) => error.field.includes("room"))).toBe(true);
  });

  it("keeps Bulgarian Cyrillic in UTF-8 CSV content", () => {
    const rows = buildEstiCsvRows(baseReservation, validDraft({
      tourists: [{ ...validDraft().tourists[0], firstName: "Мария", middleName: "Иванова", lastName: "Димитрова" }]
    }));
    const csv = serializeEstiCsv(rows);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Мария");
    expect(csv).toContain("Димитрова");
  });

  it("escapes semicolon, quote and newline characters", () => {
    expect(escapeCsvValue('A;B "C"\nD')).toBe('"A;B ""C""\nD"');
  });

  it("blocks invalid missing fields", () => {
    const draft = validDraft({
      accomodationPlaceUin: "",
      tourists: [{
        ...validDraft().tourists[0],
        lastName: "",
        birthDate: "",
        genderTypeCode: "",
        identityDocumentCountryCode: "B",
        room: "",
        avgNightPrice: ""
      }]
    });

    const errors = validateEstiExport(baseReservation, draft);
    expect(errors.map((error) => error.field)).toContain("accomodationPlaceUin");
    expect(errors.some((error) => error.field.includes("lastName"))).toBe(true);
    expect(errors.some((error) => error.field.includes("birthDate"))).toBe(true);
    expect(errors.some((error) => error.field.includes("genderTypeCode"))).toBe(true);
    expect(errors.some((error) => error.field.includes("identityDocumentCountryCode"))).toBe(true);
    expect(errors.some((error) => error.field.includes("room"))).toBe(true);
  });

  it("formats ESTI dates correctly", () => {
    expect(formatEstiDate("2026-05-18")).toBe("18.05.2026");
    expect(formatEstiDateTime("2026-05-18", "14:30")).toBe("18.05.2026 14:30");
  });
});
