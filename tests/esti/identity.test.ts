import { describe, it, expect } from "vitest";
import { parseEgn } from "@/lib/esti/identity";
import { buildEstiCsvRows } from "@/lib/esti/csv";
import { validateEstiExport } from "@/lib/esti/validation";
import type { EstiExportDraft } from "@/lib/esti/types";
import type { Reservation } from "@/domain/reservations/types";
const reservation = { id: "test", propertyId: "house", rooms: ["all"], checkin: "2026-10-24", checkout: "2026-10-25" } as Reservation;
function egn(prefix: string) {
  const sum = [2,4,8,5,10,9,7,3,6].reduce((sum,w,i)=>sum+w*Number(prefix[i]),0)%11;
  return prefix + (sum === 10 ? 0 : sum);
}
const draft: EstiExportDraft = { accomodationPlaceUin: "Б4-ИИЩ-1МА-1П", checkInTime: "14:00", checkOutTime: "12:00", tourists: [{ id:"test",firstName:"Test",middleName:"",lastName:"Guest",identificationMode:"birthDate",birthDate:"2000-01-01",genderTypeCode:"F",identityNumber:"",identityDocumentTypeCode:"",identityDocumentNumber:"",identityDocumentCountryCode:"",floor:"",room:"",touristPackage:"FALSE",avgNightPrice:"500" }] };
describe("guest identification",()=>{
  it("accepts name, birth date and gender with other fields empty",()=>expect(validateEstiExport(reservation,draft)).toEqual([]));
  it("requires gender with date",()=>expect(validateEstiExport(reservation,{...draft,tourists:[{...draft.tourists[0],genderTypeCode:""}]}).some(e=>e.field.endsWith("genderTypeCode"))).toBe(true));
  it.each([["004101000","2000-01-01","M"],["992101001","1899-01-01","F"],["800405000","1980-04-05","M"]])("decodes century and gender for synthetic prefix %s",(prefix,birthDate,gender)=>expect(parseEgn(egn(prefix))).toEqual({birthDate,gender}));
  it("rejects invalid checksum and impossible date",()=>{ expect(parseEgn("0000000001")).toBeNull(); expect(parseEgn(egn("004231000"))).toBeNull(); });
  it("exports derived identity and no price, ignoring stale date and gender",()=>{
    const d: EstiExportDraft={...draft,tourists:[{...draft.tourists[0],identificationMode:"egn",identityNumber:egn("004101000"),birthDate:"",genderTypeCode:""}]};
    expect(validateEstiExport(reservation,d)).toEqual([]);
    const row=buildEstiCsvRows(reservation,d)[0];
    expect(row.BirthDate).toBe("01.01.2000"); expect(row.GenderTypeCode).toBe("M"); expect(row.AvgNightPrice).toBe("");
  });
});
