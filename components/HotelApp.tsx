"use client";

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Download, Euro, Home, Plus, Search, Upload } from "lucide-react";
import { validateReservationConflict } from "@/domain/reservations/conflicts";
import { activeOnDate, addDaysISO, monthKey, normalizeCheckout, overlapsMonth, todayISO } from "@/domain/reservations/dateRange";
import { normalizeImportedData } from "@/domain/reservations/legacyAdapter";
import { deleteReservationById, upsertReservation } from "@/domain/reservations/store";
import { EMPTY_DATA, PROPERTIES, type AppData, type Expense, type ManualIncome, type PropertyId, type Reservation, type RoomId } from "@/domain/reservations/types";
import { reservationBalance } from "@/domain/finance/kpis";
import { getBulgarianHolidayInfo, type BulgarianHolidayInfo } from "@/domain/holidays/bgHolidayCalendar";
import { formatBulgarianDateRange } from "@/lib/bgDateFormat";
import { eur } from "@/lib/currency";
import { createId } from "@/lib/ids";
import { loadHotelData, saveHotelData } from "@/lib/firebase/db";
import { hasFirebaseConfig } from "@/lib/firebase/client";
import { listenAuth, logout } from "@/lib/firebase/auth";
import { createBackup, createDailyBackupIfNeeded, listBackups, restoreBackup, type BackupListItem } from "@/lib/firebase/backups";
import type { User } from "firebase/auth";

type Tab = "upcoming" | "calendar" | "transactions" | "finance";
type ListFilter = "all" | "today" | "next7" | "month" | "noDeposit";
type ReservationDraft = Omit<Reservation, "id" | "createdAt" | "updatedAt" | "status"> & { id?: string };
const WHOLE_PROPERTY_LABEL = "цялата";

