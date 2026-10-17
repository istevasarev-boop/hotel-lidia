import { describe, expect, it } from "vitest";
import { normalizeImportedData, v2ToLegacy } from "@/domain/reservations/legacyAdapter";

describe("legacy data adapter", () => {
  it("converts old reservation masters and skips linked automatic incomes", () => {
    const data = normalizeImportedData({
      reservationMasters: {
        abc: {
          buildingKey: "house",
          rooms: ["1", "2"],
          checkin: "2026-07-01",
          checkout: "2026-07-03",
          name: "Мария",
          phone: "0888",
          notes: "тиха стая",
          advanceAmount: 30,
          totalAmount: 160
        }
      },
      finances: {
        incomes: {
          "2026-07": [
            { date: "2026-07-01", amount: 160, type: "Общ приход", note: "auto", linkGroupId: "abc" },
            { date: "2026-07-02", amount: 20, type: "Друг приход", note: "кафе" }
          ]
        },
        expenses: {
          "2026-07": [{ date: "2026-07-02", amount: 10, type: "Почистване", note: "" }]
        }
      }
    });

    expect(data.schemaVersion).toBe(2);
    expect(data.reservations.abc.guestName).toBe("Мария");
    expect(Object.values(data.manualIncomes)).toHaveLength(1);
    expect(Object.values(data.expenses)).toHaveLength(1);
  });
});


describe("custom finance categories", () => {
  it("preserves unused categories and separately typed transactions through cloud/export round trips", () => {
    const data = normalizeImportedData({
      financeCategories: { income: ["Събития"], expense: ["Косене", "Градина"] },
      finances: { expenses: { "2026-10": [{ date: "2026-10-17", type: "Косене", amount: 50, note: "" }] } }
    });
    const restored = normalizeImportedData(v2ToLegacy(normalizeImportedData(data)));
    expect(restored.financeCategories).toEqual({ income: ["Събития"], expense: ["Косене", "Градина"] });
    expect(Object.values(restored.expenses)[0]).toMatchObject({ type: "Косене", amount: 50 });
    expect(normalizeImportedData({}).financeCategories).toEqual({});
  });
});
