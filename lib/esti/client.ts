"use client";
import { getCurrentIdToken } from "@/lib/firebase/auth";
import { withDeadline } from "@/lib/deadline";
import type { EstiAction, EstiRecord, EstiBatch } from "./register";
import { serializeEstiCsv } from "./csv";
export async function estiRequest(body?: EstiAction & { reservationId: string }): Promise<{ records: Record<string, EstiRecord>; record: EstiRecord }> {
  const token = await withDeadline(getCurrentIdToken(), 8000);
  if (!token) throw new Error("Влез отново в приложението.");
  const response = await fetch("/api/esti", { method: body ? "POST" : "GET", headers: { "x-firebase-id-token": token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: AbortSignal.timeout(45000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Неуспешно запазване.");
  for (const record of Object.values(result.records || {}) as EstiRecord[]) { record.batches ||= []; record.draft.tourists ||= []; }
  if (result.record) { result.record.batches ||= []; result.record.draft.tourists ||= []; }
  return result;
}
export function downloadBatch(batch: EstiBatch, property: string) {
  const url = URL.createObjectURL(new Blob([serializeEstiCsv(batch.rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `ESTI_${property}_${batch.id}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