function debugClick(action: string) {
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[Hotel Lidia] ${action}`);
  }
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { type = "button", disabled = false, className, children, onClick, ...props },
  ref
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled}
      className={className}
      onClick={onClick}
    >
      {children}
    </button>
  );
});

function AuthMessage({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-8 text-ink">
      <section className="soft-card w-full rounded-3xl p-6 text-center">
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="mt-2 text-base font-semibold text-clay">{text}</p>
      </section>
    </main>
  );
}

function LoginScreen() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-8 text-ink">
      <form className="soft-card w-full rounded-3xl p-5 shadow-sm" action="/api/login" method="post">
        <h1 className="text-3xl font-black">Hotel Lidia</h1>
        <p className="mt-2 text-base font-semibold text-clay">Вход за семейството.</p>
        <label className="mt-5 block font-bold text-clay">
          Email
          <input className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100" name="email" type="email" autoComplete="email" required />
        </label>
        <label className="mt-3 block font-bold text-clay">
          Парола
          <input className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100" name="password" type="password" autoComplete="current-password" required />
        </label>
        <Button type="submit" className="tap-target mt-5 w-full rounded-2xl bg-brand-600 px-5 py-3 text-base font-black text-white shadow-sm">
          Вход
        </Button>
      </form>
    </main>
  );
}

const incomeTypes = ["Общ приход", "Настаняване", "Храна/напитки", "Турист. такса", "Друг приход"];
const expenseTypes = ["Комунални", "Почистване", "Поддръжка", "Комисиони", "Данъци/такси", "Друг разход"];

export function HotelApp({
  initialTab = "upcoming",
  initialProperty = "villa",
  initialMonth,
  initialListFilter,
  initialQuery,
  initialNewReservation = false,
  initialReservationDate,
  initialReservationRoom,
  initialEditReservationId,
  initialData = EMPTY_DATA,
  initialSyncLabel,
  initialServerSession = false
}: {
  initialTab?: Tab;
  initialProperty?: PropertyId;
  initialMonth?: string;
  initialListFilter?: ListFilter;
  initialQuery?: string;
  initialNewReservation?: boolean;
  initialReservationDate?: string;
  initialReservationRoom?: string;
  initialEditReservationId?: string;
  initialData?: AppData;
  initialSyncLabel?: string;
  initialServerSession?: boolean;
}) {
  const [data, setData] = useState<AppData>(initialData);
  const [month, setMonth] = useState(() => initialMonth || monthKey(todayISO()));
  const [activeProperty, setActiveProperty] = useState<PropertyId>(initialProperty);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [listFilter, setListFilter] = useState<ListFilter>(initialListFilter || "all");
  const [query, setQuery] = useState(initialQuery || "");
  const [sync, setSync] = useState(initialSyncLabel || (Object.keys(initialData.reservations).length ? "Облак: заредено" : "Зареждане..."));
  const [modalDraft, setModalDraft] = useState<ReservationDraft | null>(null);
  const [urlModalDismissed, setUrlModalDismissed] = useState(false);
  const [authReady, setAuthReady] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [backups, setBackups] = useState<BackupListItem[]>([]);
  const [backupStatus, setBackupStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const handledInitialEditRef = useRef(false);

  const reservations = useMemo(() => Object.values(data.reservations).sort((a, b) => a.checkin.localeCompare(b.checkin)), [data.reservations]);
  const urlModalDraft = !urlModalDismissed ? getUrlModalDraft({
    data,
    initialEditReservationId,
    initialNewReservation,
    initialProperty,
    initialReservationDate,
    initialReservationRoom
  }) : null;
  const activeModalDraft = modalDraft || urlModalDraft;
  const cleanUrl = `/?tab=${tab}&property=${activeProperty}`;

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      } else {
        navigator.serviceWorker.getRegistrations()
          .then((registrations) => registrations.forEach((registration) => registration.unregister()))
          .catch(() => undefined);
      }
    }
  }, []);

  useEffect(() => {
    if (!hasFirebaseConfig()) {
      setAuthReady(true);
      return;
    }

    let resolved = false;
    const fallback = window.setTimeout(() => {
      if (!resolved) {
        setAuthReady(true);
      }
    }, 5000);

    try {
      const unsubscribe = listenAuth((nextUser) => {
        resolved = true;
        window.clearTimeout(fallback);
        setUser(nextUser);
        setAuthReady(true);
      });
      return () => {
        window.clearTimeout(fallback);
        unsubscribe();
      };
    } catch {
      window.clearTimeout(fallback);
      setAuthReady(true);
    }
  }, []);

  useEffect(() => {
    if (!initialNewReservation) return;
    openNewReservation(initialProperty, initialReservationDate || todayISO(), normalizeInitialRoom(initialReservationRoom));
    window.history.replaceState(null, "", `/?tab=${initialTab}&property=${initialProperty}`);
    // URL parameters are only an opening hint; after hydration the modal is normal component state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    loadHotelData().then(({ data: loaded, source }) => {
      setData(loaded);
      setSync(source === "cloud" ? "Облак: синхронизирано" : source === "local" ? "Локален backup" : "Няма данни");
      if (source === "cloud") {
        createDailyBackupIfNeeded(loaded, user.email || undefined)
          .then(() => refreshBackups())
          .catch(() => undefined);
      }
    }).catch(() => {
      setSync("Грешка при зареждане");
    });
    refreshBackups();
  }, [user]);

  useEffect(() => {
    if (!initialEditReservationId || handledInitialEditRef.current) return;
    const reservation = data.reservations[initialEditReservationId];
    if (!reservation) return;
    handledInitialEditRef.current = true;
    setModalDraft({ ...reservation });
  }, [data.reservations, initialEditReservationId]);

  async function persist(nextData: AppData) {
    setData(nextData);
    const target = await saveHotelData(nextData);
    setSync(target === "cloud" ? "Облак: записано" : "Записано локално");
    refreshBackups();
  }

  async function refreshBackups() {
    listBackups().then(setBackups).catch(() => undefined);
  }

  function openNewReservation(propertyId = activeProperty, isoDate = todayISO(), room: RoomId | "all" = "") {
    setUrlModalDismissed(false);
    setModalDraft(createReservationDraft(propertyId, isoDate, room));
  }

  function openEditReservation(reservation: Reservation) {
    setModalDraft({ ...reservation });
  }

  async function saveReservation(draft: ReservationDraft) {
    const checkout = normalizeCheckout(draft.checkin, draft.checkout);
    const id = draft.id || createId("res");
    const now = new Date().toISOString();
    const reservation: Reservation = {
      ...draft,
      id,
      checkout,
      rooms: draft.rooms.includes("all") ? ["all"] : draft.rooms.map(String).sort((a, b) => Number(a) - Number(b)),
      depositAmount: Number(draft.depositAmount || 0),
      totalAmount: Number(draft.totalAmount || 0),
      status: Number(draft.depositAmount || 0) > 0 ? "deposit_paid" : "pending",
      createdAt: data.reservations[id]?.createdAt || now,
      updatedAt: now
    };

    if (!reservation.rooms.length) {
      window.alert(`Изберете стая/и или ${WHOLE_PROPERTY_LABEL}.`);
      return;
    }
    if (!reservation.checkin) {
      window.alert("Изберете чек-ин дата.");
      return;
    }
    if (reservation.totalAmount && reservation.totalAmount < reservation.depositAmount) {
      window.alert("Общата сума не може да е по-малка от капарото.");
      return;
    }

    const conflict = validateReservationConflict(reservation, reservations);
    if (!conflict.ok) {
      window.alert(conflict.message || "Има застъпване с друга резервация.");
      return;
    }

    await persist(upsertReservation(data, reservation));
    setModalDraft(null);
  }

  async function deleteReservation(id: string) {
    if (!window.confirm("Да изтрия ли резервацията?")) return;
    await createBackup(data, "before-delete", user?.email || undefined);
    await persist(deleteReservationById(data, id));
    setModalDraft(null);
  }

  async function addFinanceRow(kind: "income" | "expense", row: Omit<ManualIncome | Expense, "id" | "month">) {
    const id = createId(kind);
    const monthValue = monthKey(row.date);
    if (kind === "income") {
      await persist({
        ...data,
        manualIncomes: { ...data.manualIncomes, [id]: { ...row, id, month: monthValue } }
      });
    } else {
      await persist({
        ...data,
        expenses: { ...data.expenses, [id]: { ...row, id, month: monthValue } }
      });
    }
  }

  async function removeFinanceRow(kind: "income" | "expense", id: string) {
    const target = kind === "income" ? { ...data.manualIncomes } : { ...data.expenses };
    delete target[id];
    await persist(kind === "income" ? { ...data, manualIncomes: target } : { ...data, expenses: target });
  }

  async function updateFinanceRow(kind: "income" | "expense", id: string, row: Omit<ManualIncome | Expense, "id" | "month">) {
    const monthValue = monthKey(row.date);
    if (kind === "income") {
      const current = data.manualIncomes[id];
      if (!current) return;
      await persist({
        ...data,
        manualIncomes: { ...data.manualIncomes, [id]: { ...current, ...row, id, month: monthValue } }
      });
    } else {
      const current = data.expenses[id];
      if (!current) return;
      await persist({
        ...data,
        expenses: { ...data.expenses, [id]: { ...current, ...row, id, month: monthValue } }
      });
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hotel_lidia_${month}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File) {
    const json = JSON.parse(await file.text());
    const imported = normalizeImportedData(json);
    await createBackup(data, "before-import", user?.email || undefined);
    await persist(imported);
    setSync("JSON импортът е успешен");
  }

  async function handleManualBackup() {
    setBackupStatus("Създаване на backup...");
    try {
      await createBackup(data, "manual", user?.email || undefined);
      await refreshBackups();
      setBackupStatus("Backup-ът е създаден.");
    } catch {
      setBackupStatus("Неуспешно създаване на backup.");
    }
  }

  async function handleRestoreBackup(id: string) {
    setBackupStatus("Възстановяване...");
    try {
      const restored = await restoreBackup(id, user?.email || undefined);
      setData(restored);
      await refreshBackups();
      setSync("Данните са възстановени от backup");
      setBackupStatus("Възстановяването е готово.");
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Backup-ът не може да бъде възстановен.");
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/";
  }

  if (!hasFirebaseConfig()) {
    return <AuthMessage title="Липсва Firebase конфигурация" text="Добавете NEXT_PUBLIC_FIREBASE_* променливите в .env.local или във Vercel Environment Variables." />;
  }

  if (!authReady) {
    return <AuthMessage title="Hotel Lidia" text="Проверка на достъпа..." />;
  }

  if (!user && !initialServerSession) {
    return <LoginScreen />;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-3 pb-28 pt-3 text-ink sm:px-5 lg:pb-8">
      <header className="soft-card sticky top-2 z-20 rounded-2xl p-3 backdrop-blur sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-normal text-ink">Hotel Lidia</h1>
            {tab === "upcoming" && <p className="text-sm font-medium text-clay">{sync}</p>}
          </div>
          <div className="hidden w-full grid-cols-1 gap-2 md:grid md:grid-cols-[1fr_auto_auto_auto_auto] lg:w-auto">
            {tab === "calendar" && <MonthPicker month={month} tab={tab} propertyId={activeProperty} setMonth={setMonth} />}
            <a href={`/?tab=${tab}&property=${activeProperty}&new=1`} className="tap-target inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-black text-white shadow-sm transition hover:bg-brand-700" onClick={(event) => {
              event.preventDefault();
              debugClick("new reservation header");
              window.history.replaceState(null, "", `/?tab=${tab}&property=${activeProperty}&new=1`);
              openNewReservation();
            }}>
              <Plus size={19} /> Нова резервация
            </a>
            <Button type="button" className="tap-target rounded-xl border border-stone-200 bg-cream px-3 py-2 font-bold text-clay shadow-sm" onClick={() => { debugClick("export json"); exportJson(); }} title="Експорт JSON">
              <Download size={18} />
            </Button>
            <Button type="button" className="tap-target rounded-xl border border-stone-200 bg-cream px-3 py-2 font-bold text-clay shadow-sm" onClick={() => { debugClick("import json"); fileRef.current?.click(); }} title="Импорт JSON">
              <Upload size={18} />
            </Button>
            <Button type="button" className="tap-target rounded-xl border border-stone-200 bg-white px-4 py-2 font-bold text-clay shadow-sm" onClick={handleLogout}>
              Изход
            </Button>
            <input
              ref={fileRef}
              className="hidden"
              type="file"
              accept="application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importJson(file).catch(() => window.alert("Невалиден JSON файл."));
                event.currentTarget.value = "";
              }}
            />
          </div>
          <Button type="button" className="tap-target w-fit rounded-xl border border-stone-200 bg-white px-4 py-2 font-bold text-clay shadow-sm md:hidden" onClick={handleLogout}>
            Изход
          </Button>
        </div>
      </header>

      {tab === "calendar" && <div className="hidden md:block">
        <PropertySwitch value={activeProperty} onChange={setActiveProperty} />
      </div>}
      {tab === "calendar" && <div className="md:hidden">
        <MobilePropertySwitch value={activeProperty} onChange={setActiveProperty} tab={tab} />
      </div>}

      <section className="soft-card hidden grid-cols-4 gap-2 rounded-2xl p-2 md:grid">
        <TabButton active={tab === "upcoming"} href={`/?tab=upcoming&property=${activeProperty}`} icon={<Home size={18} />} label="Предстоящи" onClick={() => setTab("upcoming")} />
        <TabButton active={tab === "calendar"} href={`/?tab=calendar&property=${activeProperty}`} icon={<CalendarDays size={18} />} label="Календар" onClick={() => setTab("calendar")} />
        <TabButton active={tab === "transactions"} href={`/?tab=transactions&property=${activeProperty}`} icon={<Euro size={18} />} label="Приходи/Разходи" onClick={() => setTab("transactions")} />
        <TabButton active={tab === "finance"} href={`/?tab=finance&property=${activeProperty}`} icon={<Euro size={18} />} label="Финанси" onClick={() => setTab("finance")} />
      </section>

      {tab === "upcoming" && (
        <UpcomingView
          month={month}
          propertyId={activeProperty}
          reservations={reservations}
          query={query}
          setQuery={setQuery}
          filter={listFilter}
          setFilter={setListFilter}
          onNew={() => openNewReservation()}
          onEdit={openEditReservation}
        />
      )}
      {tab === "upcoming" && (
        <BackupTools
          backups={backups}
          status={backupStatus}
          onCreateBackup={handleManualBackup}
          onRestoreBackup={handleRestoreBackup}
        />
      )}
      {tab === "calendar" && (
        <div className="grid gap-4">
          <CalendarView month={month} propertyId={activeProperty} reservations={reservations} onNew={openNewReservation} onEdit={openEditReservation} />
        </div>
      )}
      {tab === "transactions" && <TransactionsView data={data} month={month} setMonth={setMonth} addRow={addFinanceRow} updateRow={updateFinanceRow} removeRow={removeFinanceRow} />}
      {tab === "finance" && <FinanceView data={data} />}

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 gap-1 border-t border-stone-200 bg-cream/95 p-1.5 shadow-2xl backdrop-blur md:hidden">
        <TabButton active={tab === "upcoming"} href={`/?tab=upcoming&property=${activeProperty}`} icon={<Home size={19} />} label="Предстоящи" onClick={() => setTab("upcoming")} compact />
        <TabButton active={tab === "calendar"} href={`/?tab=calendar&property=${activeProperty}`} icon={<CalendarDays size={19} />} label="Календар" onClick={() => setTab("calendar")} compact />
        <TabButton active={tab === "transactions"} href={`/?tab=transactions&property=${activeProperty}`} icon={<Euro size={19} />} label="Приходи/Разходи" onClick={() => setTab("transactions")} compact />
        <TabButton active={tab === "finance"} href={`/?tab=finance&property=${activeProperty}`} icon={<BarChart3 size={19} />} label="Финанси" onClick={() => setTab("finance")} compact />
      </nav>

      {activeModalDraft && (
        <ReservationModal
          draft={activeModalDraft}
          setDraft={setModalDraft}
          closeHref={cleanUrl}
          onClose={() => {
            setUrlModalDismissed(true);
            setModalDraft(null);
            window.history.replaceState(null, "", cleanUrl);
          }}
          onSave={saveReservation}
          onDelete={activeModalDraft.id ? deleteReservation : undefined}
        />
      )}
    </main>
  );
}

function createReservationDraft(propertyId: PropertyId, isoDate: string, room: RoomId | "all" | "" = ""): ReservationDraft {
  return {
    propertyId,
    rooms: room ? [room] : [],
    checkin: isoDate,
    checkout: addDaysISO(isoDate, 1),
    guestName: "",
    phone: "",
    notes: "",
    depositAmount: 0,
    totalAmount: 0
  };
}

function normalizeInitialRoom(room: string | undefined): RoomId | "all" | "" {
  if (!room) return "";
  if (room === "all") return "all";
  return room as RoomId;
}

function getUrlModalDraft({
  data,
  initialEditReservationId,
  initialNewReservation,
  initialProperty,
  initialReservationDate,
  initialReservationRoom
}: {
  data: AppData;
  initialEditReservationId?: string;
  initialNewReservation: boolean;
  initialProperty: PropertyId;
  initialReservationDate?: string;
  initialReservationRoom?: string;
}): ReservationDraft | null {
  if (initialEditReservationId && data.reservations[initialEditReservationId]) {
    return { ...data.reservations[initialEditReservationId] };
  }
  if (!initialNewReservation) return null;
  return createReservationDraft(initialProperty, initialReservationDate || todayISO(), normalizeInitialRoom(initialReservationRoom));
}

function MonthPicker({ month, tab, propertyId, setMonth }: { month: string; tab: Tab; propertyId: PropertyId; setMonth: (value: string) => void }) {
  function shiftedMonth(delta: number) {
    const [year, monthNumber] = month.split("-").map(Number);
    const next = new Date(year, monthNumber - 1 + delta, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  }

  function hrefFor(nextMonth: string) {
    return `/?tab=${tab}&property=${propertyId}&month=${nextMonth}`;
  }

  function selectMonth(nextMonth: string) {
    setMonth(nextMonth);
    window.history.replaceState(null, "", hrefFor(nextMonth));
  }

  return (
    <div className="grid w-full grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-1 rounded-2xl bg-white/70 p-1 ring-1 ring-stone-200 sm:w-auto sm:grid-cols-[48px_1fr_48px]">
      <a href={hrefFor(shiftedMonth(-1))} className="tap-target inline-flex items-center justify-center rounded-xl bg-cream px-2 text-clay shadow-sm sm:px-3" onClick={(event) => { event.preventDefault(); debugClick("previous month"); selectMonth(shiftedMonth(-1)); }} title="Предишен месец">
        <ChevronLeft size={18} />
      </a>
      <input className="tap-target min-w-0 rounded-xl border-0 bg-transparent px-1 text-center text-sm font-black text-ink outline-none sm:px-3 sm:text-base" type="month" value={month} onChange={(event) => { debugClick("month picker"); selectMonth(event.target.value); }} />
      <a href={hrefFor(shiftedMonth(1))} className="tap-target inline-flex items-center justify-center rounded-xl bg-cream px-2 text-clay shadow-sm sm:px-3" onClick={(event) => { event.preventDefault(); debugClick("next month"); selectMonth(shiftedMonth(1)); }} title="Следващ месец">
        <ChevronRight size={18} />
      </a>
    </div>
  );
}

function PropertySwitch({ value, onChange }: { value: PropertyId; onChange: (value: PropertyId) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 min-[430px]:grid-cols-2">
      {PROPERTIES.map((property) => (
        <a
          href={`/?tab=calendar&property=${property.id}`}
          key={property.id}
          className={`tap-target rounded-2xl px-4 py-3 text-left font-black shadow-sm transition ${value === property.id ? "bg-brand-600 text-white ring-1 ring-brand-700" : "soft-card text-ink"}`}
          onClick={(event) => {
            event.preventDefault();
            debugClick(`property ${property.id}`);
            window.history.replaceState(null, "", `/?tab=calendar&property=${property.id}`);
            onChange(property.id);
          }}
        >
          {property.name}
          <span className="block text-sm font-semibold opacity-80">Стаи {property.rooms.join(", ")}</span>
        </a>
      ))}
    </div>
  );
}

function MobilePropertySwitch({ value, onChange, tab }: { value: PropertyId; onChange: (value: PropertyId) => void; tab: Tab }) {
  return (
    <div className="soft-card grid grid-cols-2 gap-1 rounded-2xl p-1">
      {PROPERTIES.map((property) => (
        <a
          href={`/?tab=${tab}&property=${property.id}`}
          key={property.id}
          className={`tap-target rounded-xl px-3 py-2 text-center text-sm font-black transition ${value === property.id ? "bg-brand-600 text-white shadow-sm" : "text-clay"}`}
          onClick={(event) => {
            event.preventDefault();
            debugClick(`mobile property ${property.id}`);
            window.history.replaceState(null, "", `/?tab=${tab}&property=${property.id}`);
            onChange(property.id);
          }}
        >
          {property.name}
        </a>
      ))}
    </div>
  );
}

function TabButton({ active, href, icon, label, onClick, compact = false }: { active: boolean; href: string; icon: ReactNode; label: string; onClick: () => void; compact?: boolean }) {
  return (
    <a href={href} className={`tap-target flex min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-2 text-center font-bold leading-tight transition ${active ? "bg-brand-600 text-white shadow-sm" : "bg-transparent text-clay hover:bg-white"} ${compact ? "flex-col gap-1 text-[11px]" : ""}`} onClick={(event) => {
      event.preventDefault();
      debugClick(`tab ${label}`);
      window.history.replaceState(null, "", href);
      onClick();
    }}>
      {icon}
      {label}
    </a>
  );
}

function UpcomingView({
  month,
  propertyId,
  reservations,
  query,
  setQuery,
  filter,
  setFilter,
  onNew,
  onEdit
}: {
  month: string;
  propertyId: PropertyId;
  reservations: Reservation[];
  query: string;
  setQuery: (value: string) => void;
  filter: ListFilter;
  setFilter: (value: ListFilter) => void;
  onNew: () => void;
  onEdit: (reservation: Reservation) => void;
}) {
  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);
  const activeReservations = reservations.filter((reservation) => reservation.status !== "cancelled");
  const todayArrivals = sortOperationalReservations(activeReservations.filter((reservation) => reservation.checkin === today));
  const tomorrowArrivals = sortOperationalReservations(activeReservations.filter((reservation) => reservation.checkin === tomorrow));
  const week = getCurrentWeekDays(today).map((iso) => {
    const active = activeReservations.filter((reservation) => activeOnDate(reservation.checkin, reservation.checkout, iso));
    const arrivals = activeReservations.filter((reservation) => reservation.checkin === iso);
    const departures = activeReservations.filter((reservation) => reservation.checkout === iso);
    const noDeposit = active.some((reservation) => reservation.depositAmount <= 0);
    return { iso, active, arrivals, departures, noDeposit };
  });

  return (
    <section className="grid min-w-0 gap-4">
      <div className="soft-card rounded-3xl p-4">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-black text-ink">Предстоящи</h2>
            <p className="text-sm font-medium text-clay">Бърз преглед за днес, утре и текущата седмица.</p>
          </div>
          <a href={`/?tab=upcoming&property=${propertyId}&new=1`} className="tap-target inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-3 text-base font-black text-white shadow-sm sm:w-auto md:hidden" onClick={(event) => {
            event.preventDefault();
            debugClick("new reservation upcoming top");
            onNew();
          }}>
            <Plus size={19} /> Нова резервация
          </a>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <ArrivalGroup title="Пристигащи днес" empty="Няма пристигащи днес." reservations={todayArrivals} onEdit={onEdit} />
          <ArrivalGroup title="Пристигащи утре" empty="Няма пристигащи утре." reservations={tomorrowArrivals} onEdit={onEdit} />
        </div>
      </div>
      <section className="soft-card min-w-0 overflow-hidden rounded-3xl p-4">
      <h3 className="mb-3 text-xl font-black text-ink">Тази седмица</h3>
        <div className="-mx-1 flex w-full min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-1 pb-3 [scrollbar-width:thin]">
          {week.map((day) => (
            <article key={day.iso} className="min-w-[78vw] max-w-[20rem] shrink-0 snap-start rounded-3xl border border-stone-200 bg-cream p-4 shadow-sm sm:min-w-[260px] md:min-w-[240px]">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-black text-ink">{formatDayName(day.iso)}</div>
                  <div className="text-sm font-bold text-clay">{formatShortDate(day.iso)}</div>
                </div>
                {day.noDeposit && <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-black text-rose-800">Без капаро</span>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold text-stone-700">
                <span className="rounded-2xl bg-white p-2">Пристигащи: {day.arrivals.length}</span>
                <span className="rounded-2xl bg-white p-2">Заминаващи: {day.departures.length}</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-clay">{occupiedSummary(day.active)}</p>
            </article>
          ))}
        </div>
      </section>
      <ReservationsView
        month={month}
        propertyId={propertyId}
        reservations={reservations}
        query={query}
        setQuery={setQuery}
        filter={filter}
        setFilter={setFilter}
        onNew={onNew}
        onEdit={onEdit}
      />
    </section>
  );
}

function ArrivalGroup({ title, empty, reservations, onEdit }: { title: string; empty: string; reservations: Reservation[]; onEdit: (reservation: Reservation) => void }) {
  return (
    <section>
      <h3 className="mb-3 text-xl font-black text-ink">{title}</h3>
      <div className="grid gap-3">
        {reservations.length === 0 && <p className="rounded-3xl bg-cream p-4 text-base font-semibold text-clay">{empty}</p>}
        {reservations.map((reservation) => (
          <ReservationCard key={reservation.id} reservation={reservation} onEdit={onEdit} />
        ))}
      </div>
    </section>
  );
}

function ReservationCard({ reservation, onEdit }: { reservation: Reservation; onEdit: (reservation: Reservation) => void }) {
  return (
    <article className="rounded-3xl border border-stone-200 bg-cream p-5 text-left shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xl font-black text-ink">{reservation.guestName || "Без име"}</div>
          <div className="mt-1 text-base font-bold text-clay">{formatBulgarianDateRange(reservation.checkin, reservation.checkout)}</div>
          <div className="mt-1 text-base font-medium text-clay">{propertyName(reservation.propertyId)} · {roomsLabel(reservation)}</div>
        </div>
        <span className={"w-fit rounded-full px-3 py-1 text-xs font-black " + (reservation.depositAmount > 0 ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900")}>
          {reservation.depositAmount > 0 ? "Има капаро" : "Без капаро"}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-base font-semibold text-stone-700 sm:grid-cols-[1fr_auto_auto] sm:items-center">
        <span><PhoneLink phone={reservation.phone} /></span>
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <span className="rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-stone-200 sm:min-w-28">
            <span className="block text-xs font-black uppercase text-clay">Общо</span>
            <span className="text-lg font-black text-ink sm:text-base">{eur(reservation.totalAmount)}</span>
          </span>
          <span className="rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-stone-200 sm:min-w-28">
            <span className="block text-xs font-black uppercase text-clay">Остатък</span>
            <span className="text-lg font-black text-rose-800 sm:text-base">{eur(reservationBalance(reservation))}</span>
          </span>
        </div>
      </div>
      {reservation.notes && <p className="mt-3 text-base font-medium text-clay">{reservation.notes}</p>}
      <a href={`/?tab=upcoming&property=${reservation.propertyId}&edit=${reservation.id}`} className="tap-target mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-brand-600 px-4 py-3 text-base font-black text-white shadow-sm sm:w-auto" onClick={(event) => {
        event.preventDefault();
        debugClick("edit upcoming reservation");
        onEdit(reservation);
      }}>Редакция</a>
    </article>
  );
}

function BackupTools({ backups, status, onCreateBackup, onRestoreBackup }: { backups: BackupListItem[]; status: string; onCreateBackup: () => Promise<void>; onRestoreBackup: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<BackupListItem | null>(null);
  const latest = backups[0];

  return (
    <section className="soft-card rounded-3xl p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-ink">Инструменти и backup</h2>
          <p className="text-sm font-semibold text-clay">За защита при грешка, изтриване или проблем с Firebase.</p>
        </div>
        <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-2 font-black text-clay shadow-sm" onClick={() => setOpen((value) => !value)}>
          {open ? "Скрий" : "Покажи"}
        </Button>
      </div>
      {open && (
        <div className="mt-4 grid gap-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" className="tap-target rounded-2xl bg-brand-600 px-5 py-3 font-black text-white shadow-sm" onClick={() => void onCreateBackup()}>
              Създай backup
            </Button>
            {latest && (
              <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-5 py-3 font-black text-clay shadow-sm" onClick={() => setPendingRestore(latest)}>
                Върни предишното състояние
              </Button>
            )}
          </div>
          {status && <p className="rounded-2xl bg-cream p-3 text-sm font-black text-clay">{status}</p>}
          <div className="grid gap-2">
            <h3 className="text-lg font-black text-ink">Backup история</h3>
            {!backups.length && <p className="rounded-2xl bg-cream p-4 text-base font-semibold text-clay">Все още няма backup записи.</p>}
            {backups.map((backup) => (
              <article key={backup.id} className="rounded-3xl border border-stone-200 bg-cream p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-base font-black text-ink">{formatBackupDate(backup.timestamp)}</div>
                    <div className="mt-1 text-sm font-semibold text-clay">{backupTypeLabel(backup.type)}{backup.createdBy ? ` · ${backup.createdBy}` : ""}</div>
                    <div className="mt-2 text-sm font-bold text-stone-700">
                      {backup.summary.reservationsCount} резервации · {backup.summary.financeRecordsCount} finance записи
                    </div>
                    <div className="mt-1 text-xs font-bold text-clay">{formatBackupSize(backup.summary.sizeBytes)}</div>
                  </div>
                  <Button type="button" className="tap-target rounded-2xl border border-rose-200 bg-white px-4 py-2 font-black text-rose-700 shadow-sm" onClick={() => setPendingRestore(backup)}>
                    Restore
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      {pendingRestore && (
        <div className="fixed inset-0 z-50 flex items-end bg-stone-950/45 p-0 sm:items-center sm:justify-center sm:p-4">
          <div className="w-full rounded-t-3xl bg-cream p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl">
            <h3 className="text-xl font-black text-rose-800">⚠ Това ще презапише текущите данни.</h3>
            <p className="mt-2 text-base font-semibold text-clay">Преди restore автоматично ще се създаде safety backup.</p>
            <div className="mt-4 rounded-2xl bg-white p-4 text-sm font-bold text-stone-700">
              <div>{formatBackupDate(pendingRestore.timestamp)}</div>
              <div>{pendingRestore.summary.reservationsCount} резервации</div>
              <div>{pendingRestore.summary.financeRecordsCount} finance записи</div>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-3 font-black text-clay" onClick={() => setPendingRestore(null)}>
                Отказ
              </Button>
              <Button type="button" className="tap-target rounded-2xl bg-rose-700 px-4 py-3 font-black text-white" onClick={() => {
                const id = pendingRestore.id;
                setPendingRestore(null);
                void onRestoreBackup(id);
              }}>
                Възстанови
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function CalendarView({ month, propertyId, reservations, onNew, onEdit }: { month: string; propertyId: PropertyId; reservations: Reservation[]; onNew: (propertyId: PropertyId, isoDate: string, room?: RoomId | "all") => void; onEdit: (reservation: Reservation) => void }) {
  const property = PROPERTIES.find((item) => item.id === propertyId) || PROPERTIES[0];
  const [year, monthNumber] = month.split("-").map(Number);
  const [openHolidayDate, setOpenHolidayDate] = useState<string | null>(null);
  const days = new Date(year, monthNumber, 0).getDate();
  const firstOffset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const visibleReservations = reservations.filter((reservation) => reservation.propertyId === property.id && overlapsMonth(reservation.checkin, reservation.checkout, month));
  const activeHolidayInfo = openHolidayDate ? getBulgarianHolidayInfo(openHolidayDate) : null;

  return (
    <section className="soft-card rounded-3xl p-2 sm:p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-black text-ink sm:text-2xl">{property.name}</h2>
          <p className="text-sm font-medium text-clay">Натисни стая за нова резервация или за редакция.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold text-clay">
          <Legend color="bg-stone-100 border-stone-200" label="Свободна" />
          <Legend color="bg-emerald-100 border-emerald-300" label="Има капаро" />
          <Legend color="bg-rose-100 border-rose-300" label="Без капаро" />
          <Legend color="bg-red-500 border-red-600" label={WHOLE_PROPERTY_LABEL} />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black text-slate-500 sm:text-xs">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map((day) => <div key={day}>{day}</div>)}
      </div>
      <HolidayInfoBar holiday={activeHolidayInfo} />
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: firstOffset }).map((_, index) => <div className="min-h-[78px] rounded-xl bg-stone-50/70 sm:min-h-[92px]" key={`empty-${index}`} />)}
        {Array.from({ length: days }).map((_, index) => {
          const day = index + 1;
          const iso = `${month}-${String(day).padStart(2, "0")}`;
          const dayReservations = visibleReservations.filter((reservation) => activeOnDate(reservation.checkin, reservation.checkout, iso));
          const whole = dayReservations.find((reservation) => reservation.rooms.includes("all"));
          const date = new Date(year, monthNumber - 1, day);
          const weekdayIndex = date.getDay();
          const weekday = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][weekdayIndex];
          const holiday = getBulgarianHolidayInfo(iso);
          const dayTone = holiday
            ? "border-sky-200 bg-sky-50/80"
            : weekdayIndex === 5 || weekdayIndex === 6
              ? "border-amber-100 bg-amber-50/70"
              : "border-stone-200 bg-cream";
          return (
            <div
              key={iso}
              className={`min-h-[88px] rounded-xl border p-1.5 shadow-sm sm:min-h-[108px] sm:p-2 ${dayTone}`}
              title={getHolidayTooltipText(holiday)}
              tabIndex={holiday ? 0 : undefined}
              onMouseEnter={() => {
                if (holiday) setOpenHolidayDate(iso);
              }}
              onFocus={() => {
                if (holiday) setOpenHolidayDate(iso);
              }}
              onClick={(event) => {
                if (!holiday) return;
                const target = event.target as HTMLElement;
                if (target.closest("a,button,input,select,textarea")) return;
                setOpenHolidayDate((current) => current === iso ? null : iso);
              }}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="truncate text-[11px] font-black text-ink sm:text-sm"><span className="hidden sm:inline">{weekday}, </span>{day}</span>
                <span className="rounded-full bg-white/80 px-1 text-[9px] font-black text-clay sm:px-1.5 sm:text-[10px]">{whole ? property.rooms.length : occupiedRooms(dayReservations)}/{property.rooms.length}</span>
              </div>
              {holiday && <div className="mb-1 hidden truncate rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-black text-sky-900 sm:block">{holiday.holidayName}</div>}
              {whole ? (
                <WholePropertyBlock
                  reservation={whole}
                  hasMixedReservations={dayReservations.some((reservation) => !reservation.rooms.includes("all"))}
                  href={`/?tab=calendar&property=${property.id}&edit=${whole.id}`}
                  onEdit={onEdit}
                />
              ) : (
                <div className="grid grid-cols-2 gap-0.5 sm:gap-1">
                  {property.rooms.map((room) => {
                    const reservation = dayReservations.find((item) => item.rooms.map(String).includes(room));
                    return (
                      <RoomTile
                        key={room}
                        room={room}
                        reservation={reservation}
                        href={reservation ? `/?tab=calendar&property=${property.id}&edit=${reservation.id}` : `/?tab=calendar&property=${property.id}&new=1&date=${iso}&room=${room}`}
                        onNew={() => onNew(property.id, iso, room)}
                        onEdit={onEdit}
                      />
                    );
                  })}
                  <RoomTile room="all" reservation={undefined} whole href={`/?tab=calendar&property=${property.id}&new=1&date=${iso}&room=all`} onNew={() => onNew(property.id, iso, "all")} onEdit={onEdit} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RoomTile({ room, reservation, whole, href, onNew, onEdit }: { room: string; reservation?: Reservation; whole?: boolean; href: string; onNew: () => void; onEdit: (reservation: Reservation) => void }) {
  const busy = Boolean(reservation);
  const color = busy
    ? reservation?.rooms.includes("all")
      ? "bg-red-500 text-white border-red-600"
      : reservation?.depositAmount
        ? "bg-emerald-100 text-emerald-900 border-emerald-300"
        : "bg-rose-100 text-rose-900 border-rose-300"
    : "bg-white text-stone-700 border-stone-200";

  return (
    <a href={href} className={`min-h-5 rounded-md border px-1 py-0.5 text-center text-[10px] font-black leading-none shadow-sm transition hover:-translate-y-0.5 hover:shadow sm:min-h-6 sm:rounded-lg sm:text-xs ${color}`} title={reservation ? `${reservation.guestName || "Без име"} ${reservation.checkin} - ${reservation.checkout}` : "Свободно"} onClick={(event) => {
      event.preventDefault();
      debugClick(reservation ? "calendar edit room" : "calendar new room");
      window.history.replaceState(null, "", href);
      if (reservation) onEdit(reservation);
      else onNew();
    }}>
      {whole ? WHOLE_PROPERTY_LABEL : room}
    </a>
  );
}

function HolidayInfoBar({ holiday }: { holiday: BulgarianHolidayInfo | null }) {
  return (
    <div className="my-2 min-h-[44px] rounded-2xl border border-sky-100 bg-sky-50/70 px-3 py-2 text-sm font-semibold text-clay">
      {holiday ? (
        <p>
          <span className="font-black text-sky-900">{formatHolidayDate(holiday.date)} - {holiday.holidayName}</span>
          {holiday.leaveIdeaText && <span> · Идея за отпуск: {holiday.leaveIdeaText}</span>}
        </p>
      ) : (
        <p className="text-sky-900/70">Посочи празничен ден, за да видиш идеи за отпуск.</p>
      )}
    </div>
  );
}

function getHolidayTooltipText(holiday: BulgarianHolidayInfo | null): string | undefined {
  if (!holiday) return undefined;
  return holiday.leaveIdeaText
    ? `${holiday.holidayName} · ${formatHolidayDate(holiday.date)} · ${holiday.leaveIdeaText}`
    : `${holiday.holidayName} · ${formatHolidayDate(holiday.date)}`;
}

function formatHolidayDate(date: string): string {
  const [, monthValue, dayValue] = date.split("-");
  return `${Number(dayValue)}.${monthValue}`;
}

function WholePropertyBlock({ reservation, hasMixedReservations, href, onEdit }: { reservation: Reservation; hasMixedReservations: boolean; href: string; onEdit: (reservation: Reservation) => void }) {
  const color = reservation.depositAmount > 0
    ? "border-emerald-300 bg-emerald-100 text-emerald-950"
    : "border-rose-300 bg-rose-100 text-rose-950";

  return (
    <a
      href={href}
      className={`block min-h-6 rounded-lg border px-2 py-1 text-center text-[11px] font-black leading-tight shadow-sm transition hover:-translate-y-0.5 hover:shadow sm:min-h-7 sm:text-xs ${color}`}
      title={`${reservation.guestName || "Без име"} ${reservation.checkin} - ${reservation.checkout}`}
      onClick={(event) => {
        event.preventDefault();
        debugClick("calendar edit whole block");
        window.history.replaceState(null, "", href);
        onEdit(reservation);
      }}
    >
      <span className="inline-flex items-center justify-center gap-1">
        {WHOLE_PROPERTY_LABEL}
        {hasMixedReservations && <span className="rounded-full bg-white/75 px-1 text-[9px] font-black text-rose-800" title="Има и записи по стаи">!</span>}
      </span>
    </a>
  );
}


function ReservationsView({ month, propertyId, reservations, query, setQuery, filter, setFilter, onNew, onEdit }: { month: string; propertyId: PropertyId; reservations: Reservation[]; query: string; setQuery: (value: string) => void; filter: ListFilter; setFilter: (value: ListFilter) => void; onNew: () => void; onEdit: (reservation: Reservation) => void }) {
  const today = todayISO();
  const property = PROPERTIES.find((item) => item.id === propertyId) || PROPERTIES[0];
  const [roomFilter, setRoomFilter] = useState<RoomId | "all" | "">("");
  const filterItems: Array<[ListFilter, string]> = [["all", "Всички"], ["today", "Днес"], ["next7", "7 дни"], ["month", "Месец"], ["noDeposit", "Без капаро"]];
  const roomItems: Array<[RoomId | "all" | "", string]> = [["", "Всички стаи"], ...property.rooms.map((room): [RoomId, string] => [room, "Стая " + room]), ["all", WHOLE_PROPERTY_LABEL]];
  const filtered = reservations.filter((reservation) => {
    if (reservation.propertyId !== propertyId) return false;
    if (reservation.checkout <= today) return false;
    const text = [reservation.guestName, reservation.phone, reservation.notes, reservation.rooms.join(",")].join(" ").toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (roomFilter === "all" && !reservation.rooms.includes("all")) return false;
    if (roomFilter && roomFilter !== "all" && !reservation.rooms.includes("all") && !reservation.rooms.map(String).includes(roomFilter)) return false;
    if (filter === "today") return activeOnDate(reservation.checkin, reservation.checkout, today);
    if (filter === "next7") return reservation.checkin >= today && reservation.checkin <= addDaysISO(today, 7);
    if (filter === "month") return overlapsMonth(reservation.checkin, reservation.checkout, month);
    if (filter === "noDeposit") return reservation.depositAmount <= 0;
    return true;
  });

  function applyFilter(nextFilter: ListFilter) {
    debugClick("reservation filter " + nextFilter);
    setFilter(nextFilter);
    const params = new URLSearchParams({ tab: "upcoming", property: propertyId, filter: nextFilter });
    if (query) params.set("q", query);
    window.history.replaceState(null, "", "/?" + params.toString());
  }

  const filterControls = (
    <div className="control-wrap gap-2 pb-1">
      {filterItems.map(([value, label]) => (
        <Button key={value} type="button" className={"tap-target min-h-11 rounded-full px-4 py-2.5 text-center text-base font-black leading-tight shadow-sm transition " + (filter === value ? "bg-brand-600 text-white" : "bg-white text-clay ring-1 ring-stone-200")} onClick={() => applyFilter(value)}>
          {label}
        </Button>
      ))}
    </div>
  );

  const roomControls = (
    <div className="control-wrap gap-2 pb-1">
      {roomItems.map(([value, label]) => (
        <Button key={value || "allRooms"} type="button" className={"tap-target min-h-11 rounded-full px-4 py-2.5 text-center text-base font-black leading-tight shadow-sm transition " + (roomFilter === value ? "bg-emerald-700 text-white" : "bg-white text-clay ring-1 ring-stone-200")} onClick={() => {
          debugClick("reservation room filter " + (value || "all"));
          setRoomFilter(value);
        }}>
          {label}
        </Button>
      ))}
    </div>
  );

  const searchBox = (
    <form className="relative" action="/" method="get">
      <input type="hidden" name="tab" value="upcoming" />
      <input type="hidden" name="property" value={propertyId} />
      <input type="hidden" name="filter" value={filter} />
      <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-clay" size={20} />
      <input name="q" className="tap-target min-h-12 w-full rounded-2xl border border-stone-200 bg-cream py-3 pl-12 pr-4 text-base font-semibold outline-none focus:ring-2 focus:ring-brand-100 md:w-96" placeholder="Име, телефон, бележка" value={query} onChange={(event) => setQuery(event.target.value)} />
    </form>
  );

  return (
    <section className="soft-card rounded-3xl p-4 md:p-5">
      <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-2xl font-black text-ink">Всички резервации</h2>
          <p className="text-base font-medium text-clay">{property.name} · {filtered.length} активни записа</p>
        </div>
        <a href={`/?tab=upcoming&property=${propertyId}&new=1`} className="tap-target hidden min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-3 text-base font-black text-white shadow-sm md:inline-flex" onClick={(event) => {
          event.preventDefault();
          debugClick("new reservation reservations tab");
          onNew();
        }}>
          <Plus size={19} /> Нова резервация
        </a>
        <div className="grid gap-3 md:hidden">
          {filterControls}
          {roomControls}
          {searchBox}
        </div>
        <div className="hidden grid-cols-1 gap-3 md:grid">{searchBox}</div>
      </div>
      <div className="mb-4 hidden grid-cols-1 gap-3 md:grid">{filterControls}{roomControls}</div>
      <div className="grid gap-3">
        {filtered.length === 0 && <p className="rounded-3xl bg-cream p-5 text-base font-semibold text-clay">Няма резервации за този филтър.</p>}
        {filtered.map((reservation) => (
          <article key={reservation.id} className="rounded-3xl border border-stone-200 bg-cream p-5 text-left shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xl font-black text-ink">{reservation.guestName || "Без име"}</div>
                <div className="mt-1 text-base font-bold text-clay">{formatBulgarianDateRange(reservation.checkin, reservation.checkout)}</div>
                <div className="mt-1 text-base font-medium text-clay">{propertyName(reservation.propertyId)} · {roomsLabel(reservation)}</div>
              </div>
              <span className={"w-fit rounded-full px-3 py-1.5 text-sm font-black " + (reservation.depositAmount > 0 ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900")}>
                {reservation.depositAmount > 0 ? "Има капаро" : "Без капаро"}
              </span>
            </div>
            <div className="mt-4 grid gap-2 text-base font-semibold text-stone-700 md:grid-cols-[1fr_auto_auto] md:items-center">
              <span><PhoneLink phone={reservation.phone} /></span>
              <div className="grid grid-cols-2 gap-2 md:contents">
                <span className="rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-stone-200 md:min-w-28">
                  <span className="block text-xs font-black uppercase text-clay">Общо</span>
                  <span className="text-lg font-black text-ink md:text-base">{eur(reservation.totalAmount)}</span>
                </span>
                <span className="rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-stone-200 md:min-w-28">
                  <span className="block text-xs font-black uppercase text-clay">Остатък</span>
                  <span className="text-lg font-black text-rose-800 md:text-base">{eur(reservationBalance(reservation))}</span>
                </span>
              </div>
            </div>
            {reservation.notes && <p className="mt-3 text-base font-medium text-clay">{reservation.notes}</p>}
            <a href={`/?tab=upcoming&property=${reservation.propertyId}&edit=${reservation.id}`} className="tap-target mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-brand-600 px-5 py-3 text-base font-black text-white shadow-sm md:w-auto" onClick={(event) => {
              event.preventDefault();
              debugClick("edit reservation");
              onEdit(reservation);
            }}>Редакция</a>
          </article>
        ))}
      </div>
    </section>
  );
}

function TransactionsView({ data, month, setMonth, addRow, updateRow, removeRow }: { data: AppData; month: string; setMonth: (value: string) => void; addRow: (kind: "income" | "expense", row: Omit<ManualIncome | Expense, "id" | "month">) => void; updateRow: (kind: "income" | "expense", id: string, row: Omit<ManualIncome | Expense, "id" | "month">) => void; removeRow: (kind: "income" | "expense", id: string) => void }) {
  const incomes = Object.values(data.manualIncomes).filter((row) => row.month === month);
  const expenses = Object.values(data.expenses).filter((row) => row.month === month);
  const incomeTotal = sumAmounts(incomes.map((row) => row.amount));
  const expenseTotal = sumAmounts(expenses.map((row) => row.amount));

  return (
    <section className="soft-card rounded-3xl p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="mb-1 text-2xl font-black text-ink">Приходи/Разходи</h2>
          <p className="text-sm font-medium text-clay">Ръчни приходи, разходи и списъци по избран месец.</p>
        </div>
        <label className="font-bold text-clay">Месец
          <input className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100 sm:w-48" type="month" value={month} onInput={(event) => setMonth(event.currentTarget.value)} onChange={(event) => setMonth(event.target.value)} />
        </label>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-3xl bg-cream p-4 ring-1 ring-stone-200">
          <div className="text-sm font-bold text-clay">Ръчни приходи за месеца</div>
          <div className="text-2xl font-black text-emerald-800">{eurWhole(incomeTotal)}</div>
        </div>
        <div className="rounded-3xl bg-cream p-4 ring-1 ring-stone-200">
          <div className="text-sm font-bold text-clay">Разходи за месеца</div>
          <div className="text-2xl font-black text-rose-700">{eurWhole(expenseTotal)}</div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <FinancePanel title="Ръчни приходи" kind="income" types={incomeTypes} rows={incomes} addRow={addRow} updateRow={updateRow} removeRow={removeRow} />
        <FinancePanel title="Разходи" kind="expense" types={expenseTypes} rows={expenses} addRow={addRow} updateRow={updateRow} removeRow={removeRow} />
      </div>
    </section>
  );
}

function FinanceView({ data }: { data: AppData }) {
  const [selectedMonth, setSelectedMonth] = useState(monthKey(todayISO()));
  const [showSummary, setShowSummary] = useState(false);
  const kpis = calculateFinanceSummary(data, selectedMonth);
  const ratioLabel = formatExpenseRatio(kpis);

  return (
    <section className="soft-card rounded-3xl p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="mb-1 text-2xl font-black text-ink">Финанси</h2>
          <p className="text-sm font-medium text-clay">Анализи и отчет по месеци.</p>
        </div>
        <label className="font-bold text-clay">Месец
          <input className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100 sm:w-48" type="month" value={selectedMonth} onInput={(event) => setSelectedMonth(event.currentTarget.value)} onChange={(event) => setSelectedMonth(event.target.value)} />
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Kpi label="Резервации" value={kpis.reservationRevenue} />
        <Kpi label="Капаро" value={kpis.deposits} />
        <Kpi label="Ръчни приходи" value={kpis.manualIncome} />
        <Kpi label="Разходи" value={kpis.expenses} danger />
        <Kpi label="Нетно" value={kpis.net} />
        <KpiText label="Разходи / Приходи" value={ratioLabel} danger={kpis.expenses > 0} />
      </div>
      <MonthlyFinanceChart data={data} month={selectedMonth} />
      <div className="mt-4">
        <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-2 font-black text-clay shadow-sm" onClick={() => setShowSummary((value) => !value)}>
          {showSummary ? "Скрий обобщение" : "Покажи обобщение"}
        </Button>
      </div>
      {showSummary && <FinanceSummaryTable data={data} selectedMonth={selectedMonth} />}
    </section>
  );
}

function MonthlyFinanceChart({ data, month }: { data: AppData; month: string }) {
  const kpis = calculateFinanceSummary(data, month);
  const expenseRatio = getExpenseRatio(kpis);
  const ratioAxisMax = Math.max(100, Math.ceil((expenseRatio || 0) / 25) * 25);
  const ratioTop = expenseRatio === null ? null : `${100 - Math.min(expenseRatio, ratioAxisMax) / ratioAxisMax * 100}%`;
  const rows = [
    { label: "Резервации", value: kpis.reservationRevenue, color: "bg-emerald-600" },
    { label: "Капаро", value: kpis.deposits, color: "bg-amber-500" },
    { label: "Ръчни приходи", value: kpis.manualIncome, color: "bg-brand-600" },
    { label: "Разходи", value: kpis.expenses, color: "bg-red-600" },
    { label: "Нетно", value: kpis.net, color: "bg-stone-700" }
  ];
  const maxValue = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  const guideValues = [maxValue, maxValue * 0.75, maxValue * 0.5, maxValue * 0.25, 0];

  return (
    <div className="mt-4 rounded-3xl bg-cream p-4 ring-1 ring-stone-200">
      <h3 className="mb-4 text-lg font-black text-ink">Месечен резултат · {formatMonthLabel(month)}</h3>
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[720px] grid-cols-[70px_1fr_54px] gap-3">
          <div className="flex h-72 flex-col justify-between text-right text-xs font-bold text-clay">
            {guideValues.map((value) => <span key={value}>{eurWhole(value)}</span>)}
          </div>
          <div className="relative flex h-72 items-end justify-around gap-5 border-b border-l border-stone-300 px-4">
            {ratioTop && expenseRatio !== null && (
              <div className="pointer-events-none absolute left-3 right-3 z-10 border-t-4 border-sky-600" style={{ top: ratioTop }}>
                <span className="absolute -top-7 right-0 rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-sky-800 ring-1 ring-sky-200">
                  Разходи/Приходи {formatPercent(expenseRatio)}
                </span>
              </div>
            )}
            {rows.map((row) => {
              const height = Math.max(row.value === 0 ? 0 : 10, (Math.abs(row.value) / maxValue) * 250);
              return (
                <div key={row.label} className="flex min-w-[92px] flex-col items-center justify-end gap-2">
                  <span className="whitespace-nowrap text-xs font-black text-clay">{eurWhole(row.value)}</span>
                  <div className={`w-14 rounded-t-md ${row.color} ${row.value < 0 ? "opacity-70" : ""}`} style={{ height }} title={`${row.label}: ${eurWhole(row.value)}`} />
                  <span className="min-h-10 text-center text-xs font-black text-clay">{row.label}</span>
                </div>
              );
            })}
          </div>
          <div className="flex h-72 flex-col justify-between text-xs font-bold text-sky-800">
            <span>{ratioAxisMax}%</span>
            <span>{Math.round(ratioAxisMax * 0.75)}%</span>
            <span>{Math.round(ratioAxisMax * 0.5)}%</span>
            <span>{Math.round(ratioAxisMax * 0.25)}%</span>
            <span>0%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FinanceSummaryTable({ data, selectedMonth }: { data: AppData; selectedMonth: string }) {
  const months = getFinanceMonths(data, selectedMonth);
  return (
    <div className="mt-4 rounded-3xl bg-cream p-4 ring-1 ring-stone-200">
      <h3 className="mb-4 text-lg font-black text-ink">Обобщение по месеци</h3>
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full border-separate border-spacing-y-2 text-left text-sm">
          <thead className="text-clay">
            <tr>
              <th className="px-3 py-2">Месец</th>
              <th className="px-3 py-2">Резервации</th>
              <th className="px-3 py-2">Капаро</th>
              <th className="px-3 py-2">Ръчни приходи</th>
              <th className="px-3 py-2">Разходи</th>
              <th className="px-3 py-2">Нетно</th>
            </tr>
          </thead>
          <tbody>
            {months.map((monthValue) => {
              const row = calculateFinanceSummary(data, monthValue);
              return (
                <tr key={monthValue} className={monthValue === selectedMonth ? "bg-brand-50" : "bg-white"}>
                  <td className="rounded-l-2xl px-3 py-3 font-black text-ink">{formatMonthLabel(monthValue)}</td>
                  <td className="px-3 py-3 font-bold">{eurWhole(row.reservationRevenue)}</td>
                  <td className="px-3 py-3 font-bold">{eurWhole(row.deposits)}</td>
                  <td className="px-3 py-3 font-bold">{eurWhole(row.manualIncome)}</td>
                  <td className="px-3 py-3 font-bold text-red-700">{eurWhole(row.expenses)}</td>
                  <td className="rounded-r-2xl px-3 py-3 font-black">{eurWhole(row.net)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <YearToDateFinanceChart data={data} months={months} selectedMonth={selectedMonth} />
    </div>
  );
}

function YearToDateFinanceChart({ data, months, selectedMonth }: { data: AppData; months: string[]; selectedMonth: string }) {
  const selectedYear = selectedMonth.slice(0, 4);
  const rows = months
    .filter((monthValue) => monthValue.startsWith(selectedYear + "-"))
    .map((monthValue) => calculateFinanceSummary(data, monthValue));
  const totals = rows.reduce(
    (sum, row) => ({
      reservationRevenue: sum.reservationRevenue + row.reservationRevenue,
      deposits: sum.deposits + row.deposits,
      manualIncome: sum.manualIncome + row.manualIncome,
      expenses: sum.expenses + row.expenses,
      net: sum.net + row.net,
    }),
    { reservationRevenue: 0, deposits: 0, manualIncome: 0, expenses: 0, net: 0 }
  );
  const chartRows = [
    { label: "Резервации", value: totals.reservationRevenue, color: "bg-emerald-600" },
    { label: "Капаро", value: totals.deposits, color: "bg-amber-500" },
    { label: "Ръчни приходи", value: totals.manualIncome, color: "bg-brand-600" },
    { label: "Разходи", value: totals.expenses, color: "bg-red-600" },
    { label: "Нетно", value: totals.net, color: totals.net < 0 ? "bg-rose-700" : "bg-stone-700" },
  ];
  const hasData = chartRows.some((row) => Math.round(Math.abs(row.value)) > 0);
  const maxValue = Math.max(1, ...chartRows.map((row) => Math.abs(row.value)));

  return (
    <div className="mt-5 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
      <h3 className="mb-1 text-lg font-black text-ink">YTD приходи и разходи</h3>
      <p className="mb-4 text-sm font-semibold text-clay">{selectedYear}</p>
      {!hasData ? (
        <p className="rounded-2xl bg-cream p-4 text-base font-semibold text-clay">Няма данни за годината.</p>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex min-w-[620px] items-end justify-around gap-5 border-b border-stone-300 px-4 pt-4">
            {chartRows.map((row) => {
              const height = Math.max(row.value === 0 ? 0 : 12, (Math.abs(row.value) / maxValue) * 220);
              return (
                <div key={row.label} className="flex min-w-[100px] flex-col items-center justify-end gap-2">
                  <span className="whitespace-nowrap text-xs font-black text-clay">{eurWhole(row.value)}</span>
                  <div className={`w-16 rounded-t-md ${row.color} ${row.value < 0 ? "rounded-b-md rounded-t-none opacity-80" : ""}`} style={{ height }} title={`${row.label}: ${eurWhole(row.value)}`} />
                  <span className="min-h-10 text-center text-xs font-black text-clay">{row.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FinancePanel({ title, kind, types, rows, addRow, updateRow, removeRow }: { title: string; kind: "income" | "expense"; types: string[]; rows: Array<ManualIncome | Expense>; addRow: (kind: "income" | "expense", row: Omit<ManualIncome | Expense, "id" | "month">) => void; updateRow: (kind: "income" | "expense", id: string, row: Omit<ManualIncome | Expense, "id" | "month">) => void; removeRow: (kind: "income" | "expense", id: string) => void }) {
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState(types[0]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [showList, setShowList] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  function clearFinanceForm() {
    setAmount("");
    setNote("");
    setEditingId(null);
  }

  function submitFinanceRow() {
    const row = { date, type, amount: Number(amount || 0), note };
    if (editingId) {
      debugClick("finance edit " + kind);
      updateRow(kind, editingId, row);
    } else {
      debugClick("finance add " + kind);
      addRow(kind, row);
    }
    clearFinanceForm();
  }

  function startEditing(row: ManualIncome | Expense) {
    debugClick("finance start edit " + kind);
    setEditingId(row.id);
    setDate(row.date);
    setType(row.type);
    setAmount(String(row.amount || ""));
    setNote(row.note || "");
  }

  return (
    <div className="rounded-3xl border border-stone-200 bg-cream p-4 shadow-sm">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-black text-ink">{title}</h3>
        <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-2 font-black text-clay shadow-sm" onClick={() => setShowList((value) => !value)}>
          {showList ? "Скрий списък" : "Покажи списък"}
        </Button>
      </div>
      <div className="grid gap-2">
        <input className="tap-target rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <select className="tap-target rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100" value={type} onChange={(event) => setType(event.target.value)}>
          {types.map((item) => <option key={item}>{item}</option>)}
        </select>
        <input className="tap-target rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100" inputMode="decimal" placeholder="Сума, €" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <input className="tap-target rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100" placeholder="Описание" value={note} onChange={(event) => setNote(event.target.value)} />
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Button type="button" className="tap-target rounded-2xl bg-brand-600 px-4 py-2 font-black text-white shadow-sm" onClick={submitFinanceRow}>
            {editingId ? "Запази" : "Добави"}
          </Button>
          {editingId && (
            <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-2 font-black text-clay shadow-sm" onClick={clearFinanceForm}>
              Отказ
            </Button>
          )}
        </div>
      </div>
      {showList && (
        <div className="mt-3 grid gap-2">
          {rows.map((row) => (
            <div key={row.id} className="grid gap-3 rounded-2xl bg-white p-3 text-sm shadow-sm sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <span className="block font-bold text-ink">{row.date} · {row.type}</span>
                <span className="block text-clay">{row.note || "—"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <span className="mr-auto font-black sm:mr-2">{eur(row.amount)}</span>
                <Button type="button" className="tap-target rounded-full border border-stone-200 px-4 py-2 font-bold text-clay" onClick={() => startEditing(row)}>Едит</Button>
                <Button type="button" className="tap-target rounded-full border border-stone-200 px-4 py-2 font-bold text-clay" onClick={() => {
                  debugClick("finance remove " + kind);
                  removeRow(kind, row.id);
                }}>Махни</Button>
              </div>
            </div>
          ))}
          {!rows.length && <p className="text-sm font-medium text-clay">Няма записи.</p>}
        </div>
      )}
    </div>
  );
}

function ReservationModal({ draft, setDraft, closeHref, onClose, onSave, onDelete }: { draft: ReservationDraft; setDraft: (draft: ReservationDraft | null) => void; closeHref: string; onClose: () => void; onSave: (draft: ReservationDraft) => void; onDelete?: (id: string) => void }) {
  const property = PROPERTIES.find((item) => item.id === draft.propertyId) || PROPERTIES[0];

  function toggleRoom(room: RoomId | "all") {
    debugClick("modal room " + room);
    const current = draft.rooms.map(String);
    if (room === "all") {
      setDraft({ ...draft, rooms: current.includes("all") ? [] : ["all"] });
      return;
    }
    const withoutWhole = current.filter((item) => item !== "all");
    const next = withoutWhole.includes(room) ? withoutWhole.filter((item) => item !== room) : [...withoutWhole, room];
    setDraft({ ...draft, rooms: next });
  }

  function clearReservationForm() {
    debugClick("clear reservation form");
    setDraft({ ...draft, guestName: "", phone: "", notes: "", depositAmount: 0, totalAmount: 0 });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-stone-950/45 sm:items-center sm:justify-center">
      <form className="max-h-[92vh] w-full overflow-auto rounded-t-3xl bg-cream p-3 shadow-2xl sm:max-w-2xl sm:rounded-3xl sm:p-4" onSubmit={(event) => {
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        event.preventDefault();
        debugClick(submitter?.value === "delete" ? "reservation delete submit" : "reservation save submit");
        if (submitter?.value === "delete" && draft.id && onDelete) {
          onDelete(draft.id);
          return;
        }
        onSave(draft);
      }}>
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-black text-ink sm:text-xl">{draft.id ? "Редакция" : "Нова резервация"} · {property.name}</h2>
          <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-3 py-2 font-black text-clay" onClick={() => {
            debugClick("close reservation modal");
            window.history.replaceState(null, "", closeHref);
            onClose();
          }}>
            Затвори
          </Button>
        </div>
        <FormSection title="Дати">
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <label className="font-bold">Чек-ин
              <input className="tap-target mt-1 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-brand-100 sm:rounded-2xl sm:px-3 sm:text-base" type="date" value={draft.checkin} onChange={(event) => setDraft({ ...draft, checkin: event.target.value })} />
            </label>
            <label className="font-bold">Чек-аут
              <input className="tap-target mt-1 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-brand-100 sm:rounded-2xl sm:px-3 sm:text-base" type="date" value={draft.checkout} onChange={(event) => setDraft({ ...draft, checkout: event.target.value })} />
            </label>
          </div>
        </FormSection>
        <FormSection title="Стаи">
          <p className="mb-2 text-sm font-semibold text-clay">Може да избереш повече от една стая. Избраните стаи са оцветени в синьо.</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            <Button type="button" className={`tap-target rounded-full border px-3 py-2 font-black ${draft.rooms.includes("all") ? "border-red-600 bg-red-500 text-white" : "border-stone-200 bg-white text-stone-700"}`} onClick={() => toggleRoom("all")}>{WHOLE_PROPERTY_LABEL}</Button>
            {property.rooms.map((room) => (
              <Button type="button" key={room} className={`tap-target rounded-full border px-3 py-2 font-black ${draft.rooms.map(String).includes(room) ? "border-brand-700 bg-brand-600 text-white" : "border-stone-200 bg-white text-stone-700"}`} onClick={() => toggleRoom(room)}>
                {room}
              </Button>
            ))}
          </div>
        </FormSection>
        <FormSection title="Гост">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="font-bold">Име
              <input className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100" value={draft.guestName} onChange={(event) => setDraft({ ...draft, guestName: event.target.value })} />
            </label>
            <label className="font-bold">Телефон
              <input className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
            </label>
          </div>
        </FormSection>
        <FormSection title="Плащане">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="font-bold">Капаро (€)
              <input className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100" inputMode="decimal" value={draft.depositAmount || ""} onChange={(event) => setDraft({ ...draft, depositAmount: Number(event.target.value || 0) })} />
            </label>
            <label className="font-bold">Общо (€)
              <input className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100" inputMode="decimal" value={draft.totalAmount || ""} onChange={(event) => setDraft({ ...draft, totalAmount: Number(event.target.value || 0) })} />
            </label>
          </div>
        </FormSection>
        <FormSection title="Бележки">
          <textarea className="mt-1 min-h-20 w-full rounded-2xl border border-stone-200 bg-white p-3 outline-none focus:ring-2 focus:ring-brand-100 sm:min-h-24" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
        </FormSection>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {draft.id && onDelete && <Button type="submit" name="action" value="delete" className="tap-target rounded-2xl border border-red-200 bg-white px-4 py-2 font-black text-red-600" formNoValidate onClick={(event) => {
            debugClick("reservation delete click");
            if (!window.confirm("Да изтрия ли резервацията?")) event.preventDefault();
          }}>Изтрий</Button>}
          <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-2 font-black text-clay" onClick={clearReservationForm}>Изчисти</Button>
          <Button type="submit" className="tap-target rounded-2xl bg-brand-600 px-5 py-3 font-black text-white shadow-sm sm:min-w-40" onClick={() => debugClick("reservation save click")}>Запази</Button>
        </div>
      </form>
    </div>
  );
}

function Kpi({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-3xl border border-stone-200 bg-cream p-4 text-center shadow-sm">
      <div className="text-sm font-bold text-clay">{label}</div>
      <div className={`text-xl font-black ${danger ? "text-rose-700" : "text-ink"}`}>{eurWhole(value)}</div>
    </div>
  );
}

function KpiText({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-3xl border border-stone-200 bg-cream p-4 text-center shadow-sm">
      <div className="text-sm font-bold text-clay">{label}</div>
      <div className={`text-xl font-black ${danger ? "text-rose-700" : "text-ink"}`}>{value}</div>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-3 rounded-3xl bg-white p-3 ring-1 ring-stone-200">
      <h3 className="mb-2 text-sm font-black uppercase tracking-wide text-clay">{title}</h3>
      {children}
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span className={`h-3 w-3 rounded border ${color}`} />{label}</span>;
}

function propertyName(propertyId: PropertyId): string {
  return PROPERTIES.find((property) => property.id === propertyId)?.name || propertyId;
}

function occupiedRooms(reservations: Reservation[]): number {
  return new Set(reservations.flatMap((reservation) => reservation.rooms.filter((room) => room !== "all"))).size;
}

function roomsLabel(reservation: Reservation): string {
  return reservation.rooms.includes("all") ? WHOLE_PROPERTY_LABEL : "Стаи " + reservation.rooms.join(", ");
}

function PhoneLink({ phone }: { phone: string }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return <>Няма телефон</>;
  return (
    <a className="tap-target inline-flex min-h-11 items-center rounded-xl px-0 font-black text-brand-700 underline-offset-4 hover:underline" href={`tel:${normalized}`} onClick={() => debugClick("call phone")}>
      {phone}
    </a>
  );
}

function normalizePhone(phone: string): string {
  return phone.trim().replace(/[\s\-().]/g, "");
}

function sortOperationalReservations(items: Reservation[]): Reservation[] {
  return [...items].sort((a, b) => {
    const property = propertyName(a.propertyId).localeCompare(propertyName(b.propertyId), "bg");
    if (property !== 0) return property;
    const room = firstRoomSortValue(a).localeCompare(firstRoomSortValue(b), "bg", { numeric: true });
    if (room !== 0) return room;
    return (a.guestName || "").localeCompare(b.guestName || "", "bg");
  });
}

function firstRoomSortValue(reservation: Reservation): string {
  return reservation.rooms.includes("all") ? "0" : String(reservation.rooms[0] || "");
}

function getCurrentWeekDays(today: string): string[] {
  const date = parseISODate(today);
  const offset = (date.getDay() + 6) % 7;
  const monday = addDaysISO(today, -offset);
  return Array.from({ length: 7 }, (_, index) => addDaysISO(monday, index));
}

function parseISODate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDayName(isoDate: string): string {
  return ["Неделя", "Понеделник", "Вторник", "Сряда", "Четвъртък", "Петък", "Събота"][parseISODate(isoDate).getDay()];
}

function formatShortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}.${month}`;
}

