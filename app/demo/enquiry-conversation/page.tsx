"use client";
import { useCallback, useRef, useState } from "react";
import { EnquiryConversation } from "@/components/EnquiryConversation";
type Msg={id:string;direction:"inbound"|"outbound";body:string;createdAt:string;status:string};
export default function CorrespondenceDemo(){
 const [version,setVersion]=useState(0);
 const rows=useRef<Msg[]>([
 {id:"demo-1",direction:"inbound",body:"Здравейте! Интересуваме се от настаняване за двама. Бихте ли изпратили предложение?",createdAt:"2026-10-02T12:00:00Z",status:"received"},
 {id:"demo-2",direction:"outbound",body:"Здравейте! Благодарим за интереса. За кои дати планирате престоя си?",createdAt:"2026-10-02T12:15:00Z",status:"delivered"},
 {id:"demo-3",direction:"inbound",body:"За 16-18 октомври. Възможно ли е да разгледаме вариантите?",createdAt:"2026-10-02T12:30:00Z",status:"received"}
 ]);
 const sent=useRef(new Map<string,Msg>());
 const transport=useCallback(async(_id:string,method="GET",data?:object)=>{
   if(method==="GET")return {messages:[...rows.current],configured:true};
   if(method==="PATCH")return {ok:true};
   const input=data as {body:string;clientMessageId:string};
   if(sent.current.has(input.clientMessageId))return {message:sent.current.get(input.clientMessageId)};
   const message:Msg={id:crypto.randomUUID(),direction:"outbound",body:input.body,createdAt:new Date().toISOString(),status:"accepted"};
   rows.current.push(message);sent.current.set(input.clientMessageId,message);
   return {message};
 },[]);
 return <main className="min-h-screen bg-cream p-4 text-ink sm:p-8"><div className="mx-auto max-w-3xl">
 <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900">ВИЗУАЛНО ДЕМО • Само примерни данни. Не се изпращат имейли.</p>
 <header className="my-6"><p className="text-sm text-clay">Запитвания / Примерен гост</p><h1 className="mt-2 text-2xl font-black">Запитване за Вила Лидия</h1><p className="mt-2 text-sm text-clay">16-18 октомври • 2 възрастни • Примерно запитване, без потвърдена наличност</p></header>
 <button type="button" className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-bold" onClick={()=>{rows.current.push({id:crypto.randomUUID(),direction:"inbound",body:"Благодаря за отговора! Каква е следващата стъпка?",createdAt:new Date().toISOString(),status:"received"});setVersion(v=>v+1);}}>Симулирай нов отговор от госта</button>
 <EnquiryConversation key={version} enquiryId="demo" email="guest@example.com" transport={transport}/>
 <p className="mt-4 text-xs text-stone-500">Същият компонент се използва в запитванията. Тук данните се пазят само до презареждане на страницата.</p>
 </div></main>;
}