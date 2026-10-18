// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FinanceRevenueOverview } from "@/components/FinanceRevenueOverview";
import { createEmptyData } from "@/domain/reservations/types";
afterEach(cleanup);
describe("finance privacy and real drill-downs",()=>{
 it("hides private data, opens real records when revealed and collapses on hide",()=>{
  const data=createEmptyData(); data.reservations.a={id:"a",propertyId:"villa",rooms:["5"],checkin:"2026-10-18",checkout:"2026-10-20",guestName:"Тестов гост",phone:"",notes:"",depositAmount:30,totalAmount:120,status:"pending",createdAt:"",updatedAt:""};
  const props={data,month:"2026-10",unlocked:false,summary:React.createElement('p',null,'История')};
  const view=render(React.createElement(FinanceRevenueOverview,props));
  expect(screen.queryByText('Тестов гост')).toBeNull();
  view.rerender(React.createElement(FinanceRevenueOverview,{...props,unlocked:true}));
  const summary=screen.getByText('Приходи по обект').closest('summary')!;
  expect(summary.parentElement!.hasAttribute('open')).toBe(false);
  fireEvent.click(summary);expect(summary.parentElement!.hasAttribute('open')).toBe(true);
  const group=screen.getAllByText('Вила Лидия').find(node => node.closest('summary'))!.closest('summary')!; fireEvent.click(group);
  expect(screen.getAllByText('Тестов гост')[0].closest('a')!.getAttribute('href')).toContain('edit=a');
  view.rerender(React.createElement(FinanceRevenueOverview,props));
  expect(screen.queryByText('Тестов гост')).toBeNull();
  expect(screen.getByText('Приходи по обект').closest('details')!.hasAttribute('open')).toBe(false);
  expect(screen.getByText('Разходи')).toBeTruthy();
 });
});
