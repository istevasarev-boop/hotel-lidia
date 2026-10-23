import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/esti/route";
import { createEmptyData } from "@/domain/reservations/types";
import { v2ToLegacy } from "@/domain/reservations/legacyAdapter";
afterEach(() => vi.unstubAllGlobals());
describe("ESTI API boundaries", () => {
  it("rejects unauthenticated access before database requests", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await GET(new NextRequest("http://localhost/api/esti"))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not bypass denied database access", async () => {
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = "https://test.firebaseio.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", { status: 200 })).mockResolvedValueOnce(new Response("denied", { status: 403 })));
    expect((await GET(new NextRequest("http://localhost/api/esti", { headers: { "x-firebase-id-token": "test" } }))).status).toBe(401);
  });
  it("only writes the separate registration path, guarded by the original ETag", async () => {
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = "https://test.firebaseio.com";
    const data = createEmptyData();
    data.reservations.res_test = { id: "res_test", propertyId: "villa", rooms: ["10"], checkin: "2026-10-23", checkout: "2026-10-25", guestName: "Test", phone: "", notes: "", totalAmount: 200, depositAmount: 0, status: "pending", createdAt: "", updatedAt: "" };
    const fetch = vi.fn().mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(new Response(JSON.stringify(v2ToLegacy(data))))
      .mockResolvedValueOnce(new Response("null", { headers: { etag: "original-version" } }))
      .mockResolvedValueOnce(new Response("conflict", { status: 412 }));
    vi.stubGlobal("fetch", fetch);
    const response = await POST(new NextRequest("http://localhost/api/esti", { method: "POST", headers: { "x-firebase-id-token": "test" }, body: JSON.stringify({ reservationId: "res_test", action: "save", revision: 0, draft: { accomodationPlaceUin: "", checkInTime: "14:00", checkOutTime: "12:00", tourists: [] } }) }));
    expect(response.status).toBe(409);
    const writes = fetch.mock.calls.filter(c => c[1]?.method === "PUT");
    expect(writes).toHaveLength(1);
    expect(new URL(writes[0][0]).pathname).toBe("/hotel_lidia_esti_v1/res_test.json");
    expect(writes[0][1].headers["if-match"]).toBe("original-version");
  });
});