function formatBackupDate(timestamp: string): string {
  return new Intl.DateTimeFormat("bg-BG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatBackupSize(sizeBytes: number): string {
  if (!sizeBytes) return "Размер: —";
  return `Размер: ${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

function backupTypeLabel(type: BackupListItem["type"]): string {
  const labels: Record<BackupListItem["type"], string> = {
    manual: "Ръчен backup",
    daily: "Дневен backup",
    "before-import": "Преди import",
    "before-delete": "Преди изтриване",
    "before-restore": "Преди restore",
    "auto-save": "Автоматичен backup",
    legacy: "Стар backup"
  };
  return labels[type] || "Backup";
}

function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-");
  const names = ["Яну", "Фев", "Мар", "Апр", "Май", "Юни", "Юли", "Авг", "Сеп", "Окт", "Ное", "Дек"];
  return `${names[Number(monthNumber) - 1] || monthNumber} ${year.slice(2)}`;
}

type FinanceSummary = {
  reservationRevenue: number;
  deposits: number;
  manualIncome: number;
  expenses: number;
  net: number;
};

function calculateFinanceSummary(data: AppData, month: string): FinanceSummary {
  const activeReservations = Object.values(data.reservations).filter(
    (reservation) => reservation.status !== "cancelled" && monthKey(reservation.checkin) === month
  );
  const reservationRevenue = sumAmounts(activeReservations.map((reservation) => reservation.totalAmount));
  const deposits = sumAmounts(activeReservations.map((reservation) => reservation.depositAmount));
  const manualIncome = sumAmounts(
    Object.values(data.manualIncomes)
      .filter((income) => income.month === month && !("linkGroupId" in income))
      .map((income) => income.amount)
  );
  const expenses = sumAmounts(
    Object.values(data.expenses)
      .filter((expense) => expense.month === month)
      .map((expense) => expense.amount)
  );
  return {
    reservationRevenue,
    deposits,
    manualIncome,
    expenses,
    net: reservationRevenue + manualIncome - expenses
  };
}

function getFinanceRevenue(summary: FinanceSummary): number {
  return summary.reservationRevenue + summary.manualIncome;
}

function getExpenseRatio(summary: FinanceSummary): number | null {
  const revenue = getFinanceRevenue(summary);
  return revenue > 0 ? (summary.expenses / revenue) * 100 : null;
}

function formatExpenseRatio(summary: FinanceSummary): string {
  const ratio = getExpenseRatio(summary);
  return ratio === null ? "—" : formatPercent(ratio);
}

function getFinanceMonths(data: AppData, selectedMonth: string): string[] {
  const months = new Set<string>([selectedMonth, monthKey(todayISO())]);
  Object.values(data.reservations).forEach((reservation) => months.add(monthKey(reservation.checkin)));
  Object.values(data.manualIncomes).forEach((income) => months.add(income.month));
  Object.values(data.expenses).forEach((expense) => months.add(expense.month));
  return Array.from(months).sort().reverse();
}

function sumAmounts(values: number[]): number {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function eurWhole(value: number): string {
  return `${formatWholeNumber(value)} €`;
}

function formatWholeNumber(value: number): string {
  return new Intl.NumberFormat("bg-BG", {
    maximumFractionDigits: 0
  }).format(Math.round(Number(value || 0))).replace(/\u00a0/g, " ");
}

function formatPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded}%`;
}

function occupiedSummary(reservations: Reservation[]): string {
  if (!reservations.length) return "Няма заети стаи.";
  const whole = reservations.filter((reservation) => reservation.rooms.includes("all")).map((reservation) => propertyName(reservation.propertyId));
  const roomsByProperty = PROPERTIES.map((property) => {
    const rooms = new Set<string>();
    reservations
      .filter((reservation) => reservation.propertyId === property.id && !reservation.rooms.includes("all"))
      .forEach((reservation) => reservation.rooms.forEach((room) => rooms.add(String(room))));
    return rooms.size ? `${property.name}: ${Array.from(rooms).sort((a, b) => Number(a) - Number(b)).join(", ")}` : "";
  }).filter(Boolean);
  return [...whole.map((name) => `${name}: ${WHOLE_PROPERTY_LABEL}`), ...roomsByProperty].join(" · ");
}
