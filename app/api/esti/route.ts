import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { normalizeImportedData } from "@/domain/reservations/legacyAdapter";
import { isDraft, transition, type EstiAction, type EstiRecord } from "@/lib/esti/register";

// Separate tree: reservation saves and backups cannot overwrite guest registrations.
const ROOT = "hotel_lidia_esti_v1";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function dbUrl(path: string, token: string) {
  const url = new URL(`${process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL}/${path}.json`);
  url.searchParams.set("auth", token);
  return url.toString();
}
async function authorize(request: NextRequest) {
  const token = request.headers.get("x-firebase-id-token");
  if (!token) throw new Error("401");
  const verification = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!verification.ok) throw new Error("401");
  // Both trees are accessed with the signed-in user's permissions; never use admin bypass.
  const response = await fetch(dbUrl("lydia_hotel_v1", token), { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("401");
  return { token, data: normalizeImportedData(await response.json()) };
}
function failure(error: unknown) {
  if (error instanceof Error && error.message === "401") return json({ error: "Влез отново в приложението." }, 401);
  return json({ error: "ЕСТИ не успя да зареди или запази. Опитай отново; резервацията не е променена." }, 503);
}
export async function GET(request: NextRequest) {
  try {
    const { token } = await authorize(request);
    const response = await fetch(dbUrl(ROOT, token), { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) return json({ error: "Няма достъп до ЕСТИ регистъра. Необходимо е да се проверят правата в базата." }, 403);
    return json({ records: await response.json() || {} });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const { token, data } = await authorize(request);
    const raw = await request.text();
    if (raw.length > 150000) return json({ error: "Твърде голям запис." }, 400);
    const body = JSON.parse(raw);
    const reservation = data.reservations[body.reservationId];
    if (!reservation || !/^[a-zA-Z0-9_-]+$/.test(reservation.id)) return json({ error: "Резервацията не е намерена." }, 404);
    if (!Number.isInteger(body.revision) || body.revision < 0 || !["save", "export", "accepted", "rejected"].includes(body.action) || (body.action === "save" && !isDraft(body.draft))) return json({ error: "Невалидни данни." }, 400);
    const url = dbUrl(`${ROOT}/${reservation.id}`, token);
    const previous = await fetch(url, { headers: { "X-Firebase-ETag": "true" }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!previous.ok) return json({ error: "Няма достъп до ЕСТИ регистъра." }, 403);
    const etag = previous.headers.get("etag");
    if (!etag) throw new Error("Missing concurrency guard");
    let record: EstiRecord;
    try { record = transition(await previous.json(), body as EstiAction, reservation, new Date().toISOString(), randomUUID()); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Конфликт." }, 409); }
    const saved = await fetch(url, { method: "PUT", headers: { "content-type": "application/json", "if-match": etag }, body: JSON.stringify(record), signal: AbortSignal.timeout(10000) });
    if (saved.status === 412) return json({ error: "Данните са променени от друг екран. Затвори и отвори отново." }, 409);
    if (!saved.ok) throw new Error("Write failed");
    return json({ record });
  } catch (error) { return failure(error); }
}
