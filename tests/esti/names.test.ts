import { describe, it, expect } from "vitest";
import { splitGuestName, repairAutofilledName } from "@/lib/esti/names";
import type { EstiTouristDraft } from "@/lib/esti/types";
describe("reservation guest names", () => {
  it.each(["Славка Тасева", "Славка Тасева 250", "Славка Тасева 250 лв", "Славка Тасева - 250"])("extracts two names from %s", source => {
    expect(splitGuestName(source)).toEqual({ firstName: "Славка", middleName: "", lastName: "Тасева" });
  });
  it("keeps hyphenated names and uses the last surname for three names", () => {
    expect(splitGuestName("Анна-Мария Иванова Петрова 100")).toEqual({firstName:"Анна-Мария",middleName:"",lastName:"Петрова"});
  });
  it("repairs existing exact auto-fill but preserves edited guest names", () => {
    const old = {firstName:"Славка",middleName:"Тасева",lastName:"250",id:"guest"} as EstiTouristDraft;
    expect(repairAutofilledName(old,"Славка Тасева 250")).toMatchObject({firstName:"Славка",middleName:"",lastName:"Тасева",id:"guest"});
    const edited={...old,lastName:"Петрова"};
    expect(repairAutofilledName(edited,"Славка Тасева 250")).toBe(edited);
  });
});
