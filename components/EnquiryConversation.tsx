"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentIdToken } from "@/lib/firebase/auth";

type Message = {id:string;direction:"inbound"|"outbound";body:string;createdAt:string;status:string};
const labels: Record<string,string> = {queued:"На опашка",accepted:"Прието за изпращане",sent:"Изпратено",delivered:"Доставено",failed:"Неуспешно",unknown:"Непотвърден статус",received:"Получено"};
async function api(enquiryId:string, method="GET", data?:object) {
  const token = await getCurrentIdToken();
  const res = await fetch("/api/enquiry-messages" + (method==="GET" ? "?enquiryId="+encodeURIComponent(enquiryId) : ""), {
    method,cache:"no-store",headers:{"content-type":"application/json",...(token?{"x-firebase-id-token":token}:{})},
    body:data?JSON.stringify({enquiryId,...data}):undefined
  });
  const payload=await res.json();
  if (payload.message?.id) return payload;
  if (!res.ok) throw new Error(res.status===503?"Кореспонденцията още не е активирана.":res.status===401?"Влезте отново в профила си.":"Заявката не е потвърдена. Проверете историята преди повторен опит.");
  return payload;
}
export function EnquiryConversation({enquiryId,email}:{enquiryId:string;email:string}) {
  const [messages,setMessages]=useState<Message[]>([]);
  const [draft,setDraft]=useState("");
  const [loading,setLoading]=useState(true);
  const [configured,setConfigured]=useState(false);
  const [error,setError]=useState("");
  const [sendError,setSendError]=useState("");
  const [sending,setSending]=useState(false);
  const [pending,setPending]=useState<{body:string;clientMessageId:string}|null>(null);
  const busy=useRef(false);
  const alive=useRef(true);
  const read=useRef("");
  const refresh=useCallback(async()=>{
    try {
      const payload=await api(enquiryId);
      if(!alive.current)return;
      setMessages(payload.messages||[]);
      setConfigured(payload.configured===true);
      setError("");
    }catch(e){if(alive.current){setError(e instanceof Error?e.message:"Грешка при зареждане.");setConfigured(false);}}
    finally{if(alive.current)setLoading(false);}
  },[enquiryId]);
  useEffect(()=>{
    alive.current=true;
    void refresh();
    const timer=window.setInterval(()=>{if(!document.hidden)void refresh();},30000);
    return()=>{alive.current=false;window.clearInterval(timer);};
  },[refresh]);
  async function markRead(){
    const last=[...messages].reverse().find(m=>m.direction==="inbound");
    if(!last||read.current===last.id)return;
    try {await api(enquiryId,"PATCH",{lastReadMessageId:last.id});read.current=last.id;}catch{setError("Прочитането не е потвърдено. Опитайте отново.");}
  }
  async function send(){
    if(busy.current||!configured||!(pending?.body||draft.trim()))return;
    busy.current=true;setSending(true);setSendError("");
    const attempt=pending||{body:draft.trim(),clientMessageId:crypto.randomUUID()};
    setPending(attempt);
    try{
      const payload=await api(enquiryId,"POST",attempt);
      if(!payload.message?.id)throw new Error("Липсва потвърждение за съобщението.");
      if(!alive.current)return;
      setMessages(current=>[...current.filter(m=>m.id!==payload.message.id),payload.message]);
      setDraft("");setPending(null);
      void refresh();
    }catch(e){if(alive.current)setSendError(e instanceof Error?e.message:"Изпращането не е потвърдено.");}
    finally{busy.current=false;if(alive.current)setSending(false);}
  }
  return <section className="mt-5 rounded-2xl border border-stone-200 bg-white p-4" aria-label="Кореспонденция">
    <h4 className="text-lg font-black">Кореспонденция</h4>
    <p className="mt-1 break-all text-sm text-stone-600">До: {email}</p>
    {loading&&<p role="status">Зареждане...</p>}
    {error&&<p role="status" className="mt-2 text-sm text-red-700">{error}</p>}
    <ol className="my-4 max-h-96 space-y-3 overflow-y-auto" aria-label="История на съобщенията">
      {messages.map(m=><li key={m.id} className={"rounded-xl p-3 "+(m.direction==="outbound"?"bg-cream":"bg-stone-100")}>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-stone-600"><strong>{m.direction==="outbound"?"Вили Лидия":"Гост"}</strong><time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString("bg-BG")}</time></div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{m.body}</p>
        <p className="mt-2 text-xs text-stone-600">{labels[m.status]||"Непотвърден статус"}</p>
      </li>)}
    </ol>
    {!loading&&!error&&messages.length===0&&<p className="my-3 text-sm text-stone-600">Все още няма кореспонденция.</p>}
    {messages.some(m=>m.direction==="inbound")&&<button type="button" onClick={()=>void markRead()} className="mb-3 rounded-xl border px-3 py-2 text-sm">Маркирай отговорите като прочетени</button>}
    <label className="block text-sm font-bold" htmlFor={"reply-"+enquiryId}>Вашият отговор</label>
    <textarea id={"reply-"+enquiryId} value={draft} onChange={e=>setDraft(e.target.value)} maxLength={5000} rows={5} disabled={sending||!!pending||!configured} className="mt-2 w-full rounded-xl border border-stone-300 p-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-stone-100"/>
    {sendError&&<p role="alert" className="mt-2 text-sm text-red-700">{sendError} Повторният опит използва същия идентификатор, за да избегне двойно изпращане.</p>}
    <button type="button" onClick={()=>void send()} disabled={sending||!configured||!(pending?.body||draft.trim())} className="mt-3 rounded-xl bg-brand-600 px-4 py-3 font-bold text-white disabled:opacity-50">{sending?"Изпращане...":pending?"Провери / повтори същото изпращане":"Изпрати отговор"}</button>
    <button type="button" onClick={()=>void refresh()} className="ml-2 mt-3 rounded-xl border px-3 py-3 text-sm">Обнови</button>
  </section>;
}
