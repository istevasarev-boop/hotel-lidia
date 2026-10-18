import { describe, expect, it } from "vitest";
import { buildRevenueBreakdown, reservationRoomGroup, financeHistoryMonths } from "@/domain/finance/revenueBreakdown";
import { createEmptyData, type Reservation } from "@/domain/reservations/types";
import { normalizeImportedData, v2ToLegacy } from "@/domain/reservations/legacyAdapter";
const booking = (id: string, rooms: string[], totalAmount=100): Reservation => ({id, rooms, totalAmount, propertyId:"villa",checkin:"2026-10-30",checkout:"2026-11-02",guestName:id,phone:"",notes:"",depositAmount:20,status:"pending",createdAt:"",updatedAt:""});
describe("revenue-first finance breakdown", () => {
 it("attributes each complete reservation once and keeps mixed/unknown rooms separate", () => {
  const data=createEmptyData();
  const rows=[booking("spa",["5","9"]),booking("mixed",["5","7"],200),booking("unknown",["6"],50),booking("whole",["all"],300),{...booking("cancelled",["5"]),status:"cancelled" as const},{...booking("next",["5"]),checkin:"2026-11-01"}];
  data.reservations=Object.fromEntries(rows.map(row=>[row.id,row]));
  data.manualIncomes={manual:{id:"manual",month:"2026-10",date:"2026-10-01",type:"Друг приход",amount:25,note:""}};
  const report=buildRevenueBreakdown(data,"2026-10");
  expect(report.reservationRevenue).toBe(650);
  expect(Object.values(report.byRoom).reduce((sum,group)=>sum+report.total(group),0)).toBe(650);
  expect(report.manualIncome).toBe(25);
  expect(report.byRoom["Смесени типове стаи"]).toHaveLength(1);
  expect(report.byRoom["Други / некласифицирани стаи"]).toHaveLength(1);
  expect(reservationRoomGroup(booking("balcony",["7"]))).toBe("Без джакузи / балкон");
 });
 it("keeps deposit values inside reservation totals and round-trips expense attribution", () => {
  const data=createEmptyData();data.reservations={a:booking("a",["5"],150),b:{...booking("b",["7"],90),depositAmount:0}};
  data.expenses={cost:{id:"cost",month:"2026-10",date:"2026-10-01",type:"Косене",amount:30,note:"",propertyId:"house"},old:{id:"old",month:"2026-10",date:"2026-10-01",type:"Друг разход",amount:10,note:""}};
  const report=buildRevenueBreakdown(normalizeImportedData(v2ToLegacy(data)),"2026-10");
  expect(report.reservationRevenue).toBe(240);expect(report.deposits).toBe(20);
  expect(report.withDeposit).toHaveLength(1);expect(report.withoutDeposit).toHaveLength(1);
  expect(report.expenses.find(row=>row.type==="Косене")?.propertyId).toBe("house");
  expect(report.expenses.find(row=>row.type==="Друг разход")?.propertyId).toBeUndefined();
 });
});


it("retains every historical year from reservations, manual income and expenses",()=>{
 const data=createEmptyData();data.reservations.old={...booking("old",["5"]),checkin:"2019-02-01",checkout:"2019-02-03"};
 data.manualIncomes.old={id:"old",month:"2020-03",date:"2020-03-01",type:"Друг приход",amount:25,note:""};
 data.expenses.old={id:"old",month:"2021-04",date:"2021-04-01",type:"Друг разход",amount:15,note:""};
 expect(financeHistoryMonths(data,"2026-10","2026-10")).toEqual(["2026-10","2021-04","2020-03","2019-02"]);
 expect(buildRevenueBreakdown(data,"2019-02").reservationRevenue).toBe(100);
 expect(buildRevenueBreakdown(data,"2020-03").manualIncome).toBe(25);
 expect(buildRevenueBreakdown(data,"2021-04").expenses).toHaveLength(1);
});
