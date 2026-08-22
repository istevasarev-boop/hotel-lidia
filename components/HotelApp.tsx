"use client";

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import type { ButtonHTMLAttributes, FormEvent, ReactNode, TouchEvent } from "react";
import { BarChart3, Bot, CalendarDays, ChevronLeft, ChevronRight, Download, Euro, Eye, EyeOff, Home, LockKeyhole, Mic, Plus, Search, Send, Upload, Volume2, VolumeX, X } from "lucide-react";
import { BOOKING_ROOM_TYPES, BOOKING_TYPE_LABELS, getSafeBookingInventory } from "@/domain/booking/availability";
import { validateReservationConflict } from "@/domain/reservations/conflicts";
import { activeOnDate, addDaysISO, eachNight, monthKey, normalizeCheckout, overlapsMonth, todayISO } from "@/domain/reservations/dateRange";
import { normalizeImportedData } from "@/domain/reservations/legacyAdapter";
import { upsertReservation } from "@/domain/reservations/store";
import { EMPTY_DATA, PROPERTIES, type AppData, type BookingTypeId, type Expense, type ManualIncome, type PropertyId, type Reservation, type RoomId } from "@/domain/reservations/types";
import { calculateOccupancyPercent, reservationBalance } from "@/domain/finance/kpis";
import { getBulgarianHolidayInfo, type BulgarianHolidayInfo } from "@/domain/holidays/bgHolidayCalendar";
import { formatBulgarianDateRange, formatBulgarianDayOrdinal } from "@/lib/bgDateFormat";
import { eur } from "@/lib/currency";
import { createId } from "@/lib/ids";
import { fetchCalendarWeather, fetchWeeklyWeather, type DailyWeather } from "@/lib/weather";
import { deleteHotelReservation, isFirebaseDataError, loadHotelData, saveHotelData } from "@/lib/firebase/db";
import { hasFirebaseConfig } from "@/lib/firebase/client";
import { listenAuth, loginWithEmail, logout } from "@/lib/firebase/auth";
import { createBackup, createDailyBackupIfNeeded, listBackups, restoreBackup, type BackupListItem } from "@/lib/firebase/backups";
import { EstiExportModal } from "@/components/esti/EstiExportModal";
import type { User } from "firebase/auth";

type Tab = "upcoming" | "calendar" | "transactions" | "finance";
type ListFilter = "all" | "today" | "next7" | "month" | "noDeposit" | "history";
type ReservationDraft = Omit<Reservation, "id" | "createdAt" | "updatedAt" | "status"> & { id?: string };
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};
const WHOLE_PROPERTY_LABEL = "цялата";
const ENABLE_BOOKING_MODE = false;
const ENABLE_ESTI_EXPORT = process.env.NEXT_PUBLIC_ENABLE_ESTI_EXPORT !== "false";
const JACUZZI_ROOMS = new Set(["1", "3", "5", "6", "9", "10"]);
const HIGH_VALUE_GUEST_AVERAGE_EUR = 500;
const BUDGET_GUEST_AVERAGE_EUR = 150;
const PROVERBS_OF_THE_DAY = [
  "Който резервира навреме, спокойно спи.",
  "Празна стая радва само праха.",
  "Капарото е майката на спокойствието.",
  "Гост без телефон е като стая без ключ.",
  "Днес свободна стая, утре пропусната възможност.",
  "Който гледа календара, не дублира резервации.",
  "Добрата резервация започва с точна дата.",
  "Стаята е свободна, но само докато не звънне телефонът.",
  "Без капаро — без спокойствие.",
  "Пълният уикенд топли сърцето.",
  "Който пита за цена, вече мисли за почивка.",
  "Най-добрият гост е този, който идва пак."
];

function debugClick(action: string) {
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[Hotel Lidia] ${action}`);
  }
}

function pulsePrivacyHaptic() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(12);
  }
}

function getDeleteErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const message = error instanceof Error ? error.message : String(error || "");

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "Няма връзка с облака. Опитай пак.";
  }
  if (code.includes("permission") || /permission|denied|PERMISSION_DENIED/i.test(message)) {
    return "Нямаш права да изтриеш тази резервация.";
  }
  if (/timed out|timeout|network|fetch/i.test(message)) {
    return "Няма връзка с облака. Опитай пак.";
  }
  if (/still exists after canonical delete/i.test(message)) {
    return "Облакът не потвърди изтриването. Резервацията остава на екрана.";
  }
  return "Изтриването не беше успешно. Опитай пак.";
}

function getSaveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "Няма връзка с облака. Резервацията не е записана.";
  }
  if (isFirebaseDataError(error, "permission-denied") || /permission|denied|PERMISSION_DENIED|401|403/i.test(message)) {
    return "Нямаш достъп до Firebase. Резервацията не е записана.";
  }
  return "Записът не беше потвърден в облака. Резервацията не е записана.";
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
  const loading = text.includes("Проверка") || text.includes("Зареж");
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-8 text-ink">
      <section className="soft-card w-full rounded-3xl p-6 text-center">
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="mt-2 text-base font-semibold text-clay">{text}</p>
        {loading && (
          <div className="mt-6 grid gap-3">
            <div className="soft-skeleton mx-auto h-4 w-3/4 rounded-full" />
            <div className="soft-skeleton mx-auto h-4 w-1/2 rounded-full" />
            <div className="soft-skeleton h-12 rounded-2xl" />
          </div>
        )}
      </section>
    </main>
  );
}

function LoginScreen() {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    if (!email || !password) return;

    setSubmitting(true);
    setError("");
    try {
      await loginWithEmail(email, password);
    } catch (loginError) {
      console.error("Firebase login failed", loginError);
      setError("Грешен email или парола.");
      await clearSessionCookie();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-8 text-ink">
      <form className="soft-card w-full rounded-3xl p-5 shadow-sm" onSubmit={handleLogin}>
        <h1 className="text-3xl font-black">Hotel Lidia</h1>
        <p className="mt-2 text-base font-semibold text-clay">Вход за семейството.</p>
        {error && (
          <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
            {error}
          </div>
        )}
        <label className="mt-5 block font-bold text-clay">
          Email
          <input className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100" name="email" type="email" autoComplete="email" required />
        </label>
        <label className="mt-3 block font-bold text-clay">
          Парола
          <input className="tap-target mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 outline-none focus:ring-2 focus:ring-brand-100" name="password" type="password" autoComplete="current-password" required />
        </label>
        <Button type="submit" disabled={submitting} className="tap-target mt-5 w-full rounded-2xl bg-brand-600 px-5 py-3 text-base font-black text-white shadow-sm disabled:opacity-60">
          {submitting ? "Влизане..." : "Вход"}
        </Button>
      </form>
    </main>
  );
}

async function syncSessionCookie(user: User | null): Promise<void> {
  if (!user) {
    await clearSessionCookie();
    return;
  }

  const idToken = await user.getIdToken();
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  if (!response.ok) throw new Error(`Session sync failed: ${response.status}`);
}

async function clearSessionCookie(): Promise<void> {
  await fetch("/api/session", { method: "DELETE" }).catch(() => undefined);
  await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
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
  initialCalendarDate,
  initialReservationRoom,
  initialEditReservationId,
  initialData = EMPTY_DATA,
  initialSyncLabel,
  initialLoadSource = "empty"
}: {
  initialTab?: Tab;
  initialProperty?: PropertyId;
  initialMonth?: string;
  initialListFilter?: ListFilter;
  initialQuery?: string;
  initialNewReservation?: boolean;
  initialReservationDate?: string;
  initialCalendarDate?: string;
  initialReservationRoom?: string;
  initialEditReservationId?: string;
  initialData?: AppData;
  initialSyncLabel?: string;
  initialLoadSource?: "cloud" | "empty" | "permission-denied" | "cloud-unavailable";
}) {
  const [data, setData] = useState<AppData>(initialData);
  const [month, setMonth] = useState(() => initialMonth || monthKey(todayISO()));
  const [activeProperty] = useState<PropertyId>(initialProperty);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [listFilter, setListFilter] = useState<ListFilter>(initialListFilter || "all");
  const [query, setQuery] = useState(initialQuery || "");
  const [sync, setSync] = useState(initialSyncLabel || (Object.keys(initialData.reservations).length ? "Облак: заредено" : "Зареждане..."));
  const [cloudAccessError, setCloudAccessError] = useState(
    initialLoadSource === "permission-denied" ? "Firebase отказа достъп до данните. Влезте отново." : ""
  );
  const [cloudLoading, setCloudLoading] = useState(initialLoadSource !== "cloud");
  const [modalDraft, setModalDraft] = useState<ReservationDraft | null>(null);
  const [urlModalDismissed, setUrlModalDismissed] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [backups, setBackups] = useState<BackupListItem[]>([]);
  const [backupStatus, setBackupStatus] = useState("");
  const [financeUnlocked, setFinanceUnlocked] = useState(false);
  const [guestMemoryTarget, setGuestMemoryTarget] = useState<ReservationDraft | null>(null);
  const [estiReservation, setEstiReservation] = useState<Reservation | null>(null);
  const [calendarPickMode, setCalendarPickMode] = useState<"free_rooms" | null>(null);
  const [online, setOnline] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const handledInitialEditRef = useRef(false);
  const latestDataRef = useRef(initialData);

  const reservations = useMemo(() => Object.values(data.reservations).sort((a, b) => a.checkin.localeCompare(b.checkin)), [data.reservations]);
  const initialDataLoading = sync.includes("Зареж") && reservations.length === 0;
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
    latestDataRef.current = data;
  }, [data]);

  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    function updateOnlineStatus() {
      setOnline(navigator.onLine);
    }
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
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
        syncSessionCookie(nextUser).catch((error) => {
          console.warn("Firebase session cookie sync failed.", error);
          if (!nextUser) return;
          setSync("Проблем със сесията");
        });
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
    setCloudLoading(true);
    setCloudAccessError("");
    loadHotelData().then(({ data: loaded, source }) => {
      setData(loaded);
      setSync(source === "cloud" ? "Облак: синхронизирано" : source === "local" ? "Локален backup" : "Няма данни");
      setCloudLoading(false);
      if (source === "cloud") {
        createDailyBackupIfNeeded(loaded, user.email || undefined)
          .then(() => refreshBackups())
          .catch(() => undefined);
      }
    }).catch((error) => {
      console.warn("Hotel data load failed.", error);
      setCloudLoading(false);
      const message = isFirebaseDataError(error, "permission-denied")
        ? "Firebase отказа достъп до данните. Влезте отново."
        : error instanceof Error
          ? error.message
          : "Firebase данните не могат да бъдат заредени.";
      setCloudAccessError(message);
      setSync("Грешка при зареждане");
    });
    refreshBackups();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const interval = window.setInterval(() => {
      createDailyBackupIfNeeded(latestDataRef.current, user.email || undefined)
        .then((created) => {
          if (created) refreshBackups();
        })
        .catch(() => undefined);
    }, 60 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (!initialEditReservationId || handledInitialEditRef.current) return;
    const reservation = data.reservations[initialEditReservationId];
    if (!reservation) return;
    handledInitialEditRef.current = true;
    setModalDraft({ ...reservation });
  }, [data.reservations, initialEditReservationId]);

  async function persist(nextData: AppData) {
    const target = await saveHotelData(nextData);
    const loaded = target === "cloud" ? await loadHotelData() : null;
    setData(loaded?.data || nextData);
    setSync(target === "cloud" ? "Облак: записано" : "Записано локално");
    setCloudAccessError("");
    refreshBackups();
  }

  async function refreshBackups() {
    listBackups().then(setBackups).catch(() => undefined);
  }

  function openNewReservation(propertyId = activeProperty, isoDate = todayISO(), room: RoomId | "all" = "", draftOverride?: ReservationDraft) {
    setUrlModalDismissed(false);
    setModalDraft(draftOverride || createReservationDraft(propertyId, isoDate, room));
  }

  function openEditReservation(reservation: Reservation) {
    setModalDraft({ ...reservation });
  }

  function openGuestMemory(reservation: Reservation | ReservationDraft) {
    setGuestMemoryTarget({ ...reservation });
  }

  function openEstiExport(reservation: Reservation) {
    setEstiReservation({ ...reservation });
  }

  function startFreeRoomsPicker() {
    setTab("calendar");
    setCalendarPickMode("free_rooms");
    window.history.replaceState(null, "", `/?tab=calendar&property=${activeProperty}&month=${month}`);
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
      pulsePrivacyHaptic();
      window.alert(`Изберете стая/и или ${WHOLE_PROPERTY_LABEL}.`);
      return;
    }
    if (!reservation.checkin) {
      pulsePrivacyHaptic();
      window.alert("Изберете чек-ин дата.");
      return;
    }
    if (reservation.totalAmount && reservation.totalAmount < reservation.depositAmount) {
      pulsePrivacyHaptic();
      window.alert("Общата сума не може да е по-малка от капарото.");
      return;
    }

    const conflict = validateReservationConflict(reservation, reservations);
    if (!conflict.ok) {
      pulsePrivacyHaptic();
      window.alert(conflict.message || "Има застъпване с друга резервация.");
      return;
    }

    try {
      await persist(upsertReservation(data, reservation));
      pulsePrivacyHaptic();
      setModalDraft(null);
    } catch (error) {
      console.error("Reservation save failed", error);
      pulsePrivacyHaptic();
      window.alert(getSaveErrorMessage(error));
      setSync("Записът не беше потвърден в облака");
    }
  }

  async function deleteReservation(id: string) {
    if (!window.confirm("Сигурен ли си, че искаш да изтриеш тази резервация?")) return;
    try {
      try {
        await createBackup(data, "before-delete", user?.email || undefined);
      } catch (backupError) {
        console.warn("Before-delete backup failed; continuing with canonical delete.", backupError);
      }
      const result = await deleteHotelReservation(data, id);
      setData(result.data);
      setSync(result.target === "cloud" ? "Облак: изтрито" : "Записано локално");
      if (result.warnings.length > 0) console.warn("Reservation delete completed with warnings.", result.warnings);
      refreshBackups();
      pulsePrivacyHaptic();
      window.alert("Резервацията е изтрита.");
      setModalDraft(null);
      const loaded = await loadHotelData().catch((refreshError) => {
        console.warn("Reservation delete succeeded, but refresh failed.", refreshError);
        return null;
      });
      if (loaded && !loaded.data.reservations[id]) {
        setData(loaded.data);
        setSync(loaded.source === "cloud" ? "Облак: синхронизирано" : "Локален backup");
      } else if (loaded?.data.reservations[id]) {
        console.warn("Deleted reservation appeared in refresh; keeping local deleted state.", id);
        setSync("Резервацията е изтрита, но обновяването се бави");
      }
    } catch (error) {
      console.error("Reservation delete failed", error);
      pulsePrivacyHaptic();
      window.alert(getDeleteErrorMessage(error));
      const loaded = await loadHotelData().catch(() => null);
      if (loaded) {
        setData(loaded.data);
        setSync(loaded.source === "cloud" ? "Облак: синхронизирано" : "Локален backup");
      }
    }
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

  async function setBookingInventory(propertyId: PropertyId, bookingType: BookingTypeId, startDate: string, endDate: string, inventory: number) {
    const dates = eachNight(startDate, normalizeCheckout(startDate, endDate));
    const nextInventory = { ...(data.bookingOpenInventory || {}) };
    const nextProperty = { ...(nextInventory[propertyId] || {}) };
    const nextTypeDates = { ...(nextProperty[bookingType] || {}) };
    dates.forEach((date) => {
      if (inventory > 0) nextTypeDates[date] = inventory;
      else delete nextTypeDates[date];
    });

    nextProperty[bookingType] = nextTypeDates;
    nextInventory[propertyId] = nextProperty;
    await persist({ ...data, bookingOpenInventory: nextInventory });
  }

  async function ensureBookingFeedTokens() {
    const nextTokens = { ...(data.bookingFeedTokens || {}) };
    let changed = false;
    (Object.keys(BOOKING_ROOM_TYPES) as PropertyId[]).forEach((propertyId) => {
      const propertyTokens = { ...(nextTokens[propertyId] || {}) };
      (Object.keys(BOOKING_ROOM_TYPES[propertyId]) as BookingTypeId[]).forEach((bookingType) => {
        if (!propertyTokens[bookingType]) {
          propertyTokens[bookingType] = createFeedToken();
          changed = true;
        }
      });
      nextTokens[propertyId] = propertyTokens;
    });

    if (changed) {
      await persist({ ...data, bookingFeedTokens: nextTokens });
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
      const response = await fetch("/api/backups/manual", { method: "POST" });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || "Backup-ът не беше създаден.");
      }
      await refreshBackups();
      setBackupStatus("Backup-ът е създаден.");
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Неуспешно създаване на backup.");
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

  if (!user) {
    return <LoginScreen />;
  }

  if (cloudLoading) {
    return <AuthMessage title="Hotel Lidia" text="Зареждане на Firebase данните..." />;
  }

  if (cloudAccessError) {
    return (
      <AuthMessage
        title="Проблем с Firebase достъпа"
        text={`${cloudAccessError} Календарът не е показан, за да не изглежда празен погрешно.`}
      />
    );
  }

  return (
    <main className="mobile-app-shell mx-auto flex min-h-screen max-w-7xl flex-col gap-3 text-ink sm:gap-4">
      {tab === "calendar" && (
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker month={month} tab={tab} propertyId={activeProperty} setMonth={setMonth} />
        </div>
      )}

      <section className="soft-card hidden grid-cols-4 gap-2 rounded-2xl p-2 md:grid">
        <TabButton active={tab === "upcoming"} href={`/?tab=upcoming&property=${activeProperty}`} icon={<Home size={18} />} label="Предстоящи" onClick={() => setTab("upcoming")} />
        <TabButton active={tab === "calendar"} href={`/?tab=calendar&property=${activeProperty}`} icon={<CalendarDays size={18} />} label="Календар" onClick={() => setTab("calendar")} />
        <TabButton active={tab === "transactions"} href={`/?tab=transactions&property=${activeProperty}`} icon={<Euro size={18} />} label="Приходи/Разходи" onClick={() => setTab("transactions")} />
        <TabButton active={tab === "finance"} href={`/?tab=finance&property=${activeProperty}`} icon={<Euro size={18} />} label="Финанси" onClick={() => setTab("finance")} />
      </section>

      {initialDataLoading && <AppSectionSkeleton />}

      {tab === "upcoming" && !initialDataLoading && (
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
          onGuestMemory={openGuestMemory}
          onEstiExport={ENABLE_ESTI_EXPORT ? openEstiExport : undefined}
        />
      )}
      {tab === "upcoming" && !initialDataLoading && (
        <BackupTools
          backups={backups}
          status={backupStatus}
          onCreateBackup={handleManualBackup}
          onRestoreBackup={handleRestoreBackup}
        />
      )}
      {tab === "upcoming" && (
        <header className="soft-card sticky top-2 z-20 rounded-2xl p-3 backdrop-blur sm:p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-black tracking-normal text-ink">Hotel Lidia</h1>
            <span className="inline-flex min-h-8 items-center rounded-full border border-emerald-100 bg-emerald-50 px-3 text-xs font-black text-emerald-800 shadow-sm">
                {sync}
              </span>
            {!online && (
              <span className="inline-flex min-h-8 items-center rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-black text-amber-900 shadow-sm">
                Офлайн режим
              </span>
            )}
          </div>
          <div className="hidden w-full grid-cols-1 gap-2 md:grid md:grid-cols-[auto_auto_auto_auto] lg:w-auto">
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
      )}
      {tab === "calendar" && !initialDataLoading && (
        <div className="grid gap-4">
          <CalendarView
            month={month}
            setMonth={setMonth}
            propertyId={activeProperty}
            data={data}
            reservations={reservations}
            onNew={openNewReservation}
            onEdit={openEditReservation}
            onSetBookingInventory={ENABLE_BOOKING_MODE ? setBookingInventory : undefined}
            onEnsureBookingFeedTokens={ENABLE_BOOKING_MODE ? ensureBookingFeedTokens : undefined}
            initialSelectedDate={initialCalendarDate}
            freeRoomsPickActive={calendarPickMode === "free_rooms"}
            onFreeRoomsDateSelected={() => setCalendarPickMode(null)}
          />
        </div>
      )}
      {tab === "transactions" && !initialDataLoading && <TransactionsView data={data} month={month} setMonth={setMonth} addRow={addFinanceRow} updateRow={updateFinanceRow} removeRow={removeFinanceRow} />}
      {tab === "finance" && !initialDataLoading && <FinanceView data={data} unlocked={financeUnlocked} setUnlocked={setFinanceUnlocked} />}

      <nav className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 gap-1 border-t border-stone-200 bg-cream/95 p-1.5 shadow-2xl backdrop-blur md:hidden">
        <TabButton active={tab === "upcoming"} href={`/?tab=upcoming&property=${activeProperty}`} icon={<Home size={19} />} label="Предстоящи" onClick={() => setTab("upcoming")} compact />
        <TabButton active={tab === "calendar"} href={`/?tab=calendar&property=${activeProperty}`} icon={<CalendarDays size={19} />} label="Календар" onClick={() => setTab("calendar")} compact />
        <TabButton active={tab === "transactions"} href={`/?tab=transactions&property=${activeProperty}`} icon={<Euro size={19} />} label="Приходи/Разходи" onClick={() => setTab("transactions")} compact />
        <TabButton active={tab === "finance"} href={`/?tab=finance&property=${activeProperty}`} icon={<BarChart3 size={19} />} label="Финанси" onClick={() => setTab("finance")} compact />
      </nav>

      {!initialDataLoading && (
        <FloatingAssistant
          data={data}
          month={month}
          currentTab={tab}
          financeUnlocked={financeUnlocked}
          onCreateDraft={(draft) => openNewReservation(draft.propertyId, draft.checkin, (draft.rooms[0] as RoomId | "all") || "", draft)}
          onFreeRoomsRequest={startFreeRoomsPicker}
        />
      )}

      {activeModalDraft && (
        <ReservationModal
          draft={activeModalDraft}
          reservations={reservations}
          setDraft={setModalDraft}
          closeHref={cleanUrl}
          onClose={() => {
            setUrlModalDismissed(true);
            setModalDraft(null);
            window.history.replaceState(null, "", cleanUrl);
          }}
          onSave={saveReservation}
          onDelete={activeModalDraft.id ? deleteReservation : undefined}
          onGuestMemory={openGuestMemory}
        />
      )}
      {guestMemoryTarget && (
        <GuestMemorySheet target={guestMemoryTarget} reservations={reservations} onClose={() => setGuestMemoryTarget(null)} />
      )}
      {ENABLE_ESTI_EXPORT && estiReservation && (
        <EstiExportModal reservation={estiReservation} onClose={() => setEstiReservation(null)} />
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

function createFeedToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function AppSectionSkeleton() {
  return (
    <section className="sheet-panel soft-card max-h-[78dvh] overflow-y-auto rounded-3xl p-4 shadow-2xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="grid flex-1 gap-2">
          <div className="soft-skeleton h-6 w-44 rounded-full" />
          <div className="soft-skeleton h-4 w-64 max-w-full rounded-full" />
        </div>
        <div className="soft-skeleton h-11 w-24 rounded-2xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-3xl border border-stone-100 bg-cream p-4 shadow-sm">
            <div className="soft-skeleton h-5 w-2/3 rounded-full" />
            <div className="soft-skeleton mt-4 h-4 w-full rounded-full" />
            <div className="soft-skeleton mt-2 h-4 w-4/5 rounded-full" />
            <div className="soft-skeleton mt-5 h-11 rounded-2xl" />
          </div>
        ))}
      </div>
    </section>
  );
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
    return shiftMonthKey(month, delta);
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

function shiftMonthKey(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(year, monthNumber - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
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
  onEdit,
  onGuestMemory,
  onEstiExport
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
  onGuestMemory: (reservation: Reservation | ReservationDraft) => void;
  onEstiExport?: (reservation: Reservation) => void;
}) {
  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);
  const weekDates = useMemo(() => getCurrentWeekDays(today), [today]);
  const [weatherByDate, setWeatherByDate] = useState<Record<string, DailyWeather>>({});
  const activeReservations = reservations.filter((reservation) => reservation.status !== "cancelled");
  const todayArrivals = sortOperationalReservations(activeReservations.filter((reservation) => reservation.checkin === today));
  const tomorrowArrivals = sortOperationalReservations(activeReservations.filter((reservation) => reservation.checkin === tomorrow));
  const week = weekDates.map((iso) => {
    const active = activeReservations.filter((reservation) => activeOnDate(reservation.checkin, reservation.checkout, iso));
    const arrivals = activeReservations.filter((reservation) => reservation.checkin === iso);
    const departures = activeReservations.filter((reservation) => reservation.checkout === iso);
    const noDeposit = active.some((reservation) => reservation.depositAmount <= 0);
    return { iso, active, arrivals, departures, noDeposit };
  });

  useEffect(() => {
    let cancelled = false;
    fetchWeeklyWeather(weekDates[0], weekDates[weekDates.length - 1])
      .then((forecast) => {
        if (!cancelled) setWeatherByDate(forecast);
      })
      .catch(() => {
        if (!cancelled) setWeatherByDate({});
      });

    return () => {
      cancelled = true;
    };
  }, [weekDates]);

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
          {process.env.NODE_ENV !== "production" && (
            <Button
              type="button"
              className="tap-target inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-brand-100 bg-white px-4 py-2 text-sm font-black text-brand-800 shadow-sm sm:w-auto"
              onClick={() => onGuestMemory(createDemoGuestMemoryTarget())}
            >
              Demo Guest Memory
            </Button>
          )}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <ArrivalGroup title="Пристигащи днес" empty="Няма пристигащи днес." reservations={todayArrivals} allReservations={activeReservations} onEdit={onEdit} onGuestMemory={onGuestMemory} onEstiExport={onEstiExport} />
          <ArrivalGroup title="Пристигащи утре" empty="Няма пристигащи утре." reservations={tomorrowArrivals} allReservations={activeReservations} onEdit={onEdit} onGuestMemory={onGuestMemory} onEstiExport={onEstiExport} />
        </div>
      </div>
      <section className="soft-card min-w-0 overflow-hidden rounded-3xl p-4">
      <h3 className="mb-3 text-xl font-black text-ink">Тази седмица</h3>
        <div className="-mx-1 flex w-full min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-1 pb-3 [scrollbar-width:thin]">
          {week.map((day) => (
            <article key={day.iso} className="min-w-[78vw] max-w-[20rem] shrink-0 snap-start rounded-3xl border border-stone-200 bg-cream p-4 shadow-sm sm:min-w-[260px] md:min-w-[240px]">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-lg font-black text-ink">{formatDayName(day.iso)}</span>
                    <WeatherIndicator weather={weatherByDate[day.iso]} />
                  </div>
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
        onGuestMemory={onGuestMemory}
        onEstiExport={onEstiExport}
      />
      <FortuneWheelProverb />
    </section>
  );
}

function FortuneWheelProverb() {
  const [open, setOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [selected, setSelected] = useState("");
  const [rotation, setRotation] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const segmentSize = 360 / PROVERBS_OF_THE_DAY.length;
  const wheelColors = ["#dbeafe", "#dcfce7", "#fef3c7", "#ffe4e6", "#ede9fe", "#ccfbf1"];
  const wheelGradient = PROVERBS_OF_THE_DAY.map((_, index) => {
    const color = wheelColors[index % wheelColors.length];
    return `${color} ${index * segmentSize}deg ${(index + 1) * segmentSize}deg`;
  }).join(", ");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(media.matches);
    const onChange = () => setReducedMotion(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function spin() {
    if (spinning) return;
    const index = Math.floor(Math.random() * PROVERBS_OF_THE_DAY.length);
    const proverb = PROVERBS_OF_THE_DAY[index];
    const segmentCenter = index * segmentSize + segmentSize / 2;
    const current = ((rotation % 360) + 360) % 360;
    const target = (360 - segmentCenter + 360) % 360;
    const delta = (target - current + 360) % 360;

    setSelected("");
    if (reducedMotion) {
      setRotation(rotation + delta);
      setSelected(proverb);
      return;
    }

    setSpinning(true);
    setRotation(rotation + 1440 + delta);
    window.setTimeout(() => {
      setSelected(proverb);
      setSpinning(false);
    }, 2400);
  }

  return (
    <section className="soft-card rounded-3xl p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-black text-ink">Поговорка на деня</h3>
          <p className="text-sm font-semibold text-clay">Малко хотелско настроение, когато има нужда от усмивка.</p>
        </div>
        <Button
          type="button"
          className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm font-black text-clay shadow-sm"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? "Скрий" : "Колело на късмета"}
        </Button>
      </div>

      {open && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(14rem,17rem)_minmax(0,1fr)] sm:items-center">
          <div className="mx-auto grid justify-items-center gap-3">
            <div className="relative h-56 w-56 sm:h-64 sm:w-64">
              <div className="absolute left-1/2 top-0 z-10 h-0 w-0 -translate-x-1/2 -translate-y-1 border-x-[9px] border-t-[16px] border-x-transparent border-t-brand-700" />
              <div
                className="h-full w-full rounded-full border-4 border-white shadow-inner ring-1 ring-stone-200 transition-transform duration-[2400ms] ease-out"
                style={{
                  background: `conic-gradient(from -90deg, ${wheelGradient})`,
                  transform: `rotate(${rotation}deg)`,
                  transitionDuration: reducedMotion ? "1ms" : "2400ms"
                }}
                aria-hidden="true"
              />
              <div className="absolute inset-0 m-auto flex h-20 w-20 items-center justify-center rounded-full bg-white text-center text-sm font-black leading-tight text-brand-800 shadow-sm ring-1 ring-stone-200">
                Вили<br />Лидия
              </div>
            </div>
            <Button
              type="button"
              className="tap-target rounded-2xl bg-brand-600 px-5 py-3 font-black text-white shadow-sm disabled:cursor-not-allowed disabled:bg-stone-300"
              onClick={spin}
              disabled={spinning}
            >
              {spinning ? "Върти се..." : "Завърти"}
            </Button>
          </div>

          <div className="mx-auto flex min-h-28 w-full max-w-xl flex-col items-center justify-center rounded-2xl bg-cream px-4 py-3 text-center ring-1 ring-stone-200">
            <div className="text-xs font-black uppercase tracking-wide text-clay">
              Поговорка на деня
            </div>
            <p className="mt-1 max-w-md text-base font-black leading-snug text-ink sm:text-lg">
              {selected || "Натисни „Завърти“ и виж какво ще каже хотелската съдба."}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function ArrivalGroup({ title, empty, reservations, allReservations, onEdit, onGuestMemory, onEstiExport }: { title: string; empty: string; reservations: Reservation[]; allReservations: Reservation[]; onEdit: (reservation: Reservation) => void; onGuestMemory: (reservation: Reservation | ReservationDraft) => void; onEstiExport?: (reservation: Reservation) => void }) {
  return (
    <section>
      <h3 className="mb-3 text-xl font-black text-ink">{title}</h3>
      <div className="grid gap-3">
        {reservations.length === 0 && <p className="rounded-3xl bg-cream p-4 text-base font-semibold text-clay">{empty}</p>}
        {reservations.map((reservation) => (
          <ReservationCard key={reservation.id} reservation={reservation} hasGuestMemory={hasGuestMemoryHistory(reservation, allReservations)} onEdit={onEdit} onGuestMemory={onGuestMemory} onEstiExport={onEstiExport} />
        ))}
      </div>
    </section>
  );
}

function WeatherIndicator({ weather }: { weather?: DailyWeather }) {
  if (!weather?.icon) return null;
  const temperatures = weather.maxTemp !== null && weather.minTemp !== null
    ? `${weather.maxTemp}° / ${weather.minTemp}°`
    : "";

  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-white/75 px-2 py-1 text-xs font-black text-clay ring-1 ring-stone-100">
      <span aria-hidden="true" className="text-sm leading-none">{weather.icon}</span>
      {temperatures && <span>{temperatures}</span>}
    </div>
  );
}

function CalendarWeatherHint({ weather }: { weather?: DailyWeather }) {
  if (!weather?.icon) return <span aria-hidden="true" className="block h-3.5" />;
  const temperature = weather.maxTemp !== null ? `${weather.maxTemp}°` : "";

  return (
    <span className="pointer-events-none inline-flex h-3.5 max-w-full items-center justify-center gap-0.5 overflow-hidden whitespace-nowrap text-[8px] font-bold leading-none text-clay/80 sm:h-4 sm:text-[10px]">
      <span aria-hidden="true" className="text-[9px] sm:text-xs">{weather.icon}</span>
      {temperature && <span>{temperature}</span>}
    </span>
  );
}

const ASSISTANT_PROMPT_POOL = [
  "Как върви този месец?",
  "Кои резервации са без капаро?",
  "Каква е заетостта този уикенд?",
  "Има ли слаби дни скоро?",
  "Какви са приходите за месеца?",
  "Кои гости пристигат утре?",
  "Какви са разходите спрямо приходите?",
  "Кои дни са най-слаби?",
  "Има ли свободни стаи този уикенд?",
  "Какво трябва да следя днес?"
];

function pickAssistantPrompts(count = 4): string[] {
  return [...ASSISTANT_PROMPT_POOL]
    .map((prompt) => ({ prompt, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, count)
    .map((item) => item.prompt);
}

function FloatingAssistant({ data, month, currentTab, financeUnlocked, onCreateDraft, onFreeRoomsRequest }: { data: AppData; month: string; currentTab: Tab; financeUnlocked: boolean; onCreateDraft: (draft: ReservationDraft) => void; onFreeRoomsRequest: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {!open && (
        <Button
          type="button"
          className="tap-target fixed bottom-[calc(5.65rem+var(--app-safe-bottom))] right-[max(0.85rem,var(--app-safe-right))] z-40 inline-flex h-11 w-11 items-center justify-center rounded-full border border-brand-100 bg-white/90 text-brand-700 shadow-lg backdrop-blur transition hover:bg-brand-50 md:bottom-5 md:h-12 md:w-12"
          onClick={() => setOpen(true)}
          aria-label="Отвори Асистент"
        >
          <Bot aria-hidden="true" size={20} />
        </Button>
      )}
      {open && (
        <div className="fixed inset-x-0 bottom-[calc(4.8rem+var(--app-safe-bottom))] z-40 px-3 md:bottom-6 md:left-auto md:right-6 md:w-[min(28rem,calc(100vw-2rem))] md:px-0">
          <HotelAssistantPanel
            data={data}
            month={month}
            currentTab={currentTab}
            financeUnlocked={financeUnlocked}
            onCreateDraft={onCreateDraft}
            onFreeRoomsRequest={onFreeRoomsRequest}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );
}

type AssistantQuickActionId =
  | "new_reservation"
  | "next_guest"
  | "arrivals_today"
  | "arrivals_tomorrow"
  | "no_deposit"
  | "free_rooms"
  | "weekend"
  | "weak_days"
  | "month_compare"
  | "revenue_month"
  | "expenses_month"
  | "occupancy_month"
  | "known_guests";

type AssistantQuickAction = {
  id: AssistantQuickActionId;
  label: string;
  group: "Резервации" | "Свободни стаи" | "Финанси" | "Гости";
};

const ASSISTANT_QUICK_ACTIONS: AssistantQuickAction[] = [
  { id: "new_reservation", label: "+ Нова резервация", group: "Резервации" },
  { id: "next_guest", label: "Следващ гост", group: "Резервации" },
  { id: "arrivals_today", label: "Пристигащи днес", group: "Резервации" },
  { id: "arrivals_tomorrow", label: "Пристигащи утре", group: "Резервации" },
  { id: "no_deposit", label: "Без капаро", group: "Резервации" },
  { id: "free_rooms", label: "Свободни стаи", group: "Свободни стаи" },
  { id: "weekend", label: "Този уикенд", group: "Свободни стаи" },
  { id: "weak_days", label: "Слаби дни", group: "Свободни стаи" },
  { id: "month_compare", label: "Май vs Април", group: "Финанси" },
  { id: "revenue_month", label: "Приходи този месец", group: "Финанси" },
  { id: "expenses_month", label: "Разходи този месец", group: "Финанси" },
  { id: "occupancy_month", label: "Заетост", group: "Финанси" },
  { id: "known_guests", label: "Познати гости", group: "Гости" }
];

export function HotelAssistant({ data, month, currentTab, financeUnlocked, onCreateDraft, onClose }: { data: AppData; month: string; currentTab: Tab; financeUnlocked: boolean; onCreateDraft: (draft: ReservationDraft) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [readAloud, setReadAloud] = useState(false);
  const [hasBulgarianVoice, setHasBulgarianVoice] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const prompts = useMemo(() => pickAssistantPrompts(), []);
  void currentTab;

  function askAssistant(nextQuery: string) {
    const cleanQuery = nextQuery.trim();
    if (!cleanQuery) return;
    debugClick("assistant ask");
    setQuery(cleanQuery);
    const routed = routeAssistantQuery(cleanQuery, data, month, financeUnlocked);
    logAssistantRoute(routed);
    setAnswer(routed.answer);
    if (routed.intent === "reservation_shortcut" && routed.confidence === "high") {
      onCreateDraft(createReservationDraft("villa", todayISO()));
      onClose();
    }
  }

  function runQuickAction(actionId: AssistantQuickActionId) {
    debugClick("assistant quick action " + actionId);
    setVoiceError("");
    setInterimTranscript("");
    stopAssistantSpeech();

    if (actionId === "new_reservation") {
      setQuery("+ Нова резервация");
      setAnswer("Отварям нова резервация.");
      onCreateDraft(createReservationDraft("villa", todayISO()));
      onClose();
      return;
    }

    const answerByAction: Record<Exclude<AssistantQuickActionId, "new_reservation">, string> = {
      next_guest: buildNextGuestAssistantAnswer(data),
      arrivals_today: buildArrivalsForDateAssistantAnswer(data, todayISO(), "днес"),
      arrivals_tomorrow: buildArrivalsForDateAssistantAnswer(data, addDaysISO(todayISO(), 1), "утре"),
      no_deposit: buildNoDepositAssistantAnswer(data, month),
      free_rooms: "За коя дата?",
      weekend: buildWeekendStatusAssistantAnswer(data),
      weak_days: buildLowOccupancyAssistantAnswer(data, month),
      month_compare: buildActiveMonthVsPreviousAnswer(data, month, financeUnlocked),
      revenue_month: buildFinanceSummaryAssistantAnswer(data, month, financeUnlocked, "приходи"),
      expenses_month: buildFinanceSummaryAssistantAnswer(data, month, financeUnlocked, "разходи"),
      occupancy_month: buildOccupancyAssistantAnswer(data, month),
      known_guests: buildKnownGuestsAssistantAnswer(data)
    };

    const nextAnswer = answerByAction[actionId];
    setQuery(ASSISTANT_QUICK_ACTIONS.find((action) => action.id === actionId)?.label || "");
    setAnswer(nextAnswer);
  }
  void runQuickAction;

  function clearAssistant() {
    setQuery("");
    setAnswer("");
    setInterimTranscript("");
    setVoiceError("");
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    stopAssistantSpeech();
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (!value.trim()) {
      setAnswer("");
      setVoiceError("");
      stopAssistantSpeech();
    }
  }

  useEffect(() => {
    setVoiceSupported(Boolean(getSpeechRecognitionConstructor()));
    function syncVoicePreference() {
      const hasBgVoice = Boolean(getBulgarianVoice({ strict: true }));
      setHasBulgarianVoice(hasBgVoice);
      const saved = window.localStorage.getItem("hotel-lidia-assistant-read-aloud");
      if (saved !== null) {
        setReadAloud(saved === "true");
      } else {
        setReadAloud(hasBgVoice);
      }
    }

    syncVoicePreference();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", syncVoicePreference);
    }
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setListening(false);
      if ("speechSynthesis" in window) {
        window.speechSynthesis.removeEventListener("voiceschanged", syncVoicePreference);
      }
      stopAssistantSpeech();
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("hotel-lidia-assistant-read-aloud", String(readAloud));
    if (!readAloud) stopAssistantSpeech();
  }, [readAloud]);

  useEffect(() => {
    if (!answer || !readAloud) return;
    speakAssistantResponse(answer);
  }, [answer, readAloud]);

  useEffect(() => {
    if (query.trim()) return;
    setAnswer("");
    setVoiceError("");
    stopAssistantSpeech();
  }, [query]);

  function toggleAssistantListening() {
    if (listening) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setListening(false);
      setInterimTranscript("");
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setVoiceError("Гласово въвеждане не се поддържа на това устройство.");
      return;
    }

    recognitionRef.current?.stop();
    const recognition = new Recognition();
    recognition.lang = "bg-BG";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const speechResult = event.results[event.resultIndex] as ArrayLike<{ transcript: string }> & { isFinal?: boolean };
      const result = speechResult?.[0]?.transcript || "";
      const clean = result.trim();
      setInterimTranscript(clean);
      if (clean) setQuery(clean);
      setVoiceError("");
      if (clean && speechResult?.isFinal !== false) {
        askAssistant(clean);
      }
    };
    recognition.onerror = () => {
      setVoiceError("Слушането спря. Натисни „Слушай„, за да опиташ пак.");
      setListening(false);
      setInterimTranscript("");
    };
    recognition.onend = () => {
      setListening(false);
      setInterimTranscript("");
    };
    recognitionRef.current = recognition;
    setListening(true);
    setInterimTranscript("");
    setVoiceError("");
    recognition.start();
  }
  return (
    <section className="sheet-panel soft-card max-h-[78dvh] overflow-y-auto rounded-3xl p-4 shadow-2xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xl font-black text-ink">Асистент</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" className={`tap-target inline-flex h-9 w-9 items-center justify-center rounded-full ring-1 ${readAloud ? "bg-emerald-50 text-emerald-800 ring-emerald-100" : "bg-white text-clay ring-stone-200"}`} onClick={() => setReadAloud((value) => !value)} aria-label="Четене на глас" aria-pressed={readAloud} title="Четене на глас">
            {readAloud ? <Volume2 aria-hidden="true" size={16} /> : <VolumeX aria-hidden="true" size={16} />}
          </Button>
          <Button type="button" className="tap-target inline-flex items-center justify-center rounded-full border border-stone-200 bg-white p-2 text-clay shadow-sm" onClick={() => {
            recognitionRef.current?.stop();
            recognitionRef.current = null;
            setListening(false);
            setInterimTranscript("");
            stopAssistantSpeech();
            onClose();
          }} aria-label="Затвори Асистент">
            <X aria-hidden="true" size={18} />
          </Button>
        </div>
      </div>
      {!hasBulgarianVoice && (
        <p className="mt-2 text-xs font-semibold text-clay">Гласът може да звучи неестествено на това устройство.</p>
      )}

      <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2">
        <input
          className="tap-target min-w-0 flex-1 rounded-2xl border border-stone-200 bg-white px-4 text-base font-semibold text-ink outline-none focus:ring-2 focus:ring-brand-100"
          placeholder="Попитай: Как върви май?"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          onInput={(event) => handleQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") askAssistant(query);
          }}
        />
        {voiceSupported && (
          <Button
            type="button"
            className={`tap-target inline-flex h-12 min-w-[5.5rem] items-center justify-center gap-1 rounded-2xl border px-3 text-sm font-black shadow-sm ${listening ? "border-rose-200 bg-rose-50 text-rose-700 motion-safe:animate-pulse" : "border-emerald-200 bg-white text-emerald-800"}`}
            onClick={toggleAssistantListening}
            aria-label={listening ? "Спри слушането" : "Слушай"}
            aria-pressed={listening}
          >
            <Mic aria-hidden="true" size={17} />
            <span>{listening ? "Слушам…" : "Слушай"}</span>
          </Button>
        )}        <Button type="button" className="tap-target inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 font-black text-white shadow-sm" onClick={() => askAssistant(query || prompts[0])} aria-label="Попитай">
          <Send aria-hidden="true" size={18} />
        </Button>
      </div>
      {interimTranscript && listening && <p className="mt-2 rounded-2xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900">Чувам: {interimTranscript}</p>}
      {voiceError && <p className="mt-2 text-sm font-bold text-rose-700">{voiceError}</p>}
      {(query || answer) && (
        <Button type="button" className="tap-target mt-2 rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm font-black text-clay shadow-sm" onClick={clearAssistant}>
          Изчисти
        </Button>
      )}

      <div className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1">
        {prompts.map((prompt) => (
          <Button
            key={prompt}
            type="button"
            className="tap-target shrink-0 snap-start rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-black text-clay shadow-sm"
            onClick={() => askAssistant(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>

      {answer && (
        <div className="mt-4 whitespace-pre-line rounded-3xl bg-cream p-4 text-base font-semibold leading-relaxed text-stone-800 ring-1 ring-stone-200">
          {answer}
        </div>
      )}
    </section>
  );
}

function HotelAssistantPanel({ data, month, currentTab, financeUnlocked, onCreateDraft, onFreeRoomsRequest, onClose }: { data: AppData; month: string; currentTab: Tab; financeUnlocked: boolean; onCreateDraft: (draft: ReservationDraft) => void; onFreeRoomsRequest: () => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [readAloud, setReadAloud] = useState(false);
  const [hasBulgarianVoice, setHasBulgarianVoice] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const quickActionGroups = useMemo(() => getAssistantQuickActionGroups(currentTab), [currentTab]);

  function askAssistant(nextQuery: string) {
    const cleanQuery = nextQuery.trim();
    if (!cleanQuery) return;
    debugClick("assistant ask");
    setQuery(cleanQuery);
    const routed = routeAssistantQuery(cleanQuery, data, month, financeUnlocked);
    logAssistantRoute(routed);
    setAnswer(routed.answer);
    if (routed.intent === "reservation_shortcut" && routed.confidence === "high") {
      onCreateDraft(createReservationDraft("villa", todayISO()));
      onClose();
    }
  }

  function runQuickAction(actionId: AssistantQuickActionId) {
    debugClick("assistant quick action " + actionId);
    setVoiceError("");
    setInterimTranscript("");
    stopAssistantSpeech();

    if (actionId === "new_reservation") {
      setQuery("+ Нова резервация");
      setAnswer("Отварям нова резервация.");
      onCreateDraft(createReservationDraft("villa", todayISO()));
      onClose();
      return;
    }

    const answerByAction: Record<Exclude<AssistantQuickActionId, "new_reservation">, string> = {
      next_guest: buildNextGuestAssistantAnswer(data),
      arrivals_today: buildArrivalsForDateAssistantAnswer(data, todayISO(), "днес"),
      arrivals_tomorrow: buildArrivalsForDateAssistantAnswer(data, addDaysISO(todayISO(), 1), "утре"),
      no_deposit: buildNoDepositAssistantAnswer(data, month),
      free_rooms: "За коя дата?",
      weekend: buildWeekendStatusAssistantAnswer(data),
      weak_days: buildLowOccupancyAssistantAnswer(data, month),
      month_compare: buildActiveMonthVsPreviousAnswer(data, month, financeUnlocked),
      revenue_month: buildFinanceSummaryAssistantAnswer(data, month, financeUnlocked, "приходи"),
      expenses_month: buildFinanceSummaryAssistantAnswer(data, month, financeUnlocked, "разходи"),
      occupancy_month: buildOccupancyAssistantAnswer(data, month),
      known_guests: buildKnownGuestsAssistantAnswer(data)
    };

    const action = ASSISTANT_QUICK_ACTIONS.find((item) => item.id === actionId);
    setQuery(action?.label || "");
    if (actionId === "free_rooms") {
      setAnswer("Отварям календара. Избери дата, за да видиш свободните стаи.");
      onFreeRoomsRequest();
      onClose();
      return;
    }
    setAnswer(answerByAction[actionId]);
  }

  function clearAssistant() {
    setQuery("");
    setAnswer("");
    setInterimTranscript("");
    setVoiceError("");
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    stopAssistantSpeech();
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (!value.trim()) {
      setAnswer("");
      setVoiceError("");
      stopAssistantSpeech();
    }
  }

  useEffect(() => {
    setVoiceSupported(Boolean(getSpeechRecognitionConstructor()));
    function syncVoicePreference() {
      const hasBgVoice = Boolean(getBulgarianVoice({ strict: true }));
      setHasBulgarianVoice(hasBgVoice);
      const saved = window.localStorage.getItem("hotel-lidia-assistant-read-aloud");
      setReadAloud(saved !== null ? saved === "true" : hasBgVoice);
    }

    syncVoicePreference();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", syncVoicePreference);
    }
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setListening(false);
      if ("speechSynthesis" in window) {
        window.speechSynthesis.removeEventListener("voiceschanged", syncVoicePreference);
      }
      stopAssistantSpeech();
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("hotel-lidia-assistant-read-aloud", String(readAloud));
    if (!readAloud) stopAssistantSpeech();
  }, [readAloud]);

  useEffect(() => {
    if (!answer || !readAloud) return;
    speakAssistantResponse(answer);
  }, [answer, readAloud]);

  function toggleAssistantListening() {
    if (listening) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setListening(false);
      setInterimTranscript("");
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setVoiceError("Гласово въвеждане не се поддържа на това устройство.");
      return;
    }

    recognitionRef.current?.stop();
    const recognition = new Recognition();
    recognition.lang = "bg-BG";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const speechResult = event.results[event.resultIndex] as ArrayLike<{ transcript: string }> & { isFinal?: boolean };
      const result = speechResult?.[0]?.transcript || "";
      const clean = result.trim();
      setInterimTranscript(clean);
      if (clean) setQuery(clean);
      setVoiceError("");
      if (clean && speechResult?.isFinal !== false) {
        askAssistant(clean);
      }
    };
    recognition.onerror = () => {
      setVoiceError("Слушането спря. Натисни микрофона, за да опиташ пак.");
      setListening(false);
      setInterimTranscript("");
    };
    recognition.onend = () => {
      setListening(false);
      setInterimTranscript("");
    };
    recognitionRef.current = recognition;
    setListening(true);
    setInterimTranscript("");
    setVoiceError("");
    recognition.start();
  }

  return (
    <section className="sheet-panel soft-card flex max-h-[82dvh] flex-col overflow-hidden rounded-3xl p-0 shadow-2xl">
      <div className="flex shrink-0 flex-col gap-3 border-b border-stone-100 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xl font-black text-ink">Асистент</h3>
          <p className="mt-0.5 text-sm font-semibold text-clay">Бързи действия и справки</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" className={`tap-target inline-flex h-9 w-9 items-center justify-center rounded-full ring-1 ${readAloud ? "bg-emerald-50 text-emerald-800 ring-emerald-100" : "bg-white text-clay ring-stone-200"}`} onClick={() => setReadAloud((value) => !value)} aria-label="Четене на глас" aria-pressed={readAloud} title="Четене на глас">
            {readAloud ? <Volume2 aria-hidden="true" size={16} /> : <VolumeX aria-hidden="true" size={16} />}
          </Button>
          <Button type="button" className="tap-target inline-flex items-center justify-center rounded-full border border-stone-200 bg-white p-2 text-clay shadow-sm" onClick={() => {
            recognitionRef.current?.stop();
            recognitionRef.current = null;
            setListening(false);
            setInterimTranscript("");
            stopAssistantSpeech();
            onClose();
          }} aria-label="Затвори Асистент">
            <X aria-hidden="true" size={18} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!hasBulgarianVoice && (
          <p className="mb-3 text-xs font-semibold text-clay">Гласът може да звучи неестествено на това устройство.</p>
        )}

        <div className="grid gap-3">
          {quickActionGroups.map((group) => (
            <div key={group.title}>
              <div className="mb-1.5 text-xs font-black uppercase tracking-wide text-clay">{group.title}</div>
              <div className="flex flex-wrap gap-2">
                {group.actions.map((action) => (
                  <Button
                    key={action.id}
                    type="button"
                    className={`tap-target rounded-full border px-3 py-2 text-sm font-black shadow-sm transition hover:-translate-y-0.5 ${getAssistantActionClass(action.group)}`}
                    onClick={() => runQuickAction(action.id)}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {answer && (
          <div className="mt-4 whitespace-pre-line rounded-3xl bg-cream p-4 text-base font-semibold leading-relaxed text-stone-800 ring-1 ring-stone-200">
            {answer}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-stone-100 bg-white/75 p-3 backdrop-blur">
        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          <input
            className="tap-target min-w-0 flex-1 rounded-2xl border border-stone-200 bg-white px-4 text-base font-semibold text-ink outline-none focus:ring-2 focus:ring-brand-100"
            placeholder="Попитай или избери действие..."
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            onInput={(event) => handleQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") askAssistant(query);
            }}
          />
          {voiceSupported && (
            <Button
              type="button"
              className={`tap-target inline-flex h-12 w-12 items-center justify-center rounded-2xl border text-sm font-black shadow-sm ${listening ? "border-rose-200 bg-rose-50 text-rose-700 motion-safe:animate-pulse" : "border-emerald-200 bg-white text-emerald-800"}`}
              onClick={toggleAssistantListening}
              aria-label={listening ? "Спри слушането" : "Слушай"}
              aria-pressed={listening}
            >
              <Mic aria-hidden="true" size={17} />
            </Button>
          )}
          <Button type="button" className="tap-target inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 font-black text-white shadow-sm" onClick={() => askAssistant(query)} aria-label="Попитай">
            <Send aria-hidden="true" size={18} />
          </Button>
        </div>
        {interimTranscript && listening && <p className="mt-2 rounded-2xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900">Чувам: {interimTranscript}</p>}
        {voiceError && <p className="mt-2 text-sm font-bold text-rose-700">{voiceError}</p>}
        {(query || answer) && (
          <Button type="button" className="tap-target mt-2 rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm font-black text-clay shadow-sm" onClick={clearAssistant}>
            Изчисти
          </Button>
        )}
      </div>
    </section>
  );
}

function getAssistantQuickActionGroups(currentTab: Tab): Array<{ title: string; actions: AssistantQuickAction[] }> {
  const priorityByTab: Record<Tab, AssistantQuickAction["group"][]> = {
    upcoming: ["Резервации", "Свободни стаи", "Финанси", "Гости"],
    calendar: ["Свободни стаи", "Резервации", "Гости", "Финанси"],
    transactions: ["Финанси", "Резервации", "Свободни стаи", "Гости"],
    finance: ["Финанси", "Резервации", "Свободни стаи", "Гости"]
  };
  return priorityByTab[currentTab].map((title) => ({
    title,
    actions: ASSISTANT_QUICK_ACTIONS.filter((action) => action.group === title)
  })).filter((group) => group.actions.length > 0);
}

function getAssistantActionClass(group: AssistantQuickAction["group"]): string {
  if (group === "Резервации") return "border-brand-100 bg-brand-50/70 text-brand-800";
  if (group === "Свободни стаи") return "border-emerald-100 bg-emerald-50/70 text-emerald-800";
  if (group === "Финанси") return "border-amber-100 bg-amber-50/80 text-amber-900";
  return "border-stone-200 bg-white text-clay";
}

function buildActiveMonthVsPreviousAnswer(data: AppData, activeMonth: string, financeUnlocked: boolean): string {
  const currentMonthNumber = Number(activeMonth.slice(5, 7));
  const previousMonth = shiftMonthKey(activeMonth, -1);
  const previousMonthNumber = Number(previousMonth.slice(5, 7));
  const year = Number(activeMonth.slice(0, 4)) || new Date().getFullYear();
  return buildMonthComparisonAnswer(data, currentMonthNumber, previousMonthNumber, year, "all", financeUnlocked);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildKnownGuestsAssistantAnswerLegacy(data: AppData): string {
  const reservations = Object.values(data.reservations)
    .filter((reservation) => reservation.status !== "cancelled")
    .sort((a, b) => b.checkin.localeCompare(a.checkin));
  const known = reservations.filter((reservation) => hasGuestMemoryHistory(reservation, reservations));
  const unique = new Map<string, Reservation>();
  known.forEach((reservation) => {
    const key = normalizePhoneDigits(reservation.phone).slice(-9) || normalizeGuestText(reservation.guestName);
    if (key && !unique.has(key)) unique.set(key, reservation);
  });
  const rows = Array.from(unique.values()).slice(0, 6);
  if (!rows.length) return "Няма открити познати гости в текущите данни.";
  return [
    `Познати гости: ${unique.size}`,
    ...rows.map((reservation) => `- ${reservation.guestName || "Без име"} · ${propertyName(reservation.propertyId)} · ${roomsLabel(reservation)}`)
  ].join("\n");
}

function buildKnownGuestsAssistantAnswer(data: AppData): string {
  const reservations = Object.values(data.reservations)
    .filter((reservation) => reservation.status !== "cancelled")
    .sort((a, b) => b.checkin.localeCompare(a.checkin));
  const known = reservations.filter((reservation) => hasGuestMemoryHistory(reservation, reservations));
  const unique = new Map<string, Reservation[]>();

  known.forEach((reservation) => {
    const key = getGuestMemoryGroupKey(reservation);
    if (!key) return;
    unique.set(key, [...(unique.get(key) || []), reservation]);
  });

  const rows = Array.from(unique.values())
    .map((items) => pickKnownGuestRepresentative(items))
    .filter((reservation): reservation is Reservation => Boolean(reservation))
    .slice(0, 6);

  if (!rows.length) return "Няма открити познати гости в текущите данни.";

  return [
    `Познати гости: ${unique.size}`,
    ...rows.map((reservation) => formatKnownGuestAssistantLine(reservation, reservations))
  ].join("\n");
}

function getGuestMemoryGroupKey(reservation: ReservationDraft): string {
  const phone = normalizePhoneDigits(reservation.phone).slice(-9);
  if (phone) return "phone:" + phone;
  const name = normalizeGuestText(reservation.guestName);
  return name.length >= 3 ? "name:" + name : "";
}

function pickKnownGuestRepresentative(reservations: Reservation[]): Reservation | null {
  if (!reservations.length) return null;
  const today = todayISO();
  const upcoming = reservations
    .filter((reservation) => reservation.checkout >= today)
    .sort((a, b) => a.checkin.localeCompare(b.checkin));
  if (upcoming[0]) return upcoming[0];
  return [...reservations].sort((a, b) => b.checkin.localeCompare(a.checkin))[0] || null;
}

function formatKnownGuestAssistantLine(reservation: Reservation, allReservations: Reservation[]): string {
  const today = todayISO();
  const timingLabel = reservation.checkout >= today ? "Следва" : "Последно";
  const memory = buildGuestMemorySummary(findGuestMemoryMatches(reservation, allReservations));
  const tags = memory?.smartTags.slice(0, 3).map((tag) => tag.label).join(", ");
  const smartLine = memory?.smartSummary || tags;
  return [
    `- ${reservation.guestName || "Без име"} · ${timingLabel}: ${formatReservationDateRangeWithNights(reservation)}`,
    `  ${propertyName(reservation.propertyId)} · ${roomsLabel(reservation)}`,
    smartLine ? `  Smart: ${smartLine}` : ""
  ].filter(Boolean).join("\n");
}

function ReservationCard({ reservation, hasGuestMemory, onEdit, onGuestMemory, onEstiExport }: { reservation: Reservation; hasGuestMemory: boolean; onEdit: (reservation: Reservation) => void; onGuestMemory: (reservation: Reservation | ReservationDraft) => void; onEstiExport?: (reservation: Reservation) => void }) {
  return (
    <article className="rounded-3xl border border-stone-200 bg-cream p-5 text-left shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {hasGuestMemory ? (
            <Button type="button" className="tap-target -ml-2 rounded-2xl px-2 text-left text-xl font-black text-ink underline-offset-4 hover:underline" onClick={() => onGuestMemory(reservation)}>
              {reservation.guestName || "Без име"}
            </Button>
          ) : (
            <div className="text-xl font-black text-ink">{reservation.guestName || "Без име"}</div>
          )}
          <div className="mt-1 text-base font-bold text-clay">{formatReservationDateRangeWithNights(reservation)}</div>
          <div className="mt-1 text-base font-medium text-clay">{propertyName(reservation.propertyId)} · {roomsLabel(reservation)}</div>
        </div>
        <span className={"w-fit rounded-full px-3 py-1 text-xs font-black " + (reservation.depositAmount > 0 ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900")}>
          {reservation.depositAmount > 0 ? "Има капаро" : "Без капаро"}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-base font-semibold text-stone-700 sm:grid-cols-[1fr_auto_auto] sm:items-center">
        <span><PhoneLink phone={reservation.phone} onGuestMemory={hasGuestMemory ? () => onGuestMemory(reservation) : undefined} showGuestMemoryState /></span>
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <span className="flex min-h-[4.25rem] flex-col items-center justify-center rounded-2xl bg-white px-3 py-2 text-center shadow-sm ring-1 ring-stone-200 sm:min-w-28">
            <span className="block text-center text-xs font-black uppercase leading-tight text-clay">Общо</span>
            <span className="mt-1 block text-center text-lg font-black leading-none text-ink sm:text-base">{eur(reservation.totalAmount)}</span>
          </span>
          <span className="flex min-h-[4.25rem] flex-col items-center justify-center rounded-2xl bg-white px-3 py-2 text-center shadow-sm ring-1 ring-stone-200 sm:min-w-28">
            <span className="block text-center text-xs font-black uppercase leading-tight text-clay">Остатък</span>
            <span className="mt-1 block text-center text-lg font-black leading-none text-rose-800 sm:text-base">{eur(reservationBalance(reservation))}</span>
          </span>
        </div>
      </div>
      {reservation.notes && <p className="mt-3 text-base font-medium text-clay">{reservation.notes}</p>}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <a href={`/?tab=upcoming&property=${reservation.propertyId}&edit=${reservation.id}`} className="tap-target inline-flex w-full items-center justify-center rounded-2xl bg-brand-600 px-4 py-3 text-base font-black text-white shadow-sm sm:w-auto" onClick={(event) => {
          event.preventDefault();
          debugClick("edit upcoming reservation");
          onEdit(reservation);
        }}>Редакция</a>
        {onEstiExport && (
          <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base font-black text-clay shadow-sm" onClick={(event) => {
            event.stopPropagation();
            debugClick("esti export upcoming reservation");
            onEstiExport(reservation);
          }}>
            ЕСТИ
          </Button>
        )}
      </div>
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
        <div className="modal-backdrop fixed inset-0 z-50 flex items-end bg-stone-950/45 p-0 sm:items-center sm:justify-center sm:p-4">
          <div className="sheet-panel w-full rounded-t-3xl bg-cream p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl">
            <div className="sheet-handle sm:hidden" />
            <h3 className="text-xl font-black text-rose-800">вљ  Това ще презапише текущите данни.</h3>
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

function CalendarView({
  month,
  setMonth,
  propertyId,
  data,
  reservations,
  onNew,
  onEdit,
  onSetBookingInventory,
  onEnsureBookingFeedTokens,
  initialSelectedDate,
  freeRoomsPickActive = false,
  onFreeRoomsDateSelected
}: {
  month: string;
  setMonth: (value: string) => void;
  propertyId: PropertyId;
  data: AppData;
  reservations: Reservation[];
  onNew: (propertyId: PropertyId, isoDate: string, room?: RoomId | "all") => void;
  onEdit: (reservation: Reservation) => void;
  onSetBookingInventory?: (propertyId: PropertyId, bookingType: BookingTypeId, startDate: string, endDate: string, inventory: number) => Promise<void>;
  onEnsureBookingFeedTokens?: () => Promise<void>;
  initialSelectedDate?: string;
  freeRoomsPickActive?: boolean;
  onFreeRoomsDateSelected?: (date: string) => void;
}) {
  void data;
  void onSetBookingInventory;
  void onEnsureBookingFeedTokens;

  const [year, monthNumber] = month.split("-").map(Number);
  const [openHolidayDate, setOpenHolidayDate] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialSelectedDate || null);
  const [weatherByDate, setWeatherByDate] = useState<Record<string, DailyWeather>>({});
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const today = todayISO();
  const days = new Date(year, monthNumber, 0).getDate();
  const firstOffset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const visibleReservations = reservations.filter((reservation) => overlapsMonth(reservation.checkin, reservation.checkout, month));
  const holidayIdeas = useMemo(() => getMonthHolidayIdeas(month), [month]);
  const [holidayIdeaIndex, setHolidayIdeaIndex] = useState(0);
  const activeHolidayInfo = openHolidayDate ? getBulgarianHolidayInfo(openHolidayDate) : null;
  const carouselHolidayInfo = holidayIdeas[holidayIdeaIndex] || activeHolidayInfo;

  useEffect(() => {
    setHolidayIdeaIndex(0);
  }, [month, holidayIdeas.length]);

  useEffect(() => {
    if (holidayIdeas.length <= 1) return;

    const timer = window.setInterval(() => {
      setHolidayIdeaIndex((index) => (index + 1) % holidayIdeas.length);
    }, 5000);

    return () => window.clearInterval(timer);
  }, [holidayIdeas.length]);

  useEffect(() => {
    let cancelled = false;
    const calendarStart = `${month}-01`;
    const calendarEnd = `${month}-${String(days).padStart(2, "0")}`;
    fetchCalendarWeather(calendarStart, calendarEnd)
      .then((forecast) => {
        if (!cancelled) setWeatherByDate(forecast);
      })
      .catch(() => {
        if (!cancelled) setWeatherByDate({});
      });

    return () => {
      cancelled = true;
    };
  }, [days, month]);

  function changeCalendarMonth(delta: number) {
    const nextMonth = shiftMonthKey(month, delta);
    debugClick(delta > 0 ? "swipe next month" : "swipe previous month");
    window.history.replaceState(null, "", `/?tab=calendar&property=${propertyId}&month=${nextMonth}`);
    setSelectedDate(null);
    setMonth(nextMonth);
  }

  function handleCalendarTouchEnd(event: TouchEvent<HTMLElement>) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || event.changedTouches.length !== 1) return;
    if ((event.target as HTMLElement).closest("[data-calendar-grid]")) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 70 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;

    changeCalendarMonth(deltaX < 0 ? 1 : -1);
  }

  return (
    <section
      className="soft-card rounded-3xl p-3 sm:p-4"
      onTouchStart={(event) => {
        if (event.touches.length === 1) {
          touchStartRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        }
      }}
      onTouchCancel={() => {
        touchStartRef.current = null;
      }}
      onTouchEnd={handleCalendarTouchEnd}
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-ink sm:text-2xl">Календар</h2>
          <p className="text-sm font-medium text-clay">Общ преглед за Вила Лидия и Къща Лидия. Натисни дата, за да видиш стаите.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-clay">
          <Legend color="bg-emerald-100 border-emerald-300" label="свободно" />
          <Legend color="bg-amber-100 border-amber-300" label="частично заето" />
          <Legend color="bg-rose-200 border-rose-400" label="изцяло заето" />
          <Legend color="bg-slate-500 border-slate-600" label="стая свободна" />
          <Legend color="bg-emerald-500 border-emerald-600" label="има капаро" />
          <Legend color="bg-rose-500 border-rose-600" label="без капаро" />
        </div>
      </div>

      <HolidayInfoBar holiday={carouselHolidayInfo} index={holidayIdeas.length ? holidayIdeaIndex + 1 : undefined} total={holidayIdeas.length || undefined} />

      {freeRoomsPickActive && (
        <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-900 shadow-sm">
          Избери дата от календара, за да видиш свободните стаи.
        </div>
      )}

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black text-slate-500 sm:text-xs">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map((dayName) => <div key={dayName}>{dayName}</div>)}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1 sm:gap-2" data-calendar-grid>
        {Array.from({ length: firstOffset }).map((_, index) => <div className="h-[98px] rounded-2xl bg-stone-50/70 sm:h-[128px]" key={`empty-${index}`} />)}
        {Array.from({ length: days }).map((_, index) => {
          const day = index + 1;
          const iso = `${month}-${String(day).padStart(2, "0")}`;
          const date = new Date(year, monthNumber - 1, day);
          const weekdayIndex = date.getDay();
          const weekday = BG_WEEKDAYS_LONG[weekdayIndex];
          const holiday = getBulgarianHolidayInfo(iso);
          const occupancy = getCombinedDayOccupancy(visibleReservations, iso);
          const propertyOccupancies = getPropertyDayOccupancies(visibleReservations, iso);
          const bothPropertiesFree = propertyOccupancies.every((item) => item.occupied === 0);
          const tone = getOccupancyTone(occupancy.occupied, occupancy.total);
          const isWeekend = weekdayIndex === 5 || weekdayIndex === 6;
          const isSelected = selectedDate === iso;
          const isToday = today === iso;
          const weather = weatherByDate[iso];

          return (
            <a
              key={iso}
              href={`/?tab=calendar&property=${propertyId}&month=${month}&day=${iso}`}
              className={`tap-target relative grid h-[98px] min-w-0 grid-rows-[14px_minmax(0,1fr)_30px] overflow-hidden rounded-2xl border px-1.5 pb-1 pt-1.5 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow sm:h-[128px] sm:grid-rows-[16px_minmax(0,1fr)_36px] sm:px-2 sm:pb-1.5 sm:pt-2 ${tone.className} ${isWeekend ? "ring-1 ring-amber-200/70" : ""} ${holiday ? "outline outline-1 outline-sky-200" : ""} ${isToday ? "ring-2 ring-brand-500 ring-offset-1 ring-offset-white shadow-md" : ""} ${isSelected ? "ring-2 ring-brand-600" : ""}`}
              title={getHolidayTooltipText(holiday)}
              onMouseEnter={() => {
                if (holiday) setOpenHolidayDate(iso);
              }}
              onFocus={() => {
                if (holiday) setOpenHolidayDate(iso);
              }}
              onClick={(event) => {
                event.preventDefault();
                debugClick("calendar open day detail");
                window.history.replaceState(null, "", `/?tab=calendar&property=${propertyId}&month=${month}&day=${iso}`);
                setSelectedDate(iso);
                if (freeRoomsPickActive) onFreeRoomsDateSelected?.(iso);
                if (holiday) setOpenHolidayDate(iso);
              }}
            >
              {bothPropertiesFree && (
                <span className={`pointer-events-none absolute right-1 z-10 h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.14)] sm:right-1.5 sm:top-1.5 ${isToday ? "top-5 sm:top-6" : "top-1"}`} aria-label="И двата обекта са свободни" />
              )}
              <div className="flex min-w-0 items-start justify-between gap-0.5 overflow-hidden">
                <CalendarWeatherHint weather={weather} />
                {isToday && (
                  <span className="pointer-events-none inline-flex h-3.5 shrink-0 items-center rounded-full bg-brand-600 px-1 text-[7px] font-black leading-none text-white shadow-sm sm:h-4 sm:px-1.5 sm:text-[9px]">
                    Днес
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-col items-center justify-start px-0.5 pt-0.5">
                <span className="block w-full truncate text-[9px] font-bold leading-none text-ink sm:text-[11px]">{weekday}</span>
                <span className="mt-1 block text-[18px] font-black leading-none text-ink sm:text-[26px]">{day}</span>
                <span className={`mt-0.5 block h-3 w-full truncate text-[8px] font-bold leading-3 text-sky-900 sm:h-4 sm:text-[10px] ${holiday ? "" : "opacity-0"}`}>
                  {holiday?.holidayName || "."}
                </span>
              </div>
              <RoomAvailabilitySegments reservations={visibleReservations} date={iso} />
            </a>
          );
        })}
      </div>

      {selectedDate && (
        <DayDetailPanel
          date={selectedDate}
          reservations={reservations}
          onClose={() => setSelectedDate(null)}
          onNew={(nextPropertyId, room) => {
            setSelectedDate(null);
            onNew(nextPropertyId, selectedDate, room);
          }}
          onEdit={(reservation) => {
            setSelectedDate(null);
            onEdit(reservation);
          }}
        />
      )}
    </section>
  );
}

function DayDetailPanel({
  date,
  reservations,
  onClose,
  onNew,
  onEdit
}: {
  date: string;
  reservations: Reservation[];
  onClose: () => void;
  onNew: (propertyId: PropertyId, room?: RoomId | "all") => void;
  onEdit: (reservation: Reservation) => void;
}) {
  const holiday = getBulgarianHolidayInfo(date);
  const dayReservations = reservations.filter((reservation) => activeOnDate(reservation.checkin, reservation.checkout, date));

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-end bg-stone-950/35 p-0 sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <section className="sheet-panel max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-cream p-4 shadow-2xl sm:max-w-3xl sm:rounded-3xl sm:p-5" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle sm:hidden" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-2xl font-black text-ink">{formatDayDetailTitle(date)}</h3>
            <p className="text-sm font-semibold text-clay">Вила Лидия и Къща Лидия</p>
            {holiday && <p className="mt-1 rounded-2xl bg-sky-50 px-3 py-2 text-sm font-bold text-sky-900">{holiday.holidayName}</p>}
          </div>
          <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-2 font-black text-clay shadow-sm" onClick={onClose}>
            Затвори
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {PROPERTIES.map((property) => (
            <PropertyDayRooms
              key={property.id}
              property={property}
              date={date}
              reservations={dayReservations.filter((reservation) => reservation.propertyId === property.id)}
              onNew={onNew}
              onEdit={onEdit}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function PropertyDayRooms({
  property,
  date,
  reservations,
  onNew,
  onEdit
}: {
  property: (typeof PROPERTIES)[number];
  date: string;
  reservations: Reservation[];
  onNew: (propertyId: PropertyId, room?: RoomId | "all") => void;
  onEdit: (reservation: Reservation) => void;
}) {
  const wholeReservation = reservations.find((reservation) => reservation.rooms.includes("all"));
  const occupiedCount = wholeReservation ? property.rooms.length : occupiedRooms(reservations);

  return (
    <article className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xl font-black text-ink">{property.name}</h4>
          <p className="text-sm font-bold text-clay">{occupiedCount}/{property.rooms.length} заети</p>
        </div>
        <DayRoomAction
          label={WHOLE_PROPERTY_LABEL}
          reservation={wholeReservation}
          href={wholeReservation ? `/?tab=calendar&property=${property.id}&edit=${wholeReservation.id}` : `/?tab=calendar&property=${property.id}&new=1&date=${date}&room=all`}
          whole
          onNew={() => onNew(property.id, "all")}
          onEdit={onEdit}
        />
      </div>

      {wholeReservation && (
        <button type="button" className={`mb-3 w-full rounded-2xl border px-3 py-3 text-left text-sm font-black ${wholeReservation.depositAmount > 0 ? "border-emerald-300 bg-emerald-100 text-emerald-950" : "border-rose-300 bg-rose-100 text-rose-950"}`} onClick={() => onEdit(wholeReservation)}>
          {WHOLE_PROPERTY_LABEL}: {wholeReservation.guestName || "Без име"}
        </button>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {property.rooms.map((room) => {
          const reservation = wholeReservation || reservations.find((item) => item.rooms.map(String).includes(room));
          return (
            <DayRoomAction
              key={room}
              label={"Стая " + room}
              reservation={reservation}
              href={reservation ? `/?tab=calendar&property=${property.id}&edit=${reservation.id}` : `/?tab=calendar&property=${property.id}&new=1&date=${date}&room=${room}`}
              onNew={() => onNew(property.id, room)}
              onEdit={onEdit}
            />
          );
        })}
      </div>
    </article>
  );
}

function DayRoomAction({
  label,
  reservation,
  href,
  whole,
  onNew,
  onEdit
}: {
  label: string;
  reservation?: Reservation;
  href: string;
  whole?: boolean;
  onNew: () => void;
  onEdit: (reservation: Reservation) => void;
}) {
  const busy = Boolean(reservation);
  const color = busy
    ? reservation?.depositAmount
      ? "border-emerald-300 bg-emerald-100 text-emerald-950"
      : "border-rose-300 bg-rose-100 text-rose-950"
    : whole
      ? "border-red-200 bg-white text-red-700"
      : "border-stone-200 bg-cream text-stone-800";

  return (
    <a
      href={href}
      className={`tap-target flex min-h-14 flex-col justify-center rounded-2xl border px-3 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow ${color}`}
      title={reservation ? `${reservation.guestName || "Без име"} ${reservation.checkin} - ${reservation.checkout}` : "Свободно"}
      onClick={(event) => {
        event.preventDefault();
        debugClick(reservation ? "calendar day detail edit" : "calendar day detail new");
        window.history.replaceState(null, "", href);
        if (reservation) onEdit(reservation);
        else onNew();
      }}
    >
      <span className="text-base font-black leading-tight">{label}</span>
      <span className="mt-1 text-xs font-bold leading-tight opacity-80">
        {reservation ? (reservation.guestName || "Заето") : "Свободно"}
      </span>
    </a>
  );
}

// Kept behind ENABLE_BOOKING_MODE for later Booking.com testing.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function BookingCalendarBar({
  propertyId,
  data,
  showFeeds,
  setShowFeeds,
  onEnsureBookingFeedTokens
}: {
  propertyId: PropertyId;
  data: AppData;
  showFeeds: boolean;
  setShowFeeds: (value: boolean) => void;
  onEnsureBookingFeedTokens: () => Promise<void>;
}) {
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const hasAllTokens = (Object.keys(BOOKING_ROOM_TYPES[propertyId]) as BookingTypeId[])
    .every((bookingType) => Boolean(data.bookingFeedTokens?.[propertyId]?.[bookingType]));

  return (
    <div className="mb-3 rounded-2xl border border-sky-100 bg-sky-50/70 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-black text-sky-950">Booking от календара</h3>
          <p className="text-sm font-semibold text-clay">Натисни SPA/Balcony в деня. Свободните бройки се смятат автоматично от резервациите.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!hasAllTokens && (
            <Button type="button" className="tap-target rounded-xl bg-sky-700 px-3 py-2 font-black text-white" onClick={onEnsureBookingFeedTokens}>
              Създай feed линкове
            </Button>
          )}
          <Button type="button" className="tap-target rounded-xl border border-sky-200 bg-white px-3 py-2 font-black text-sky-900" onClick={() => setShowFeeds(!showFeeds)}>
            {showFeeds ? "Скрий feed" : "Feed линкове"}
          </Button>
        </div>
      </div>
      {showFeeds && (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {(Object.keys(BOOKING_ROOM_TYPES[propertyId]) as BookingTypeId[]).map((bookingType) => {
            const token = data.bookingFeedTokens?.[propertyId]?.[bookingType];
            const feedUrl = token && origin ? `${origin}/api/ical/${propertyId}/${bookingType}?token=${token}` : "";
            return (
              <div key={bookingType} className="rounded-xl bg-white p-2 text-xs font-semibold text-clay">
                <div className="font-black text-ink">{BOOKING_TYPE_LABELS[bookingType]}</div>
                {feedUrl ? (
                  <div className="mt-1 flex flex-col gap-2">
                    <span className="break-all">{feedUrl}</span>
                    <Button type="button" className="tap-target rounded-xl border border-stone-200 bg-white px-3 py-2 font-black text-clay" onClick={() => navigator.clipboard?.writeText(feedUrl).catch(() => undefined)}>
                      Копирай
                    </Button>
                  </div>
                ) : (
                  <span>Няма token още.</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function BookingDayControls({
  data,
  propertyId,
  date,
  onSelect
}: {
  data: AppData;
  propertyId: PropertyId;
  date: string;
  onSelect: (bookingType: BookingTypeId, inventory: number) => void;
}) {
  return (
    <div className="mb-1 grid gap-1">
      {(Object.keys(BOOKING_ROOM_TYPES[propertyId]) as BookingTypeId[]).map((bookingType) => {
        const result = getSafeBookingInventory(data, propertyId, bookingType, date);
        return (
          <div key={bookingType} className="rounded-lg border border-sky-100 bg-white/80 p-1">
            <div className="mb-1 flex items-center justify-between gap-1">
              <span className="truncate text-[9px] font-black text-sky-950 sm:text-[10px]">{BOOKING_TYPE_LABELS[bookingType]}</span>
              <span className="text-[9px] font-black text-clay sm:text-[10px]">{result.safeInventory}/{result.physicallyFreeInventory}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: result.physicallyFreeInventory + 1 }, (_, inventory) => (
                <Button
                  key={inventory}
                  type="button"
                  className={`min-h-6 min-w-6 rounded-md px-1 text-[10px] font-black sm:min-h-7 sm:min-w-7 ${inventory === result.openedInventory ? "bg-sky-700 text-white" : "border border-sky-100 bg-white text-sky-900"}`}
                  title={`Booking ${BOOKING_TYPE_LABELS[bookingType]}: ${inventory}`}
                  onClick={() => onSelect(bookingType, inventory)}
                >
                  {inventory}
                </Button>
              ))}
            </div>
            {result.openedInventory > result.safeInventory && (
              <p className="mt-1 text-[9px] font-black text-rose-700">има резервация</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function BookingInventoryConfirmModal({
  propertyId,
  action,
  data,
  onCancel,
  onConfirm
}: {
  propertyId: PropertyId;
  action: { bookingType: BookingTypeId; date: string; inventory: number };
  data: AppData;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const property = PROPERTIES.find((item) => item.id === propertyId) || PROPERTIES[0];
  const result = getSafeBookingInventory(data, propertyId, action.bookingType, action.date);
  const finalSafe = Math.min(action.inventory, result.physicallyFreeInventory);

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-end bg-stone-950/45 sm:items-center sm:justify-center">
      <div className="sheet-panel w-full rounded-t-3xl bg-cream p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <div className="sheet-handle sm:hidden" />
        <h3 className="text-xl font-black text-ink">Сигурен ли си?</h3>
        <p className="mt-2 text-base font-semibold text-clay">
          {action.inventory > 0
            ? "Отваряш част от свободния остатък за Booking.com. Ако бъде добавена резервация, Booking автоматично ще се блокира."
            : "Затваряш този тип за Booking.com за избрания ден."}
        </p>
        <div className="mt-4 rounded-2xl bg-white p-4 text-sm font-bold text-stone-700">
          <div>{property.name}</div>
          <div>{BOOKING_TYPE_LABELS[action.bookingType]}</div>
          <div>{action.date}</div>
          <div>Физически свободни: {result.physicallyFreeInventory}</div>
          <div>Ще отвориш: {action.inventory}</div>
          <div>Безопасно към Booking: {finalSafe}</div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-3 font-black text-clay" onClick={onCancel}>
            Отказ
          </Button>
          <Button type="button" className="tap-target rounded-2xl bg-brand-600 px-4 py-3 font-black text-white" onClick={() => void onConfirm()}>
            {action.inventory > 0 ? "Отвори за Booking" : "Затвори за Booking"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function HolidayInfoBar({ holiday, index, total }: { holiday: BulgarianHolidayInfo | null; index?: number; total?: number }) {
  return (
    <div className="my-2 min-h-[44px] rounded-2xl border border-sky-100 bg-sky-50/70 px-3 py-2 text-sm font-semibold text-clay">
      {holiday ? (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p>
            <span className="font-black text-sky-900">{formatHolidayDate(holiday.date)} - {holiday.holidayName}</span>
            {holiday.leaveIdeaText && <span> · Идея за отпуск: {holiday.leaveIdeaText}</span>}
          </p>
          {index && total && total > 1 && (
            <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-xs font-black text-sky-800 ring-1 ring-sky-100">
              {index}/{total}
            </span>
          )}
        </div>
      ) : (
        <p className="text-sky-900/70">Няма идеи за отпуск за този месец.</p>
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

function ReservationsView({ month, propertyId, reservations, query, setQuery, filter, setFilter, onNew, onEdit, onGuestMemory, onEstiExport }: { month: string; propertyId: PropertyId; reservations: Reservation[]; query: string; setQuery: (value: string) => void; filter: ListFilter; setFilter: (value: ListFilter) => void; onNew: () => void; onEdit: (reservation: Reservation) => void; onGuestMemory: (reservation: Reservation | ReservationDraft) => void; onEstiExport?: (reservation: Reservation) => void }) {
  const today = todayISO();
  const property = PROPERTIES.find((item) => item.id === propertyId) || PROPERTIES[0];
  const [roomFilter, setRoomFilter] = useState<RoomId | "all" | "">("");
  const [isExpanded, setIsExpanded] = useState(false);
  const filterItems: Array<[ListFilter, string]> = [["all", "Всички"], ["today", "Днес"], ["next7", "7 дни"], ["month", "Месец"], ["noDeposit", "Без капаро"], ["history", "История"]];
  const roomItems: Array<[RoomId | "all" | "", string]> = [["", "Всички стаи"], ...property.rooms.map((room): [RoomId, string] => [room, "Стая " + room]), ["all", WHOLE_PROPERTY_LABEL]];
  const activeCount = reservations.filter((reservation) => reservation.propertyId === propertyId && reservation.checkout > today).length;
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
    if (filter === "history") return hasGuestMemoryHistory(reservation, reservations);
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
          <p className="text-base font-medium text-clay">{property.name} · {activeCount} активни резервации</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="button" className="tap-target min-h-11 rounded-2xl border border-stone-200 bg-white px-5 py-3 text-base font-black text-clay shadow-sm" onClick={() => setIsExpanded((value) => !value)}>
            {isExpanded ? "Скрий" : "Покажи"}
          </Button>
          <a href={`/?tab=upcoming&property=${propertyId}&new=1`} className="tap-target hidden min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-3 text-base font-black text-white shadow-sm md:inline-flex" onClick={(event) => {
            event.preventDefault();
            debugClick("new reservation reservations tab");
            onNew();
          }}>
            <Plus size={19} /> Нова резервация
          </a>
        </div>
      </div>
      {!isExpanded ? (
        <p className="rounded-3xl bg-cream p-4 text-base font-semibold text-clay">{activeCount} активни резервации</p>
      ) : (
        <>
          <div className="mb-4 grid gap-3 md:hidden">
            {filterControls}
            {roomControls}
            {searchBox}
          </div>
          <div className="mb-4 hidden grid-cols-1 gap-3 md:grid">{searchBox}{filterControls}{roomControls}</div>
          <div className="grid gap-3">
            {filtered.length === 0 && <p className="rounded-3xl bg-cream p-5 text-base font-semibold text-clay">{filter === "history" ? "Няма гости с предишна история." : "Няма резервации за този филтър."}</p>}
          {filtered.map((reservation) => (
            <article key={reservation.id} className="rounded-3xl border border-stone-200 bg-cream p-5 text-left shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    {hasGuestMemoryHistory(reservation, reservations) ? (
                      <Button type="button" className="tap-target -ml-2 rounded-2xl px-2 text-left text-xl font-black text-ink underline-offset-4 hover:underline" onClick={() => onGuestMemory(reservation)}>
                        {reservation.guestName || "Без име"}
                      </Button>
                    ) : (
                      <div className="text-xl font-black text-ink">{reservation.guestName || "Без име"}</div>
                    )}
                    <div className="mt-1 text-base font-bold text-clay">{formatReservationDateRangeWithNights(reservation)}</div>
                    <div className="mt-1 text-base font-medium text-clay">{propertyName(reservation.propertyId)} · {roomsLabel(reservation)}</div>
                  </div>
                  <span className={"w-fit rounded-full px-3 py-1.5 text-sm font-black " + (reservation.depositAmount > 0 ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900")}>
                    {reservation.depositAmount > 0 ? "Има капаро" : "Без капаро"}
                  </span>
                </div>
                <div className="mt-4 grid gap-2 text-base font-semibold text-stone-700 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <span><PhoneLink phone={reservation.phone} onGuestMemory={hasGuestMemoryHistory(reservation, reservations) ? () => onGuestMemory(reservation) : undefined} showGuestMemoryState /></span>
                  <div className="grid grid-cols-2 gap-2 md:contents">
                    <span className="flex min-h-[4.25rem] flex-col items-center justify-center rounded-2xl bg-white px-3 py-2 text-center shadow-sm ring-1 ring-stone-200 md:min-w-28">
                      <span className="block text-center text-xs font-black uppercase leading-tight text-clay">Общо</span>
                      <span className="mt-1 block text-center text-lg font-black leading-none text-ink md:text-base">{eur(reservation.totalAmount)}</span>
                    </span>
                    <span className="flex min-h-[4.25rem] flex-col items-center justify-center rounded-2xl bg-white px-3 py-2 text-center shadow-sm ring-1 ring-stone-200 md:min-w-28">
                      <span className="block text-center text-xs font-black uppercase leading-tight text-clay">Остатък</span>
                      <span className="mt-1 block text-center text-lg font-black leading-none text-rose-800 md:text-base">{eur(reservationBalance(reservation))}</span>
                    </span>
                  </div>
                </div>
                {reservation.notes && <p className="mt-3 text-base font-medium text-clay">{reservation.notes}</p>}
                <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
                  <a href={`/?tab=upcoming&property=${reservation.propertyId}&edit=${reservation.id}`} className="tap-target inline-flex w-full items-center justify-center rounded-2xl bg-brand-600 px-5 py-3 text-base font-black text-white shadow-sm md:w-auto" onClick={(event) => {
                    event.preventDefault();
                    debugClick("edit reservation");
                    onEdit(reservation);
                  }}>Редакция</a>
                  {onEstiExport && (
                    <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base font-black text-clay shadow-sm" onClick={(event) => {
                      event.stopPropagation();
                      debugClick("esti export reservation list");
                      onEstiExport(reservation);
                    }}>
                      ЕСТИ
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
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
        <label className="flex w-full flex-col gap-2 rounded-2xl bg-cream p-3 text-sm font-black text-clay ring-1 ring-stone-200 sm:w-auto sm:min-w-56">
          <span>Месец</span>
          <input className="tap-target w-full rounded-2xl border border-stone-200 bg-white px-3 font-bold text-ink outline-none focus:ring-2 focus:ring-brand-100" type="month" value={month} onInput={(event) => setMonth(event.currentTarget.value)} onChange={(event) => setMonth(event.target.value)} />
        </label>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="flex min-h-28 flex-col items-center justify-center rounded-3xl bg-cream p-4 text-center ring-1 ring-stone-200">
          <div className="text-sm font-bold leading-tight text-clay">Ръчни приходи за месеца</div>
          <div className="mt-3 text-2xl font-black leading-none text-emerald-800">{eurWhole(incomeTotal)}</div>
        </div>
        <div className="flex min-h-28 flex-col items-center justify-center rounded-3xl bg-cream p-4 text-center ring-1 ring-stone-200">
          <div className="text-sm font-bold leading-tight text-clay">Разходи за месеца</div>
          <div className="mt-3 text-2xl font-black leading-none text-rose-700">{eurWhole(expenseTotal)}</div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <FinancePanel title="Ръчни приходи" kind="income" types={incomeTypes} rows={incomes} addRow={addRow} updateRow={updateRow} removeRow={removeRow} />
        <FinancePanel title="Разходи" kind="expense" types={expenseTypes} rows={expenses} addRow={addRow} updateRow={updateRow} removeRow={removeRow} />
      </div>
    </section>
  );
}

function FinanceView({ data, unlocked, setUnlocked }: { data: AppData; unlocked: boolean; setUnlocked: (value: boolean) => void }) {
  const [selectedMonth, setSelectedMonth] = useState(monthKey(todayISO()));
  const [showSummary, setShowSummary] = useState(false);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const kpis = calculateFinanceSummary(data, selectedMonth);
  const ratioLabel = formatExpenseRatio(kpis);
  const occupancyPercent = calculateOccupancyPercent(data, selectedMonth);
  const financeInsights = useMemo(() => buildMonthlyFinanceInsights(data, selectedMonth), [data, selectedMonth]);
  const [insightIndex, setInsightIndex] = useState(0);

  useEffect(() => {
    setInsightIndex(0);
  }, [selectedMonth, financeInsights.length]);

  useEffect(() => {
    if (financeInsights.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setInsightIndex((value) => (value + 1) % financeInsights.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [financeInsights.length]);

  function togglePrivacy() {
    if (unlocked) {
      pulsePrivacyHaptic();
      setUnlocked(false);
      return;
    }

    setConfirmUnlock(true);
  }

  function revealFinanceValues() {
    pulsePrivacyHaptic();
    setUnlocked(true);
    setConfirmUnlock(false);
  }

  return (
    <section className="soft-card relative rounded-3xl p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="inline-flex items-center gap-2 text-2xl font-black text-ink">
          <LockKeyhole aria-hidden="true" className={`h-5 w-5 ${unlocked ? "text-emerald-700" : "text-clay"}`} />
          Финанси
        </h2>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <label className="inline-flex min-h-11 flex-1 items-center gap-2 rounded-full border border-stone-200 bg-white/80 px-3 text-sm font-black text-clay shadow-sm sm:flex-none">
            <span className="sr-only">Месец</span>
            <input className="min-w-0 flex-1 border-0 bg-transparent text-sm font-black text-ink outline-none sm:w-36" type="month" value={selectedMonth} onInput={(event) => setSelectedMonth(event.currentTarget.value)} onChange={(event) => setSelectedMonth(event.target.value)} />
          </label>
          <Button type="button" className="tap-target inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-stone-200 bg-white/70 px-3 text-sm font-black text-clay shadow-sm transition hover:bg-cream sm:px-4" onClick={togglePrivacy} aria-pressed={unlocked}>
            {unlocked ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
            <span className="hidden min-[380px]:inline sm:inline">{unlocked ? "Скрий" : "Покажи"}</span>
          </Button>
        </div>
      </div>      <div className={`transition duration-300 ${unlocked ? "opacity-100" : "opacity-85 blur-[0.6px]"}`}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Общи Приходи" value={getFinanceRevenue(kpis)} revealed={unlocked} />
          <Kpi label="Разходи" value={kpis.expenses} danger revealed={unlocked} />
          <Kpi label="Нетно" value={kpis.net} revealed={unlocked} />
          <KpiText label="Разходи / Приходи" value={ratioLabel} danger={kpis.expenses > 0} revealed={unlocked} mask="**%" />
          <OccupancyKpi value={occupancyPercent} revealed={unlocked} />
        </div>
        <FinanceInsightCarousel insights={financeInsights} activeIndex={insightIndex} revealed={unlocked} />
        <MonthlyFinanceChart data={data} month={selectedMonth} revealed={unlocked} />
        <div className="mt-4">
          <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-2 font-black text-clay shadow-sm" onClick={() => setShowSummary((value) => !value)}>
            {showSummary ? "Скрий обобщение" : "Покажи обобщение"}
          </Button>
        </div>
        {showSummary && <FinanceSummaryTable data={data} selectedMonth={selectedMonth} revealed={unlocked} />}
      </div>
      {confirmUnlock && <FinancePrivacyPrompt onCancel={() => setConfirmUnlock(false)} onReveal={revealFinanceValues} />}
    </section>
  );
}

function FinanceInsightCarousel({ insights, activeIndex, revealed }: { insights: string[]; activeIndex: number; revealed: boolean }) {
  if (!insights.length) return null;
  const activeInsight = insights[activeIndex] || insights[0];
  const tone = getFinanceInsightTone(activeInsight);

  return (
    <div className={`mt-4 rounded-3xl border p-4 text-sm font-bold shadow-sm transition ${revealed ? tone.className : "border-sky-100 bg-sky-50/70 text-sky-950"}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="leading-relaxed">
          {revealed ? activeInsight : "Отключи Финанси, за да видиш месечните обобщения."}
        </p>
        {revealed && insights.length > 1 && (
          <span className={`shrink-0 rounded-full bg-white/80 px-2 py-1 text-xs font-black ring-1 ${tone.badgeClassName}`}>
            {activeIndex + 1}/{insights.length}
          </span>
        )}
      </div>
    </div>
  );
}

function MonthlyFinanceChart({ data, month, revealed }: { data: AppData; month: string; revealed: boolean }) {
  const kpis = calculateFinanceSummary(data, month);
  const expenseRatio = getExpenseRatio(kpis);
  const ratioAxisMax = Math.max(100, Math.ceil((expenseRatio || 0) / 25) * 25);
  const ratioTop = expenseRatio === null ? null : `${100 - Math.min(expenseRatio, ratioAxisMax) / ratioAxisMax * 100}%`;
  const rows = [
    { label: "Общи Приходи", value: getFinanceRevenue(kpis), color: "bg-orange-500" },
    { label: "Разходи", value: kpis.expenses, color: "bg-red-600" },
    { label: "Нетно", value: kpis.net, color: "bg-emerald-600" }
  ];
  const maxValue = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  const guideValues = [maxValue, maxValue * 0.75, maxValue * 0.5, maxValue * 0.25, 0];

  return (
    <div className="mt-4 rounded-3xl bg-cream p-4 ring-1 ring-stone-200">
      <h3 className="mb-4 text-lg font-black text-ink">Месечен резултат · {formatMonthLabel(month)}</h3>
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[560px] grid-cols-[70px_1fr_54px] gap-3">
          <div className="flex h-72 flex-col justify-between text-right text-xs font-bold text-clay">
            {guideValues.map((value) => <span key={value}><FinanceValue text={eurWhole(value)} revealed={revealed} /></span>)}
          </div>
          <div className="relative flex h-72 items-end justify-around gap-5 border-b border-l border-stone-300 px-4">
            {revealed && ratioTop && expenseRatio !== null && (
              <div className="pointer-events-none absolute left-3 right-3 z-10 border-t-4 border-sky-600" style={{ top: ratioTop }}>
                <span className="absolute -top-7 right-0 rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-sky-800 ring-1 ring-sky-200">
                  Разходи/Приходи {formatPercent(expenseRatio)}
                </span>
              </div>
            )}
            {rows.map((row) => {
              const height = revealed ? Math.max(row.value === 0 ? 0 : 10, (Math.abs(row.value) / maxValue) * 250) : 92;
              return (
                <div key={row.label} className="flex min-w-[120px] flex-col items-center justify-end gap-2">
                  <span className="whitespace-nowrap text-xs font-black text-clay"><FinanceValue text={eurWhole(row.value)} revealed={revealed} /></span>
                  <div className={`w-14 rounded-t-md transition duration-300 ${revealed ? row.color : "bg-stone-300"} ${revealed && row.value < 0 ? "opacity-70" : ""}`} style={{ height }} title={revealed ? `${row.label}: ${eurWhole(row.value)}` : undefined} />
                  <span className="min-h-10 text-center text-xs font-black text-clay">{row.label}</span>
                </div>
              );
            })}
          </div>
          <div className="flex h-72 flex-col justify-between text-xs font-bold text-sky-800">
            <span><FinanceValue text={`${ratioAxisMax}%`} revealed={revealed} mask="**%" /></span>
            <span><FinanceValue text={`${Math.round(ratioAxisMax * 0.75)}%`} revealed={revealed} mask="**%" /></span>
            <span><FinanceValue text={`${Math.round(ratioAxisMax * 0.5)}%`} revealed={revealed} mask="**%" /></span>
            <span><FinanceValue text={`${Math.round(ratioAxisMax * 0.25)}%`} revealed={revealed} mask="**%" /></span>
            <span><FinanceValue text="0%" revealed={revealed} mask="**%" /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FinanceSummaryTable({ data, selectedMonth, revealed }: { data: AppData; selectedMonth: string; revealed: boolean }) {
  const months = getFinanceMonths(data, selectedMonth);
  return (
    <div className="mt-4 rounded-3xl bg-cream p-4 ring-1 ring-stone-200">
      <h3 className="mb-4 text-lg font-black text-ink">Обобщение по месеци</h3>
      <div className="overflow-x-auto">
        <table className="min-w-[520px] w-full border-separate border-spacing-y-2 text-left text-sm">
          <thead className="text-clay">
            <tr>
              <th className="px-3 py-2">Месец</th>
              <th className="px-3 py-2">Общи Приходи</th>
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
                  <td className="px-3 py-3 font-bold"><FinanceValue text={eurWhole(getFinanceRevenue(row))} revealed={revealed} /></td>
                  <td className="px-3 py-3 font-bold text-red-700"><FinanceValue text={eurWhole(row.expenses)} revealed={revealed} /></td>
                  <td className="rounded-r-2xl px-3 py-3 font-black"><FinanceValue text={eurWhole(row.net)} revealed={revealed} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <YearToDateFinanceChart data={data} months={months} selectedMonth={selectedMonth} revealed={revealed} />
    </div>
  );
}

function YearToDateFinanceChart({ data, months, selectedMonth, revealed }: { data: AppData; months: string[]; selectedMonth: string; revealed: boolean }) {
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
    { label: "Общи Приходи", value: getFinanceRevenue(totals), color: "bg-orange-500" },
    { label: "Разходи", value: totals.expenses, color: "bg-red-600" },
    { label: "Нетно", value: totals.net, color: totals.net < 0 ? "bg-rose-700" : "bg-emerald-600" },
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
          <div className="flex min-w-[460px] items-end justify-around gap-5 border-b border-stone-300 px-4 pt-4">
            {chartRows.map((row) => {
              const height = revealed ? Math.max(row.value === 0 ? 0 : 12, (Math.abs(row.value) / maxValue) * 220) : 88;
              return (
                <div key={row.label} className="flex min-w-[100px] flex-col items-center justify-end gap-2">
                  <span className="whitespace-nowrap text-xs font-black text-clay"><FinanceValue text={eurWhole(row.value)} revealed={revealed} /></span>
                  <div className={`w-16 rounded-t-md transition duration-300 ${revealed ? row.color : "bg-stone-300"} ${revealed && row.value < 0 ? "rounded-b-md rounded-t-none opacity-80" : ""}`} style={{ height }} title={revealed ? `${row.label}: ${eurWhole(row.value)}` : undefined} />
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

function ReservationModal({ draft, reservations, setDraft, closeHref, onClose, onSave, onDelete, onGuestMemory }: { draft: ReservationDraft; reservations: Reservation[]; setDraft: (draft: ReservationDraft | null) => void; closeHref: string; onClose: () => void; onSave: (draft: ReservationDraft) => void; onDelete?: (id: string) => void; onGuestMemory: (reservation: Reservation | ReservationDraft) => void }) {
  const property = PROPERTIES.find((item) => item.id === draft.propertyId) || PROPERTIES[0];
  const guestMemory = useMemo(() => buildGuestMemorySummary(findGuestMemoryMatches(draft, reservations)), [draft, reservations]);

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

  function changeReservationProperty(nextPropertyId: PropertyId) {
    if (nextPropertyId === draft.propertyId) return;
    debugClick("modal property " + nextPropertyId);
    setDraft({ ...draft, propertyId: nextPropertyId, rooms: [] });
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-[70] flex items-end bg-stone-950/45 sm:items-center sm:justify-center">
      <form className="sheet-panel max-h-[92vh] w-full overflow-auto rounded-t-3xl bg-cream p-3 shadow-2xl sm:max-w-2xl sm:rounded-3xl sm:p-4" onSubmit={(event) => {
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        event.preventDefault();
        debugClick(submitter?.value === "delete" ? "reservation delete submit" : "reservation save submit");
        if (submitter?.value === "delete" && draft.id && onDelete) {
          onDelete(draft.id);
          return;
        }
        onSave(draft);
      }}>
        <div className="sheet-handle sm:hidden" />
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
        <FormSection title="Обект">
          <div className="grid gap-2 sm:grid-cols-2">
            {PROPERTIES.map((item) => (
              <Button
                type="button"
                key={item.id}
                className={`tap-target rounded-2xl border px-4 py-3 text-base font-black shadow-sm ${draft.propertyId === item.id ? "border-brand-700 bg-brand-600 text-white" : "border-stone-200 bg-white text-stone-700"}`}
                onClick={() => changeReservationProperty(item.id)}
              >
                {item.name}
              </Button>
            ))}
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
        {guestMemory && <GuestMemoryCard summary={guestMemory} onOpenProfile={() => onGuestMemory(draft)} />}
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
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-clay">Свободен текст към резервацията</span>
            <NotesVoiceButton draft={draft} setDraft={setDraft} />
          </div>
          <textarea className="mt-1 min-h-20 w-full rounded-2xl border border-stone-200 bg-white p-3 outline-none focus:ring-2 focus:ring-brand-100 sm:min-h-24" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
        </FormSection>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {draft.id && onDelete && <Button type="submit" name="action" value="delete" className="tap-target rounded-2xl border border-red-200 bg-white px-4 py-2 font-black text-red-600" formNoValidate onClick={() => {
            debugClick("reservation delete click");
          }}>Изтрий</Button>}
          <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-2 font-black text-clay" onClick={clearReservationForm}>Изчисти</Button>
          <Button type="submit" className="tap-target rounded-2xl bg-brand-600 px-5 py-3 font-black text-white shadow-sm sm:min-w-40" onClick={() => debugClick("reservation save click")}>Запази</Button>
        </div>
      </form>
    </div>
  );
}

function NotesVoiceButton({ draft, setDraft }: { draft: ReservationDraft; setDraft: (draft: ReservationDraft | null) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognitionConstructor()));
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  if (!supported) return null;

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setError("Гласовото въвеждане не се поддържа на това устройство.");
      return;
    }

    recognitionRef.current?.stop();
    const recognition = new Recognition();
    recognition.lang = "bg-BG";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const result = event.results[event.resultIndex]?.[0]?.transcript || "";
      const clean = result.trim();
      if (clean) {
        setDraft({ ...draft, notes: draft.notes ? `${draft.notes}\n${clean}` : clean });
      }
      setError("");
    };
    recognition.onerror = () => {
      setError("Не успях да разпозная гласа. Опитай пак или попълни ръчно.");
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    setError("");
    recognition.start();
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs font-bold text-rose-700">{error}</span>}
      <Button
        type="button"
        className={`tap-target inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-sm ${listening ? "border-rose-200 bg-rose-50 text-rose-700" : "border-stone-200 bg-white text-clay"}`}
        onClick={toggleListening}
        aria-label="Гласови бележки"
        title="Гласови бележки"
      >
        <Mic aria-hidden="true" size={17} />
      </Button>
    </div>
  );
}

type GuestMemoryConfidence = "high" | "medium" | "low";

type GuestMemoryMatch = {
  reservation: Reservation;
  score: number;
  confidence: GuestMemoryConfidence;
  reasons: string[];
};

type GuestMemorySummary = {
  matches: GuestMemoryMatch[];
  confidence: GuestMemoryConfidence;
  previousStays: number;
  lastStay: Reservation;
  totalRevenue: number;
  notes: string[];
  roomHistory: string[];
  depositPattern: string;
  smartTags: GuestSmartTag[];
  smartSummary: string;
};

type GuestSmartTagTier = 1 | 2 | 3;

type GuestSmartTag = {
  id: string;
  label: string;
  tier: GuestSmartTagTier;
  priority: number;
  reason: string;
};

type GuestKeywordStats = {
  family: number;
  fishing: number;
  bbq: number;
  pet: number;
  late: number;
  occasion: number;
  recentFamily: boolean;
};

function GuestMemoryCard({ summary, onOpenProfile }: { summary: GuestMemorySummary; onOpenProfile: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const confidenceLabel = summary.confidence === "high" ? "Познат гост" : "Възможно съвпадение";

  return (
    <section className="mt-3 rounded-3xl border border-brand-100 bg-brand-50/70 p-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-base font-black text-ink">{confidenceLabel}</div>
          <div className="mt-1 text-sm font-bold text-clay">
            Идвал е {summary.previousStays} {summary.previousStays === 1 ? "път" : "пъти"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="tap-target rounded-2xl bg-brand-600 px-4 py-2 text-sm font-black text-white shadow-sm" onClick={onOpenProfile}>
            Профил
          </Button>
          <Button type="button" className="tap-target rounded-2xl border border-brand-100 bg-white px-4 py-2 text-sm font-black text-brand-800 shadow-sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Скрий" : "Виж история"}
          </Button>
        </div>
      </div>

      <div className="mt-3 rounded-2xl bg-white/80 p-3 text-sm font-semibold text-clay ring-1 ring-brand-100">
        <div className="font-black text-ink">Последен престой:</div>
        <div className="mt-1">
          {formatBulgarianDateRange(summary.lastStay.checkin, summary.lastStay.checkout)} · {propertyName(summary.lastStay.propertyId)} · {roomsLabel(summary.lastStay)}
        </div>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          <span>Общо история: <strong className="text-ink">{eurWhole(summary.totalRevenue)}</strong></span>
          <span>{summary.depositPattern}</span>
        </div>
        {summary.roomHistory.length > 0 && (
          <div className="mt-2 text-xs font-black text-brand-800">
            {summary.roomHistory.join(" · ")}
          </div>
        )}
      </div>

      {summary.notes.length > 0 && (
        <div className="mt-3 text-sm font-semibold text-clay">
          <div className="font-black text-ink">Бележки от предишни резервации:</div>
          <ul className="mt-1 grid gap-1">
            {summary.notes.map((note) => <li key={note} className="rounded-2xl bg-white/70 px-3 py-2">- {note}</li>)}
          </ul>
        </div>
      )}

      {summary.smartTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {summary.smartTags.slice(0, 4).map((tag) => (
            <span key={tag.id} className="rounded-full bg-white/80 px-3 py-1 text-xs font-black text-brand-800 ring-1 ring-brand-100" title={tag.reason}>
              {tag.label}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <div className="mt-3 grid gap-2">
          {summary.matches.map(({ reservation, reasons }) => (
            <article key={reservation.id} className="rounded-2xl bg-white p-3 text-sm shadow-sm ring-1 ring-stone-200">
              <div className="font-black text-ink">{formatBulgarianDateRange(reservation.checkin, reservation.checkout)}</div>
              <div className="mt-1 font-semibold text-clay">{propertyName(reservation.propertyId)} · {roomsLabel(reservation)}</div>
              <div className="mt-2 grid gap-1 font-bold text-stone-700 sm:grid-cols-2">
                <span>Общо: {eurWhole(reservation.totalAmount)}</span>
                <span>Капаро: {eurWhole(reservation.depositAmount)}</span>
              </div>
              {reservation.notes && <p className="mt-2 font-medium text-clay">{reservation.notes}</p>}
              <div className="mt-2 text-xs font-black text-brand-800">{reasons.join(" · ")}</div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function getFinanceInsightTone(text: string): { className: string; badgeClassName: string } {
  const normalized = normalizeGuestText(text);
  if (matchesAny(normalized, ["без капаро", "слаб", "по-слаб", "натиск", "изостав", "под 45", "под 30"])) {
    return {
      className: "border-amber-100 bg-amber-50/75 text-amber-950",
      badgeClassName: "text-amber-800 ring-amber-100"
    };
  }
  if (matchesAny(normalized, ["повече", "по-добър", "над", "маржът", "здрав", "почти запълнени", "остават"])) {
    return {
      className: "border-emerald-100 bg-emerald-50/70 text-emerald-950",
      badgeClassName: "text-emerald-800 ring-emerald-100"
    };
  }
  return {
    className: "border-sky-100 bg-sky-50/70 text-sky-950",
    badgeClassName: "text-sky-800 ring-sky-100"
  };
}

function GuestMemorySheet({ target, reservations, onClose }: { target: ReservationDraft; reservations: Reservation[]; onClose: () => void }) {
  const sourceReservations = target.id === "__demo_guest_memory__" ? [...reservations, ...getDemoGuestMemoryReservations()] : reservations;
  const summary = buildGuestMemorySummary(findGuestMemoryMatches(target, sourceReservations));
  const guestName = target.guestName || summary?.lastStay.guestName || "Гост";
  const confidenceLabel = summary ? summary.confidence === "high" ? "Познат гост" : "Възможно съвпадение" : "Няма история";
  const favoriteRoom = summary ? getFavoriteGuestRoom(summary.matches) : "";
  const averageNights = summary ? getAverageStayNights(summary.matches) : 0;

  return (
    <div className="modal-backdrop fixed inset-0 z-[85] flex items-end justify-center bg-stone-950/35 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="guest-memory-title">
      <section className="sheet-panel max-h-[88dvh] w-full overflow-auto rounded-t-3xl border border-white/80 bg-cream p-4 shadow-2xl sm:max-w-2xl sm:rounded-3xl sm:p-5">
        <div className="sheet-handle sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${summary ? "bg-brand-100 text-brand-800" : "bg-stone-100 text-clay"}`}>
              {confidenceLabel}
            </span>
            <h3 id="guest-memory-title" className="mt-2 truncate text-2xl font-black text-ink">{guestName}</h3>
            {target.phone && <div className="mt-1 text-sm font-bold text-clay">{target.phone}</div>}
          </div>
          <Button type="button" className="tap-target inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-stone-200 bg-white text-clay shadow-sm" onClick={onClose} aria-label="Затвори">
            <X aria-hidden="true" size={19} />
          </Button>
        </div>

        {!summary ? (
          <div className="mt-5 rounded-3xl bg-white p-4 text-base font-semibold text-clay shadow-sm ring-1 ring-stone-200">
            Няма предишна история за този гост.
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            {(summary.smartTags.length > 0 || summary.smartSummary) && (
              <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
                <div className="text-sm font-black uppercase tracking-wide text-clay">Smart Notes</div>
                {summary.smartTags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {summary.smartTags.map((tag) => (
                      <span key={tag.id} className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-black text-brand-900 ring-1 ring-brand-100" title={tag.reason}>
                        {tag.label}
                      </span>
                    ))}
                  </div>
                )}
                {summary.smartSummary && (
                  <p className="mt-3 text-base font-bold leading-snug text-ink">{summary.smartSummary}</p>
                )}
              </section>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <GuestMemoryStat label="Престои" value={`${summary.previousStays}`} />
              <GuestMemoryStat label="Последно" value={formatBulgarianDateRange(summary.lastStay.checkin, summary.lastStay.checkout)} />
              <GuestMemoryStat label="Любима стая" value={favoriteRoom || "—"} />
              <GuestMemoryStat label="Общо приходи" value={eurWhole(summary.totalRevenue)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
                <div className="text-sm font-black uppercase tracking-wide text-clay">Навици</div>
                <div className="mt-2 grid gap-2 text-sm font-bold text-stone-700">
                  <span>{summary.depositPattern}</span>
                  <span>Среден престой: {averageNights ? `${averageNights} нощувки` : "—"}</span>
                  <span>Последно: {propertyName(summary.lastStay.propertyId)} · {roomsLabel(summary.lastStay)}</span>
                </div>
              </div>
              <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
                <div className="text-sm font-black uppercase tracking-wide text-clay">Бележки</div>
                {summary.notes.length ? (
                  <ul className="mt-2 grid gap-2 text-sm font-semibold text-stone-700">
                    {summary.notes.map((note) => <li key={note} className="rounded-2xl bg-cream px-3 py-2">{note}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm font-semibold text-clay">Няма запазени бележки.</p>
                )}
              </div>
            </div>

            <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
              <div className="mb-3 text-lg font-black text-ink">Предишни престои</div>
              <div className="grid gap-3">
                {summary.matches.slice(0, 5).map(({ reservation, confidence, reasons }) => (
                  <article key={reservation.id} className="rounded-2xl bg-cream p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="font-black text-ink">{formatBulgarianDateRange(reservation.checkin, reservation.checkout)}</div>
                        <div className="mt-1 text-sm font-bold text-clay">{propertyName(reservation.propertyId)} · {roomsLabel(reservation)}</div>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-brand-800">
                        {confidence === "high" ? "силно" : confidence === "medium" ? "средно" : "слабо"} съвпадение
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm font-bold text-stone-700 sm:grid-cols-2">
                      <span>Общо: {eurWhole(reservation.totalAmount)}</span>
                      <span>Капаро: {eurWhole(reservation.depositAmount)}</span>
                    </div>
                    {reservation.notes && <p className="mt-2 text-sm font-semibold text-clay">Бележка: {reservation.notes}</p>}
                    <div className="mt-2 text-xs font-black text-brand-800">{reasons.join(" · ")}</div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function GuestMemoryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-white p-4 text-center shadow-sm ring-1 ring-stone-200">
      <div className="text-xs font-black uppercase tracking-wide text-clay">{label}</div>
      <div className="mt-2 text-base font-black text-ink">{value}</div>
    </div>
  );
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

function speakAssistantResponse(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const cleanText = text.trim();
  if (!cleanText) return;

  stopAssistantSpeech();
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = "bg-BG";
  const voice = getBulgarianVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

function stopAssistantSpeech() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function getBulgarianVoice(options: { strict?: boolean } = {}): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const bgVoice = voices.find((voice) => voice.lang.toLocaleLowerCase().startsWith("bg"));
  if (bgVoice || options.strict) return bgVoice || null;
  return voices.find((voice) => voice.lang.toLocaleLowerCase().startsWith("ru")) || null;
}

function FinancePrivacyPrompt({ onCancel, onReveal }: { onCancel: () => void; onReveal: () => void }) {
  return (
    <div className="modal-backdrop fixed inset-0 z-[80] flex items-end justify-center bg-stone-950/35 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="finance-privacy-title">
      <div className="sheet-panel w-full rounded-t-3xl border border-white/80 bg-cream p-5 shadow-2xl sm:max-w-md sm:rounded-3xl">
        <div className="sheet-handle sm:hidden" />
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-brand-700 shadow-sm ring-1 ring-stone-200">
            <LockKeyhole aria-hidden="true" size={21} />
          </span>
          <div>
            <h3 id="finance-privacy-title" className="text-xl font-black text-ink">Покажи финансовите стойности?</h3>
            <p className="mt-2 text-base font-semibold text-clay">Сигурни ли сте, че искате да покажете финансовите стойности?</p>
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button type="button" className="tap-target rounded-2xl border border-stone-200 bg-white px-4 py-3 font-black text-clay shadow-sm" onClick={onCancel}>
            Отказ
          </Button>
          <Button type="button" className="tap-target rounded-2xl bg-brand-600 px-4 py-3 font-black text-white shadow-sm" onClick={onReveal}>
            Покажи
          </Button>
        </div>
      </div>
    </div>
  );
}

function FinanceValue({ text, revealed, mask = "€ ****" }: { text: string; revealed: boolean; mask?: string }) {
  return (
    <span className="inline-grid min-w-[4.5rem] items-center justify-items-center whitespace-nowrap transition-opacity duration-300">
      <span className={`col-start-1 row-start-1 transition-opacity duration-300 ${revealed ? "opacity-100" : "select-none opacity-0"}`} aria-hidden={!revealed}>{text}</span>
      {!revealed && <span className="col-start-1 row-start-1 transition-opacity duration-300">{mask}</span>}
    </span>
  );
}

function Kpi({ label, value, danger = false, revealed }: { label: string; value: number; danger?: boolean; revealed: boolean }) {
  return (
    <div className="flex min-h-28 flex-col items-center justify-center rounded-3xl border border-stone-200 bg-cream p-4 text-center shadow-sm">
      <div className="text-sm font-bold leading-tight text-clay">{label}</div>
      <div className={`mt-3 text-2xl font-black leading-none ${danger ? "text-rose-700" : "text-ink"}`}><FinanceValue text={eurWhole(value)} revealed={revealed} /></div>
    </div>
  );
}

function KpiText({ label, value, danger = false, revealed, mask }: { label: string; value: string; danger?: boolean; revealed: boolean; mask?: string }) {
  return (
    <div className="flex min-h-28 flex-col items-center justify-center rounded-3xl border border-stone-200 bg-cream p-4 text-center shadow-sm">
      <div className="text-sm font-bold leading-tight text-clay">{label}</div>
      <div className={`mt-3 text-2xl font-black leading-none ${danger ? "text-rose-700" : "text-ink"}`}><FinanceValue text={value} revealed={revealed} mask={mask} /></div>
    </div>
  );
}

function OccupancyKpi({ value, revealed = true }: { value: number; revealed?: boolean }) {
  const occupancy = Number.isFinite(value) ? Math.max(0, value) : 0;
  const progress = Math.min(100, occupancy);
  const color = progress < 30 ? "bg-rose-600" : progress <= 75 ? "bg-orange-500" : "bg-emerald-600";

  return (
    <div className="flex min-h-28 flex-col items-center justify-center rounded-3xl border border-stone-200 bg-cream p-4 text-center shadow-sm">
      <div className="text-sm font-bold leading-tight text-clay">Заетост</div>
      <div className="mt-3 text-2xl font-black leading-none text-ink"><FinanceValue text={formatPercent(occupancy)} revealed={revealed} mask="**%" /></div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/85 ring-1 ring-stone-200">
        <div className={`h-full rounded-full transition duration-300 ${revealed ? color : "bg-stone-300"}`} style={{ width: `${revealed ? progress : 42}%` }} />
      </div>
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

function findGuestMemoryMatches(input: ReservationDraft, reservations: Reservation[]): GuestMemoryMatch[] {
  return reservations
    .filter((reservation) => reservation.id !== input.id)
    .map((reservation) => scoreGuestMatch(input, reservation))
    .filter((match): match is GuestMemoryMatch => Boolean(match))
    .sort((a, b) => b.score - a.score || b.reservation.checkin.localeCompare(a.reservation.checkin))
    .slice(0, 8);
}

function hasGuestMemoryHistory(input: ReservationDraft, reservations: Reservation[]): boolean {
  return findGuestMemoryMatches(input, reservations).length > 0;
}

function scoreGuestMatch(input: ReservationDraft, reservation: Reservation): GuestMemoryMatch | null {
  const reasons: string[] = [];
  let score = 0;

  const inputPhones = getPhoneMatchParts(input.phone);
  const reservationPhones = getPhoneMatchParts(reservation.phone);
  const exactPhone = inputPhones.strong.length > 0 && inputPhones.strong.some((phone) => reservationPhones.strong.includes(phone));
  const lastDigitsPhone = !exactPhone && inputPhones.fallback.length > 0 && inputPhones.fallback.some((phone) => reservationPhones.fallback.includes(phone));

  if (exactPhone) {
    score += 100;
    reasons.push("телефон");
  } else if (lastDigitsPhone) {
    score += 76;
    reasons.push("последни цифри");
  }

  const inputName = normalizeGuestText(input.guestName);
  const reservationName = normalizeGuestText(reservation.guestName);
  const nameMatch = inputName.length >= 3 && reservationName.length >= 3 && (inputName === reservationName || inputName.includes(reservationName) || reservationName.includes(inputName));

  if (nameMatch) {
    score += inputName === reservationName ? 42 : 30;
    reasons.push("име");
  }

  const noteMatch = hasSupportingNoteMatch(input.notes, reservation.notes);
  if (noteMatch && (exactPhone || lastDigitsPhone || nameMatch)) {
    score += 12;
    reasons.push("бележки");
  }

  if (score < 35 || (!exactPhone && !lastDigitsPhone && !nameMatch)) return null;

  return {
    reservation,
    score,
    confidence: score >= 90 ? "high" : score >= 60 ? "medium" : "low",
    reasons
  };
}

function buildGuestMemorySummary(matches: GuestMemoryMatch[]): GuestMemorySummary | null {
  if (!matches.length) return null;

  const sortedByDate = [...matches].sort((a, b) => b.reservation.checkin.localeCompare(a.reservation.checkin));
  const lastStay = sortedByDate[0].reservation;
  const totalRevenue = matches.reduce((sum, match) => sum + (Number(match.reservation.totalAmount) || 0), 0);
  const depositCount = matches.filter((match) => (Number(match.reservation.depositAmount) || 0) > 0).length;
  const noteSeen = new Set<string>();
  const notes = matches
    .map((match) => match.reservation.notes.trim())
    .filter(Boolean)
    .filter((note) => {
      const normalized = normalizeGuestText(note);
      if (noteSeen.has(normalized)) return false;
      noteSeen.add(normalized);
      return true;
    })
    .slice(0, 4);
  const roomHistory = Array.from(new Set(matches.map((match) => `${propertyName(match.reservation.propertyId)} · ${roomsLabel(match.reservation)}`))).slice(0, 4);
  const topConfidence = matches.some((match) => match.confidence === "high") ? "high" : matches.some((match) => match.confidence === "medium") ? "medium" : "low";
  const smartTags = generateGuestSmartTags(matches);

  return {
    matches,
    confidence: topConfidence,
    previousStays: matches.length,
    lastStay,
    totalRevenue,
    notes,
    roomHistory,
    depositPattern: depositCount === matches.length ? "Обикновено има капаро" : depositCount > 0 ? "Понякога оставя капаро" : "Обикновено без капаро",
    smartTags,
    smartSummary: buildGuestSmartSummarySentence(smartTags)
  };
}

function generateGuestSmartTags(matches: GuestMemoryMatch[]): GuestSmartTag[] {
  const reservations = matches.map((match) => match.reservation).filter((reservation) => reservation.status !== "cancelled");
  const stayCount = reservations.length;
  if (!stayCount) return [];

  const nights = reservations.map((reservation) => eachNight(reservation.checkin, reservation.checkout).length);
  const averageNights = averageNumber(nights);
  const averageAmount = averageNumber(reservations.map((reservation) => Number(reservation.totalAmount) || 0));
  const wholeCount = reservations.filter((reservation) => reservation.rooms.includes("all")).length;
  const roomCounts = new Map<string, number>();
  let jacuzziStayCount = 0;
  let weekendCheckins = 0;
  let summerStays = 0;
  let winterStays = 0;

  reservations.forEach((reservation) => {
    const rooms = reservation.rooms.includes("all") ? [] : reservation.rooms.map(String);
    rooms.forEach((room) => roomCounts.set(room, (roomCounts.get(room) || 0) + 1));
    if (rooms.some((room) => JACUZZI_ROOMS.has(room))) jacuzziStayCount += 1;

    const checkin = parseISODate(reservation.checkin);
    const day = checkin.getDay();
    if (day === 5 || day === 6) weekendCheckins += 1;
    const month = checkin.getMonth() + 1;
    if (month >= 6 && month <= 8) summerStays += 1;
    if (month === 12 || month <= 2) winterStays += 1;
  });

  const keywordStats = extractGuestCommentKeywords(reservations);
  const lastStay = [...reservations].sort((a, b) => b.checkin.localeCompare(a.checkin))[0];
  const daysSinceLastStay = Math.floor((parseISODate(todayISO()).getTime() - parseISODate(lastStay.checkout || lastStay.checkin).getTime()) / 86400000);
  const favoriteRoom = Array.from(roomCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  const tags: GuestSmartTag[] = [];

  if (stayCount >= 2 && jacuzziStayCount / stayCount > 0.6) {
    tags.push({ id: "jacuzzi", label: "Предпочита стаи с джакузи", tier: 1, priority: 100, reason: `${jacuzziStayCount}/${stayCount} престоя са в стаи с джакузи` });
  }
  if (stayCount >= 2 && favoriteRoom && favoriteRoom[1] / stayCount >= 0.5) {
    tags.push({ id: "favorite-room", label: `Предпочита стая ${favoriteRoom[0]}`, tier: 1, priority: 95, reason: `Стая ${favoriteRoom[0]} е използвана ${favoriteRoom[1]} пъти` });
  }
  if (stayCount >= 2 && weekendCheckins / stayCount > 0.7) {
    tags.push({ id: "weekend", label: "Уикенд гост", tier: 1, priority: 90, reason: `${weekendCheckins}/${stayCount} check-in са петък/събота` });
  }
  if (keywordStats.family >= 2 || (keywordStats.recentFamily && keywordStats.family >= 1)) {
    tags.push({ id: "family", label: "Семейство", tier: 1, priority: 85, reason: "Бележките споменават дете/семейство" });
  }
  if (stayCount >= 6) {
    tags.push({ id: "very-frequent", label: "Много чест гост", tier: 2, priority: 84, reason: `${stayCount} предишни престоя` });
  } else if (stayCount >= 3) {
    tags.push({ id: "regular", label: "⭐ Редовен гост", tier: 2, priority: 80, reason: `${stayCount} предишни престоя` });
  }
  if (averageAmount >= HIGH_VALUE_GUEST_AVERAGE_EUR) {
    tags.push({ id: "high-value", label: "Висока стойност", tier: 2, priority: 76, reason: `Средна резервация ${eurWhole(averageAmount)}` });
  }
  if (daysSinceLastStay <= 30) {
    tags.push({ id: "recent", label: "Скорошен гост", tier: 2, priority: 72, reason: `Последен престой преди ${Math.max(0, daysSinceLastStay)} дни` });
  }
  if (summerStays / stayCount > 0.6) {
    tags.push({ id: "summer", label: "Летен гост", tier: 3, priority: 68, reason: `${summerStays}/${stayCount} престоя са юни-август` });
  }
  if (winterStays / stayCount > 0.6) {
    tags.push({ id: "winter", label: "вќ„пёЏ Зимен гост", tier: 3, priority: 67, reason: `${winterStays}/${stayCount} престоя са декември-февруари` });
  }
  if (stayCount >= 2 && averageNights <= 2) {
    tags.push({ id: "short-stay", label: "⏳ Кратък престой", tier: 3, priority: 66, reason: `Средно ${Math.round(averageNights)} нощувки` });
  }
  if (stayCount >= 2 && averageNights >= 4) {
    tags.push({ id: "long-stay", label: "Дълъг престой", tier: 3, priority: 65, reason: `Средно ${Math.round(averageNights)} нощувки` });
  }
  if (averageAmount > 0 && averageAmount <= BUDGET_GUEST_AVERAGE_EUR) {
    tags.push({ id: "budget", label: "Бюджетен престой", tier: 3, priority: 64, reason: `Средна резервация ${eurWhole(averageAmount)}` });
  }
  if (keywordStats.fishing >= 1) tags.push({ id: "fishing", label: "Риболов", tier: 3, priority: 63, reason: "Бележките споменават риболов" });
  if (keywordStats.bbq >= 1) tags.push({ id: "bbq", label: "BBQ", tier: 3, priority: 62, reason: "Бележките споменават барбекю/BBQ" });
  if (keywordStats.pet >= 1) tags.push({ id: "pet", label: "Домашен любимец", tier: 3, priority: 61, reason: "Бележките споменават домашен любимец" });
  if (keywordStats.late >= 1) tags.push({ id: "late", label: "Късно настаняване", tier: 3, priority: 60, reason: "Бележките споменават късно пристигане" });
  if (keywordStats.occasion >= 1) tags.push({ id: "occasion", label: "Повод / рожден ден", tier: 3, priority: 59, reason: "Бележките споменават повод" });
  if (daysSinceLastStay >= 365) {
    tags.push({ id: "long-time", label: "Не е идвал отдавна", tier: 3, priority: 58, reason: `Последен престой преди ${daysSinceLastStay} дни` });
  }
  if (stayCount >= 2 && wholeCount / stayCount >= 0.5) {
    tags.push({ id: "whole-property", label: "Често резервира цял обект", tier: 1, priority: 88, reason: `${wholeCount}/${stayCount} резервации са за цял обект` });
  }

  return prioritizeGuestSmartTags(tags);
}

function prioritizeGuestSmartTags(tags: GuestSmartTag[]): GuestSmartTag[] {
  const pickTier = (tier: GuestSmartTagTier, count: number) => tags
    .filter((tag) => tag.tier === tier)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, count);
  return [...pickTier(1, 2), ...pickTier(2, 2), ...pickTier(3, 2)];
}

function buildGuestSmartSummarySentence(tags: GuestSmartTag[]): string {
  if (!tags.length) return "";
  const has = (id: string) => tags.some((tag) => tag.id === id);
  const parts: string[] = [];
  if (has("very-frequent")) parts.push("много чест гост");
  else if (has("regular")) parts.push("редовен гост");
  if (has("weekend")) parts.push("уикенд гост");
  if (has("family")) parts.push("семеен гост");
  if (has("jacuzzi")) parts.push("предпочита стаи с джакузи");
  else {
    const favorite = tags.find((tag) => tag.id === "favorite-room");
    if (favorite) parts.push(favorite.label.toLocaleLowerCase("bg-BG"));
  }
  if (has("summer")) parts.push("идва основно лятото");
  if (has("winter")) parts.push("идва основно зимата");
  if (has("short-stay")) parts.push("с кратки престои");
  if (has("long-stay")) parts.push("с дълги престои");
  if (has("high-value")) parts.push("с висока стойност");

  const selected = parts.slice(0, 3);
  if (!selected.length) return tags.slice(0, 2).map((tag) => tag.label.replace(/^[^\p{L}\p{N}]+/u, "")).join(", ") + ".";
  return selected.join(", ").replace(/^./, (letter) => letter.toLocaleUpperCase("bg-BG")) + ".";
}

function extractGuestCommentKeywords(reservations: Reservation[]): GuestKeywordStats {
  const stats = {
    family: 0,
    fishing: 0,
    bbq: 0,
    pet: 0,
    late: 0,
    occasion: 0,
    recentFamily: false
  };
  const sorted = [...reservations].sort((a, b) => b.checkin.localeCompare(a.checkin));
  sorted.forEach((reservation, index) => {
    const note = normalizeGuestText(reservation.notes);
    const family = countKeywordGroup(note, ["дете", "бебе", "family", "семейство", "kids", "child"]);
    stats.family += family;
    if (index === 0 && family > 0) stats.recentFamily = true;
    stats.fishing += countKeywordGroup(note, ["риболов", "fishing"]);
    stats.bbq += countKeywordGroup(note, ["барбекю", "bbq"]);
    stats.pet += countKeywordGroup(note, ["куче", "dog", "домашен любимец", "pet"]);
    stats.late += countKeywordGroup(note, ["късно", "late", "след 22", "midnight", "вечерта"]);
    stats.occasion += countKeywordGroup(note, ["рожден ден", "birthday", "anniversary", "годишнина"]);
  });
  return stats;
}

function countKeywordGroup(value: string, keywords: string[]): number {
  return keywords.reduce((count, keyword) => count + (value.includes(keyword) ? 1 : 0), 0);
}

function averageNumber(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function getFavoriteGuestRoom(matches: GuestMemoryMatch[]): string {
  const counts = new Map<string, number>();
  matches.forEach(({ reservation }) => {
    const label = roomsLabel(reservation);
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function getAverageStayNights(matches: GuestMemoryMatch[]): number {
  if (!matches.length) return 0;
  const total = matches.reduce((sum, { reservation }) => sum + eachNight(reservation.checkin, reservation.checkout).length, 0);
  return Math.round(total / matches.length);
}

function createDemoGuestMemoryTarget(): ReservationDraft {
  return {
    id: "__demo_guest_memory__",
    propertyId: "villa",
    rooms: ["7"],
    checkin: todayISO(),
    checkout: addDaysISO(todayISO(), 2),
    guestName: "Иван Петров",
    phone: "0888 123 456",
    notes: "Предпочита SPA стая.",
    depositAmount: 0,
    totalAmount: 0
  };
}

function getDemoGuestMemoryReservations(): Reservation[] {
  const base = new Date().toISOString();
  return [
    {
      id: "demo-memory-1",
      propertyId: "villa",
      rooms: ["7"],
      checkin: "2026-04-12",
      checkout: "2026-04-14",
      guestName: "Иван Петров",
      phone: "+359 888 123 456",
      notes: "Идват с дете. Предпочитат тих етаж.",
      depositAmount: 100,
      totalAmount: 360,
      status: "paid",
      createdAt: base,
      updatedAt: base
    },
    {
      id: "demo-memory-2",
      propertyId: "villa",
      rooms: ["9"],
      checkin: "2025-08-10",
      checkout: "2025-08-13",
      guestName: "Иван Петров",
      phone: "0888-123-456",
      notes: "Плащат капаро по банков път.",
      depositAmount: 150,
      totalAmount: 540,
      status: "paid",
      createdAt: base,
      updatedAt: base
    },
    {
      id: "demo-memory-3",
      propertyId: "house",
      rooms: ["3"],
      checkin: "2025-05-18",
      checkout: "2025-05-20",
      guestName: "Иван Петров",
      phone: "0888123456",
      notes: "Харесват стая със СПА.",
      depositAmount: 80,
      totalAmount: 320,
      status: "paid",
      createdAt: base,
      updatedAt: base
    }
  ];
}

function normalizePhoneDigits(phone: string): string {
  return (phone || "").replace(/[^\d]/g, "");
}

function getPhoneMatchParts(phone: string): { strong: string[]; fallback: string[] } {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 7) return { strong: [], fallback: [] };

  const strong = new Set<string>([digits]);
  if (digits.startsWith("0") && digits.length >= 9) strong.add(`359${digits.slice(1)}`);
  if (digits.startsWith("359") && digits.length >= 11) strong.add(`0${digits.slice(3)}`);

  const fallback = new Set<string>();
  [9, 8, 7].forEach((length) => {
    if (digits.length >= length) fallback.add(digits.slice(-length));
  });

  return { strong: Array.from(strong), fallback: Array.from(fallback) };
}

function normalizeGuestText(value: string): string {
  return (value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("bg-BG");
}

function hasSupportingNoteMatch(inputNotes: string, reservationNotes: string): boolean {
  const inputWords = meaningfulGuestWords(inputNotes);
  if (inputWords.length < 1) return false;
  const reservationWords = new Set(meaningfulGuestWords(reservationNotes));
  return inputWords.some((word) => reservationWords.has(word));
}

function meaningfulGuestWords(value: string): string[] {
  const common = new Set(["гост", "гости", "стая", "стаи", "нощ", "нощи", "капаро", "плаща", "платено", "има", "няма", "за", "със", "без", "при", "ще"]);
  return normalizeGuestText(value)
    .split(/[^0-9a-zа-яё]+/i)
    .filter((word) => word.length >= 4 && !common.has(word));
}

function propertyName(propertyId: PropertyId): string {
  return PROPERTIES.find((property) => property.id === propertyId)?.name || propertyId;
}

const BG_WEEKDAYS_LONG = ["Неделя", "Понеделник", "Вторник", "Сряда", "Четвъртък", "Петък", "Събота"];

function getCombinedDayOccupancy(reservations: Reservation[], isoDate: string): { occupied: number; total: number } {
  let occupied = 0;

  PROPERTIES.forEach((property) => {
    const propertyReservations = reservations.filter((reservation) => reservation.propertyId === property.id && activeOnDate(reservation.checkin, reservation.checkout, isoDate));
    if (propertyReservations.some((reservation) => reservation.rooms.includes("all"))) {
      occupied += property.rooms.length;
      return;
    }

    const occupiedRoomsForProperty = new Set(
      propertyReservations.flatMap((reservation) => reservation.rooms.filter((room) => room !== "all"))
    );
    occupied += occupiedRoomsForProperty.size;
  });

  return { occupied, total: totalHotelCapacity() };
}

type PropertyDayOccupancy = {
  propertyId: PropertyId;
  label: string;
  icon: string;
  occupied: number;
  total: number;
  free: number;
  status: "free" | "partial" | "gap" | "full";
};

function getPropertyDayOccupancies(reservations: Reservation[], isoDate: string): PropertyDayOccupancy[] {
  return PROPERTIES.map((property) => {
    const propertyReservations = reservations.filter((reservation) => reservation.propertyId === property.id && activeOnDate(reservation.checkin, reservation.checkout, isoDate));
    const hasWholeReservation = propertyReservations.some((reservation) => reservation.rooms.includes("all"));
    const occupied = hasWholeReservation
      ? property.rooms.length
      : new Set(
        propertyReservations
          .flatMap((reservation) => reservation.rooms.filter((room) => room !== "all"))
          .map(String)
      ).size;
    const total = property.rooms.length;
    const free = Math.max(0, total - occupied);
    const isGap = property.id === "villa" ? free > 0 && free <= 2 : free === 1;
    const status = occupied <= 0 ? "free" : occupied >= total ? "full" : isGap ? "gap" : "partial";

    return {
      propertyId: property.id,
      label: property.id === "villa" ? "Вила" : "Къща",
      icon: property.id === "villa" ? "🌲" : "🏡",
      occupied,
      total,
      free,
      status
    };
  });
}

type RoomAvailabilityState = "free" | "deposit-paid" | "no-deposit";

function RoomAvailabilitySegments({ reservations, date }: { reservations: Reservation[]; date: string }) {
  return (
    <div className="grid w-full self-start gap-0.5" aria-label="Състояние на стаите за деня">
      {PROPERTIES.map((property) => {
        const states = getRoomAvailabilityStates(reservations, date, property.id);
        return (
          <div key={property.id} className="relative grid gap-[0.5px]" style={{ gridTemplateColumns: `repeat(${property.rooms.length}, minmax(0, 1fr))` }}>
            <span className="pointer-events-none absolute -left-1.5 top-1/2 -translate-y-1/2 text-[7px] leading-none opacity-55 sm:-left-2 sm:text-[9px]" aria-hidden="true">
              {property.id === "villa" ? "🌲" : "🏡"}
            </span>
            {property.rooms.map((room) => {
              const state = states[room];
              return (
                <span
                  key={room}
                  title={`${property.name} · стая ${room} · ${roomAvailabilityLabel(state)}`}
                  className={`flex h-3.5 min-w-0 items-center justify-center rounded-[2px] font-black leading-none text-white ${room.length > 1 ? "text-[5px] sm:text-[7px]" : "text-[6px] sm:text-[9px]"} sm:h-4 ${getRoomAvailabilityClass(state)}`}
                >
                  {room}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function getRoomAvailabilityStates(reservations: Reservation[], date: string, propertyId: PropertyId): Record<RoomId, RoomAvailabilityState> {
  const property = PROPERTIES.find((item) => item.id === propertyId);
  if (!property) return {} as Record<RoomId, RoomAvailabilityState>;

  const active = reservations.filter((reservation) => reservation.propertyId === propertyId && activeOnDate(reservation.checkin, reservation.checkout, date));
  return Object.fromEntries(property.rooms.map((room) => {
    const roomReservations = active.filter((reservation) => reservation.rooms.includes("all") || reservation.rooms.map(String).includes(room));
    if (roomReservations.some((reservation) => Number(reservation.depositAmount) <= 0)) return [room, "no-deposit"];
    if (roomReservations.length > 0) return [room, "deposit-paid"];
    return [room, "free"];
  })) as Record<RoomId, RoomAvailabilityState>;
}

function getRoomAvailabilityClass(state: RoomAvailabilityState): string {
  if (state === "deposit-paid") return "bg-emerald-500";
  if (state === "no-deposit") return "bg-rose-500";
  return "bg-slate-500";
}

function roomAvailabilityLabel(state: RoomAvailabilityState): string {
  if (state === "deposit-paid") return "има капаро";
  if (state === "no-deposit") return "без капаро";
  return "свободна";
}

function totalHotelCapacity(): number {
  return PROPERTIES.reduce((sum, property) => sum + property.rooms.length, 0);
}

function getOccupancyProgressColor(occupied: number, total: number): string {
  if (occupied <= 0) return "bg-emerald-500/70";
  if (occupied >= total) return "bg-rose-600";
  return "bg-amber-500";
}

function getMonthHolidayIdeas(month: string): BulgarianHolidayInfo[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: days }, (_, index) => {
    const iso = `${month}-${String(index + 1).padStart(2, "0")}`;
    return getBulgarianHolidayInfo(iso);
  })
    .filter((holiday): holiday is BulgarianHolidayInfo => Boolean(holiday?.leaveIdeaText))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getOccupancyTone(occupied: number, total: number): { status: "free" | "partial" | "full"; className: string } {
  if (occupied <= 0) return { status: "free", className: "border-emerald-200 bg-emerald-50 text-emerald-950" };
  if (occupied >= total) return { status: "full", className: "border-rose-300 bg-rose-100 text-rose-950" };
  return { status: "partial", className: "border-amber-300 bg-amber-50 text-amber-950" };
}

function getCalendarDayCardClass(status: "free" | "partial" | "full"): string {
  if (status === "free") return "border-stone-200 bg-white text-stone-950";
  if (status === "full") return "border-stone-200 bg-rose-50/35 text-stone-950";
  return "border-stone-200 bg-amber-50/30 text-stone-950";
}

function getCalendarDayAccentClass(status: "free" | "partial" | "full"): string {
  if (status === "free") return "bg-emerald-400/75";
  if (status === "full") return "bg-rose-500/80";
  return "bg-amber-400/80";
}

function formatDayDetailTitle(date: string): string {
  const parsed = parseISODateForCalendar(date);
  if (!parsed) return date;
  const weekday = BG_WEEKDAYS_LONG[parsed.date.getDay()];
  return `${weekday}, ${formatBulgarianDayOrdinal(parsed.day)}`;
}

function parseISODateForCalendar(value: string): { date: Date; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { date: new Date(year, month - 1, day), day };
}

function occupiedRooms(reservations: Reservation[]): number {
  return new Set(reservations.flatMap((reservation) => reservation.rooms.filter((room) => room !== "all"))).size;
}

function roomsLabel(reservation: Reservation): string {
  return reservation.rooms.includes("all") ? WHOLE_PROPERTY_LABEL : "Стаи " + reservation.rooms.join(", ");
}

function formatReservationDateRangeWithNights(reservation: Reservation): string {
  const label = formatBulgarianDateRange(reservation.checkin, reservation.checkout);
  const nights = eachNight(reservation.checkin, reservation.checkout).length;
  return nights > 0 ? `${label} (${nights})` : label;
}

function PhoneLink({ phone, onGuestMemory, showGuestMemoryState = false }: { phone: string; onGuestMemory?: () => void; showGuestMemoryState?: boolean }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return <>Няма телефон</>;
  if (!showGuestMemoryState) {
    return (
      <a className="tap-target inline-flex min-h-11 items-center rounded-xl px-0 font-black text-brand-700 underline-offset-4 hover:underline" href={`tel:${normalized}`} onClick={() => debugClick("call phone")}>
        {phone}
      </a>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a className="tap-target inline-flex min-h-11 items-center rounded-xl px-0 font-black text-brand-700 underline-offset-4 hover:underline" href={`tel:${normalized}`} onClick={() => debugClick("call phone")}>
        {phone}
      </a>
      <Button type="button" disabled={!onGuestMemory} className={`tap-target rounded-full border px-3 py-1.5 text-xs font-black shadow-sm ${onGuestMemory ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-stone-100 text-stone-400"}`} onClick={onGuestMemory}>
        История
      </Button>
    </span>
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

function isAssistantReservationIntent(input: string): boolean {
  const normalized = normalizeGuestText(input);
  return normalized.includes("резервац") || normalized.includes("rezerv");
}

type AssistantIntentName =
  | "reservation_shortcut"
  | "next_guest"
  | "arrivals_today"
  | "arrivals_tomorrow"
  | "weekend_status"
  | "free_rooms"
  | "finance_summary"
  | "month_comparison"
  | "occupancy"
  | "no_deposit"
  | "clarify"
  | "unknown";

type AssistantRouteResult = {
  intent: AssistantIntentName;
  confidence: "high" | "medium" | "low";
  entities?: Record<string, unknown>;
  answer: string;
};

function routeAssistantQuery(query: string, data: AppData, activeMonth: string, financeUnlocked: boolean): AssistantRouteResult {
  const normalized = normalizeGuestText(query);
  const analytics = parseAssistantAnalyticsQuery(query, activeMonth);

  if (isAssistantReservationIntent(query)) {
    return { intent: "reservation_shortcut", confidence: "high", answer: "Отварям нова резервация." };
  }

  if (analytics) {
    if (!analytics.primaryMonth && !analytics.baselineMonth) {
      return { intent: "clarify", confidence: "medium", entities: { reason: "missing_months" }, answer: "Кои два месеца да сравня?" };
    }
    if (analytics.primaryMonth && !analytics.baselineMonth) {
      return { intent: "clarify", confidence: "medium", entities: { primaryMonth: analytics.primaryMonth }, answer: `С кой месец да сравня ${assistantMonthName(analytics.primaryMonth)}?` };
    }
    if (!analytics.primaryMonth || !analytics.baselineMonth) {
      return { intent: "clarify", confidence: "medium", entities: { reason: "missing_baseline" }, answer: "Кои два месеца да сравня?" };
    }
    return {
      intent: "month_comparison",
      confidence: "high",
      entities: analytics,
      answer: buildMonthComparisonAnswer(data, analytics.primaryMonth, analytics.baselineMonth, analytics.year, analytics.metricFocus, financeUnlocked)
    };
  }

  if (matchesAny(normalized, ["следващия клиент", "следващият клиент", "следващия гост", "следващата резервация", "кой идва следващ", "кой пристига следващ"])) {
    return { intent: "next_guest", confidence: "high", answer: buildNextGuestAssistantAnswer(data) };
  }

  if (matchesAny(normalized, ["пристига днес", "пристигащи днес", "днес кой идва", "кой идва днес"])) {
    return { intent: "arrivals_today", confidence: "high", answer: buildArrivalsForDateAssistantAnswer(data, todayISO(), "днес") };
  }

  if (matchesAny(normalized, ["пристига утре", "пристигащи утре", "утрешни пристигащи", "кой идва утре"])) {
    return { intent: "arrivals_tomorrow", confidence: "high", answer: buildArrivalsForDateAssistantAnswer(data, addDaysISO(todayISO(), 1), "утре") };
  }

  if (matchesAny(normalized, ["подобри", "как мога"])) {
    return { intent: "finance_summary", confidence: "high", answer: buildImprovementAssistantAnswer(data, activeMonth, financeUnlocked) };
  }

  if (matchesAny(normalized, ["слаби дни", "ниска заетост"])) {
    return { intent: "occupancy", confidence: "high", answer: buildLowOccupancyAssistantAnswer(data, activeMonth) };
  }

  if (normalized.includes("уикенд")) {
    if (normalized.includes("слаб")) {
      return { intent: "weekend_status", confidence: "high", answer: buildWeakWeekendAssistantAnswer(data, activeMonth) };
    }
    return { intent: normalized.includes("свобод") ? "free_rooms" : "weekend_status", confidence: "high", answer: buildWeekendStatusAssistantAnswer(data) };
  }

  if (normalized.includes("свобод")) {
    return { intent: "free_rooms", confidence: "high", answer: buildFreeRoomsAssistantAnswer(data, todayISO()) };
  }

  if (normalized.includes("без капаро") || normalized.includes("нямат капаро")) {
    return { intent: "no_deposit", confidence: "high", answer: buildNoDepositAssistantAnswer(data, activeMonth) };
  }

  if (normalized.includes("заетост")) {
    const requestedMonth = extractAssistantMonths(normalized)[0];
    const month = requestedMonth ? monthKeyFromParts(activeMonth, requestedMonth) : activeMonth;
    return { intent: "occupancy", confidence: "high", entities: { month }, answer: buildOccupancyAssistantAnswer(data, month) };
  }

  if (matchesAny(normalized, ["как върви", "накратко", "обобщение", "приход", "разход", "нетно", "резултат"])) {
    const requestedMonth = extractAssistantMonths(normalized)[0];
    const month = requestedMonth ? monthKeyFromParts(activeMonth, requestedMonth) : activeMonth;
    return { intent: "finance_summary", confidence: "high", entities: { month }, answer: buildFinanceSummaryAssistantAnswer(data, month, financeUnlocked, normalized) };
  }

  if (matchesAny(normalized, ["сравни", "спрямо", "срещу", "разликата", "между"])) {
    return { intent: "clarify", confidence: "medium", answer: "Кои два месеца да сравня?" };
  }

  return {
    intent: "unknown",
    confidence: "low",
    answer: "Не разбрах въпроса.\nОпитай с: „кой пристига днес“, „как е уикенда“, „май спрямо април“ или „свободни стаи“."
  };
}

function logAssistantRoute(result: AssistantRouteResult) {
  if (process.env.NODE_ENV !== "production") {
    console.debug("[Hotel Lidia Assistant]", {
      intent: result.intent,
      confidence: result.confidence,
      entities: result.entities
    });
  }
}

function matchesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function monthKeyFromParts(activeMonth: string, monthNumber: number): string {
  const year = Number(activeMonth.slice(0, 4)) || new Date().getFullYear();
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

type AssistantMetricFocus = "all" | "revenue" | "expenses" | "net" | "occupancy";
type AssistantAnalyticsQuery = {
  intent: "month_comparison";
  primaryMonth?: number;
  baselineMonth?: number;
  year: number;
  metricFocus: AssistantMetricFocus;
  comparisonRequested: boolean;
};

function parseAssistantAnalyticsQuery(input: string, activeMonth: string): AssistantAnalyticsQuery | null {
  const normalized = normalizeGuestText(input).replace(/\bvs\b/g, " спрямо ");
  const comparisonRequested = detectComparisonIntent(normalized);
  const months = extractAssistantMonths(normalized);
  if (!comparisonRequested && months.length < 2) return null;
  const activeYear = Number(activeMonth.slice(0, 4)) || new Date().getFullYear();
  const explicitYear = Number(normalized.match(/\b(20\d{2})\b/)?.[1] || 0);
  return {
    intent: "month_comparison",
    primaryMonth: months[0],
    baselineMonth: months[1],
    year: explicitYear || activeYear,
    metricFocus: detectMetricFocus(normalized),
    comparisonRequested
  };
}

function detectComparisonIntent(value: string): boolean {
  return /(спрямо|сравни|сравнение|срещу|разликата|разлика|между| vs |\bvs\b)/i.test(` ${value} `);
}

function extractAssistantMonths(value: string): number[] {
  const found: number[] = [];
  const pattern = /януари|яну\.?|февруари|фев\.?|март|мар\.?|април|апр\.?|май|юни|юли|август|авг\.?|септември|сеп\.?|октомври|окт\.?|ноември|ное\.?|декември|дек\.?/gi;
  for (const match of value.matchAll(pattern)) {
    const month = assistantMonthNumber(match[0]);
    if (month) found.push(month);
  }
  return found;
}

function assistantMonthNumber(value: string): number | null {
  const key = normalizeGuestText(value).replace(/\./g, "");
  const months: Record<string, number> = {
    "януари": 1,
    "яну": 1,
    "февруари": 2,
    "фев": 2,
    "март": 3,
    "мар": 3,
    "април": 4,
    "апр": 4,
    "май": 5,
    "юни": 6,
    "юли": 7,
    "август": 8,
    "авг": 8,
    "септември": 9,
    "сеп": 9,
    "октомври": 10,
    "окт": 10,
    "ноември": 11,
    "ное": 11,
    "декември": 12,
    "дек": 12
  };
  return months[key] || null;
}

function detectMetricFocus(value: string): AssistantMetricFocus {
  if (value.includes("заетост")) return "occupancy";
  if (value.includes("разход")) return "expenses";
  if (value.includes("нетно") || value.includes("резултат")) return "net";
  if (value.includes("приход")) return "revenue";
  return "all";
}

function buildMonthComparisonAnswer(data: AppData, primaryMonthNumber: number, baselineMonthNumber: number, year: number, metricFocus: AssistantMetricFocus, financeUnlocked: boolean): string {
  const primaryMonth = `${year}-${String(primaryMonthNumber).padStart(2, "0")}`;
  const baselineMonth = `${year}-${String(baselineMonthNumber).padStart(2, "0")}`;
  const primary = getAssistantMonthMetrics(data, primaryMonth);
  const baseline = getAssistantMonthMetrics(data, baselineMonth);
  const primaryLabel = `${assistantMonthName(primaryMonthNumber)} ${year}`;
  const baselineLabel = `${assistantMonthName(baselineMonthNumber)} ${year}`;
  const rows: string[] = [`${primaryLabel} спрямо ${baselineLabel}:`];
  const metrics: Array<Exclude<AssistantMetricFocus, "all">> = metricFocus === "all" ? ["revenue", "expenses", "net", "occupancy"] : [metricFocus];

  for (const metric of metrics) {
    rows.push(formatAssistantMetricComparison(metric, primary[metric], baseline[metric], financeUnlocked));
  }

  rows.push(buildAssistantComparisonConclusion(primaryLabel, primary, baseline, metricFocus));
  return rows.join("\n");
}

function getAssistantMonthMetrics(data: AppData, month: string): Record<Exclude<AssistantMetricFocus, "all">, number> {
  const summary = calculateFinanceSummary(data, month);
  return {
    revenue: getFinanceRevenue(summary),
    expenses: summary.expenses,
    net: summary.net,
    occupancy: calculateOccupancyPercent(data, month)
  };
}

function formatAssistantMetricComparison(metric: Exclude<AssistantMetricFocus, "all">, primary: number, baseline: number, financeUnlocked: boolean): string {
  const label = assistantMetricLabel(metric);
  if (!financeUnlocked && metric !== "occupancy") return `- ${label}: заключено във Финанси`;
  if (metric === "occupancy") {
    return `- ${label}: ${formatPercent(primary)} (${formatSignedPoints(primary - baseline)})`;
  }
  const delta = baseline === 0 ? "няма база за сравнение" : formatSignedPercent(((primary - baseline) / Math.abs(baseline)) * 100);
  return `- ${label}: ${eurWhole(primary)} (${delta})`;
}

function assistantMetricLabel(metric: Exclude<AssistantMetricFocus, "all">): string {
  const labels = {
    revenue: "Общи приходи",
    expenses: "Разходи",
    net: "Нетно",
    occupancy: "Заетост"
  };
  return labels[metric];
}

function assistantMonthName(monthNumber: number): string {
  const names = ["Януари", "Февруари", "Март", "Април", "Май", "Юни", "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември"];
  return names[monthNumber - 1] || `Месец ${monthNumber}`;
}

function formatSignedPercent(value: number): string {
  if (!Number.isFinite(value)) return "няма база за сравнение";
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function formatSignedPoints(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded} п.п.`;
}

function buildAssistantComparisonConclusion(primaryLabel: string, primary: Record<Exclude<AssistantMetricFocus, "all">, number>, baseline: Record<Exclude<AssistantMetricFocus, "all">, number>, metricFocus: AssistantMetricFocus): string {
  if (metricFocus !== "all") return "";
  const strongerRevenue = primary.revenue > baseline.revenue;
  const strongerNet = primary.net > baseline.net;
  const strongerOccupancy = primary.occupancy > baseline.occupancy;
  if (strongerRevenue && strongerNet && strongerOccupancy) return `${primaryLabel} изглежда по-силен месец — приходите, нетното и заетостта са нагоре.`;
  if (!strongerRevenue && !strongerNet && !strongerOccupancy) return `${primaryLabel} изглежда по-слаб месец — приходите, нетното и заетостта са надолу.`;
  if (strongerRevenue || strongerOccupancy) return `${primaryLabel} има положителен сигнал, но си струва да се следят разходите и нетният резултат.`;
  return `${primaryLabel} е смесен месец. Най-добре е да се гледат заетостта и нетният резултат заедно.`;
}

function buildNextGuestAssistantAnswer(data: AppData): string {
  const today = todayISO();
  const next = Object.values(data.reservations)
    .filter((reservation) => reservation.status !== "cancelled" && reservation.checkout >= today)
    .sort((a, b) => a.checkin.localeCompare(b.checkin) || a.guestName.localeCompare(b.guestName, "bg"))[0];

  if (!next) return "Няма предстоящи резервации.";

  const arrival = next.checkin === today ? "днес" : next.checkin === addDaysISO(today, 1) ? "утре" : formatBulgarianDateRange(next.checkin, next.checkout);
  return [
    `Следващият гост е ${next.guestName || "без име"}.`,
    `Пристига ${arrival} · ${propertyName(next.propertyId)} · ${roomsLabel(next)}.`,
    next.phone ? `Телефон: ${next.phone}.` : ""
  ].filter(Boolean).join("\n");
}

function buildArrivalsForDateAssistantAnswer(data: AppData, date: string, label: string): string {
  const arrivals = Object.values(data.reservations)
    .filter((reservation) => reservation.status !== "cancelled" && reservation.checkin === date)
    .sort((a, b) => propertyName(a.propertyId).localeCompare(propertyName(b.propertyId), "bg") || roomsLabel(a).localeCompare(roomsLabel(b), "bg", { numeric: true }));

  if (!arrivals.length) return `Няма пристигащи ${label}.`;

  return [
    `Пристигащи ${label}: ${arrivals.length}`,
    ...arrivals.slice(0, 8).map((reservation) => `- ${reservation.guestName || "Без име"} · ${propertyName(reservation.propertyId)} · ${roomsLabel(reservation)}${reservation.depositAmount > 0 ? "" : " · без капаро"}`)
  ].join("\n");
}

function buildWeekendStatusAssistantAnswer(data: AppData): string {
  const weekend = getUpcomingWeekendDates();
  const reservations = Object.values(data.reservations).filter((reservation) => reservation.status !== "cancelled");
  const rows = weekend.map((date) => ({ date, occupancy: getCombinedDayOccupancy(reservations, date) }));
  const totalOccupied = rows.reduce((sum, row) => sum + row.occupancy.occupied, 0);
  const totalCapacity = rows.reduce((sum, row) => sum + row.occupancy.total, 0);
  const percent = totalCapacity ? Math.round((totalOccupied / totalCapacity) * 100) : 0;
  const freeRooms = getFreeRoomsForDates(reservations, weekend);
  const arrivals = reservations.filter((reservation) => weekend.includes(reservation.checkin)).length;
  const departures = reservations.filter((reservation) => weekend.includes(reservation.checkout)).length;

  return [
    `Този уикенд е ${percent}% зает.`,
    `Пристигащи: ${arrivals}. Заминаващи: ${departures}.`,
    freeRooms.length ? `Свободни стаи:\n${freeRooms.slice(0, 12).map((room) => `- ${room}`).join("\n")}` : "Няма свободни стаи.",
    percent < 35 ? "Уикендът изглежда слаб." : percent >= 80 ? "Уикендът изглежда силен." : ""
  ].filter(Boolean).join("\n");
}

function buildFreeRoomsAssistantAnswer(data: AppData, date: string): string {
  const reservations = Object.values(data.reservations).filter((reservation) => reservation.status !== "cancelled");
  const freeRooms = getFreeRoomsForDates(reservations, [date]);
  if (!freeRooms.length) return "Днес няма свободни стаи.";
  return [`Свободни стаи днес:`, ...freeRooms.map((room) => `- ${room}`)].join("\n");
}

function buildOccupancyAssistantAnswer(data: AppData, month: string): string {
  return `Заетостта за ${formatMonthLabel(month)} е ${formatPercent(calculateOccupancyPercent(data, month))}.`;
}

function buildFinanceSummaryAssistantAnswer(data: AppData, month: string, financeUnlocked: boolean, normalizedQuery: string): string {
  if (matchesAny(normalizedQuery, ["как върви", "накратко", "обобщение"])) {
    return buildMonthlyOverviewAssistantAnswer(data, month, financeUnlocked);
  }

  const summary = calculateFinanceSummary(data, month);
  const revenue = getFinanceRevenue(summary);
  const occupancy = calculateOccupancyPercent(data, month);
  const monthLabel = formatMonthLabel(month);

  if (normalizedQuery.includes("приход")) {
    return financeUnlocked ? `Общите приходи за ${monthLabel} са ${eurWhole(revenue)}.` : "Финансите са заключени.";
  }
  if (normalizedQuery.includes("разход")) {
    return financeUnlocked ? `Разходите за ${monthLabel} са ${eurWhole(summary.expenses)}.` : "Финансите са заключени.";
  }
  if (normalizedQuery.includes("нетно") || normalizedQuery.includes("резултат")) {
    return financeUnlocked ? `Нетният резултат за ${monthLabel} е ${eurWhole(summary.net)}.` : "Финансите са заключени.";
  }

  return [
    `${monthLabel} накратко:`,
    `Заетост: ${formatPercent(occupancy)}.`,
    financeUnlocked ? `Общи приходи: ${eurWhole(revenue)}. Разходи: ${eurWhole(summary.expenses)}. Нетно: ${eurWhole(summary.net)}.` : "Финансите са заключени.",
    activeMonthReservations(data, month).length ? `Резервации с чек-ин през месеца: ${activeMonthReservations(data, month).length}.` : "Няма резервации с чек-ин през месеца."
  ].join("\n");
}

function getUpcomingWeekendDates(): string[] {
  const today = todayISO();
  const date = parseISODate(today);
  const day = date.getDay();
  const daysUntilFriday = (5 - day + 7) % 7;
  const friday = addDaysISO(today, daysUntilFriday);
  return [friday, addDaysISO(friday, 1), addDaysISO(friday, 2)];
}

function getFreeRoomsForDates(reservations: Reservation[], dates: string[]): string[] {
  const free: string[] = [];
  for (const property of PROPERTIES) {
    const wholeBooked = dates.some((date) => reservations.some((reservation) => reservation.propertyId === property.id && reservation.rooms.includes("all") && activeOnDate(reservation.checkin, reservation.checkout, date)));
    if (wholeBooked) continue;
    for (const room of property.rooms) {
      const occupied = dates.some((date) => reservations.some((reservation) => reservation.propertyId === property.id && !reservation.rooms.includes("all") && reservation.rooms.some((reservedRoom) => reservedRoom === room) && activeOnDate(reservation.checkin, reservation.checkout, date)));
      if (!occupied) free.push(`${property.name} · стая ${room}`);
    }
  }
  return free;
}

function buildMonthlyOverviewAssistantAnswer(data: AppData, month: string, financeUnlocked: boolean): string {
  const summary = calculateFinanceSummary(data, month);
  const revenue = getFinanceRevenue(summary);
  const occupancy = calculateOccupancyPercent(data, month);
  const activeCount = activeMonthReservations(data, month).length;
  const moneyLine = financeUnlocked
    ? `Общи приходи: ${eurWhole(revenue)}. Разходи: ${eurWhole(summary.expenses)}. Нетно: ${eurWhole(summary.net)}.`
    : "Финансовите суми са заключени. Отключи Финанси, ако искаш асистентът да ги показва.";

  return [
    `${formatMonthLabel(month)} накратко:`,
    `Заетост: ${formatPercent(occupancy)}. Активни резервации с чек-ин през месеца: ${activeCount}.`,
    moneyLine,
    occupancy < 30
      ? "Месецът изглежда слаб като заетост. Има смисъл да се прегледат празните дни и уикендите."
      : occupancy >= 75
        ? "Месецът изглежда силен като заетост. Внимавай основно за резервации без капаро."
        : "Месецът изглежда среден. Най-полезно е да се следят слабите дни и резервациите без капаро."
  ].join("\n");
}

function buildNoDepositAssistantAnswer(data: AppData, month: string): string {
  const today = todayISO();
  const reservations = activeMonthReservations(data, month)
    .filter((reservation) => reservation.checkout >= today && reservation.depositAmount <= 0)
    .sort((a, b) => a.checkin.localeCompare(b.checkin));

  if (!reservations.length) {
    return `За ${formatMonthLabel(month)} не виждам активни предстоящи резервации без капаро.`;
  }

  const preview = reservations.slice(0, 6).map((reservation) =>
    `- ${reservation.guestName || "Без име"} · ${formatBulgarianDateRange(reservation.checkin, reservation.checkout)} · ${propertyName(reservation.propertyId)} · ${roomsLabel(reservation)}`
  );
  const extra = reservations.length > preview.length ? `\nИма още ${reservations.length - preview.length} резервации без капаро.` : "";
  return [`Резервации без капаро за ${formatMonthLabel(month)}: ${reservations.length}`, ...preview].join("\n") + extra;
}

function buildLowOccupancyAssistantAnswer(data: AppData, month: string): string {
  const days = monthOccupancyRows(data, month).filter((row) => row.percent < 30);
  if (!days.length) return `Не виждам дни под 30% заетост за ${formatMonthLabel(month)}.`;

  const preview = days.slice(0, 8).map((row) => `- ${formatDayName(row.iso)} ${formatShortDate(row.iso)} · ${row.occupied}/11`);
  const extra = days.length > preview.length ? `\nИма още ${days.length - preview.length} слаби дни.` : "";
  return [`Дни с ниска заетост под 30% за ${formatMonthLabel(month)}:`, ...preview].join("\n") + extra;
}

function buildWeakWeekendAssistantAnswer(data: AppData, month: string): string {
  const weekends = monthOccupancyRows(data, month).filter((row) => {
    const day = parseISODate(row.iso).getDay();
    return (day === 5 || day === 6) && row.percent < 50;
  });
  if (!weekends.length) return `Не виждам слаби петъци/съботи под 50% за ${formatMonthLabel(month)}.`;

  return [
    `Слаби уикенд дни за ${formatMonthLabel(month)}:`,
    ...weekends.slice(0, 8).map((row) => `- ${formatDayName(row.iso)} ${formatShortDate(row.iso)} · ${row.occupied}/11`)
  ].join("\n");
}

function buildImprovementAssistantAnswer(data: AppData, month: string, financeUnlocked: boolean): string {
  const lowDays = monthOccupancyRows(data, month).filter((row) => row.percent < 30).length;
  const noDeposit = activeMonthReservations(data, month).filter((reservation) => reservation.depositAmount <= 0).length;
  const summary = calculateFinanceSummary(data, month);
  const ideas = [
    lowDays > 0
      ? `Има ${lowDays} дни с ниска заетост. Най-лесният фокус е директна продажба или промоция точно за тях.`
      : "Няма много слаби дни, така че фокусът може да е върху по-добро потвърждение и капаро.",
    noDeposit > 0
      ? `Има ${noDeposit} резервации без капаро. Добре е първо те да се потвърдят.`
      : "Резервациите с капаро изглеждат добре под контрол.",
    "За Booking/външни канали отваряй само безопасни свободни дати, когато календарът показва реална свободна наличност."
  ];

  if (financeUnlocked) {
    ideas.unshift(`Нетният резултат за ${formatMonthLabel(month)} е ${eurWhole(summary.net)}.`);
  }

  return [`Идеи за подобрение за ${formatMonthLabel(month)}:`, ...ideas.map((idea) => `- ${idea}`)].join("\n");
}

function activeMonthReservations(data: AppData, month: string): Reservation[] {
  return Object.values(data.reservations)
    .filter((reservation) => reservation.status !== "cancelled" && monthKey(reservation.checkin) === month)
    .sort((a, b) => a.checkin.localeCompare(b.checkin));
}

function monthOccupancyRows(data: AppData, month: string): Array<{ iso: string; occupied: number; percent: number }> {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const reservations = Object.values(data.reservations).filter((reservation) => reservation.status !== "cancelled");
  return Array.from({ length: days }, (_, index) => {
    const iso = `${month}-${String(index + 1).padStart(2, "0")}`;
    const occupancy = getCombinedDayOccupancy(reservations, iso);
    return { iso, occupied: occupancy.occupied, percent: occupancy.total > 0 ? occupancy.occupied / occupancy.total * 100 : 0 };
  });
}

type FinanceInsightCategory = "milestone" | "comparison" | "ratio" | "occupancy" | "rooms" | "operations";
type FinanceInsight = {
  text: string;
  category: FinanceInsightCategory;
  priority: number;
};

function buildMonthlyFinanceInsights(data: AppData, month: string): string[] {
  const current = calculateFinanceSummary(data, month);
  const previousMonth = shiftMonthKey(month, -1);
  const previous = calculateFinanceSummary(data, previousMonth);
  const previousMonthLabel = formatMonthLabel(previousMonth);
  const revenue = getFinanceRevenue(current);
  const previousRevenue = getFinanceRevenue(previous);
  const occupancy = calculateOccupancyPercent(data, month);
  const previousOccupancy = calculateOccupancyPercent(data, previousMonth);
  const currentRows = monthOccupancyRows(data, month);
  const previousRows = monthOccupancyRows(data, previousMonth);
  const insights: FinanceInsight[] = [];

  addRevenueMilestoneInsight(insights, revenue);
  addPercentComparisonInsight(insights, "Приходите", revenue, previousRevenue, previousMonthLabel, "comparison", 92);
  addMoneyDeltaInsight(insights, "Приходите", revenue, previousRevenue, previousMonthLabel, 86);
  addPercentComparisonInsight(insights, "Разходите", current.expenses, previous.expenses, previousMonthLabel, "comparison", 84, true);
  addNetComparisonInsight(insights, current.net, previous.net, previousMonthLabel);
  addExpenseRatioInsight(insights, current);
  addOccupancyComparisonInsights(insights, occupancy, previousOccupancy, currentRows, previousRows, previousMonthLabel);
  addRoomPerformanceInsights(insights, data, month, previousMonth);
  addOperationalFinanceInsights(insights, data, month, currentRows);

  const selected = selectFinanceInsights(insights);
  return selected.length ? selected.map((insight) => insight.text) : ["Няма достатъчно сравними данни за качествен месечен извод."];
}

function addRevenueMilestoneInsight(insights: FinanceInsight[], revenue: number) {
  if (revenue <= 0) return;
  const thresholds = [5000, 10000, 20000, 50000, 100000, 200000];
  const next = thresholds.find((threshold) => threshold > revenue);
  if (!next) return;
  const remaining = next - revenue;
  const closeness = remaining / next;
  if (closeness <= 0.2) {
    insights.push({
      category: "milestone",
      priority: 96,
      text: `Остават ${eurWhole(remaining)} до ${eurWhole(next)} приходи.`
    });
    insights.push({
      category: "milestone",
      priority: 78,
      text: `Месецът е на ${formatPercent(revenue / next * 100)} от прага ${eurWhole(next)}.`
    });
  }
}

function addPercentComparisonInsight(insights: FinanceInsight[], label: string, current: number, previous: number, previousMonthLabel: string, category: FinanceInsightCategory, priority: number, lowerIsBetter = false) {
  const change = percentChange(current, previous);
  if (change === null || Math.abs(change) < 3) return;
  const direction = change >= 0 ? "над" : "под";
  const sentimentPriority = lowerIsBetter && change < 0 ? priority + 4 : priority;
  insights.push({
    category,
    priority: sentimentPriority,
    text: `${label} са с ${formatPercent(Math.abs(change))} ${direction} ${previousMonthLabel}.`
  });
}

function addMoneyDeltaInsight(insights: FinanceInsight[], label: string, current: number, previous: number, previousMonthLabel: string, priority: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return;
  const delta = Math.round(current - previous);
  if (Math.abs(delta) < 100) return;
  insights.push({
    category: "comparison",
    priority,
    text: `${label} са с ${eurWhole(Math.abs(delta))} ${delta >= 0 ? "повече" : "по-малко"} от ${previousMonthLabel}.`
  });
}

function addNetComparisonInsight(insights: FinanceInsight[], currentNet: number, previousNet: number, previousMonthLabel: string) {
  if (!Number.isFinite(currentNet) || !Number.isFinite(previousNet) || previousNet === 0) return;
  const delta = Math.round(currentNet - previousNet);
  if (Math.abs(delta) < 100) return;
  insights.push({
    category: "comparison",
    priority: delta >= 0 ? 82 : 88,
    text: `Нетният резултат е с ${eurWhole(Math.abs(delta))} ${delta >= 0 ? "по-добър" : "по-слаб"} спрямо ${previousMonthLabel}.`
  });
}

function addExpenseRatioInsight(insights: FinanceInsight[], summary: FinanceSummary) {
  const ratio = getExpenseRatio(summary);
  if (ratio === null) return;
  if (ratio >= 45) {
    insights.push({
      category: "ratio",
      priority: 90,
      text: `Разходите са ${formatPercent(ratio)} от приходите — натискът върху нетния резултат е висок.`
    });
  } else if (ratio <= 20 && getFinanceRevenue(summary) > 0) {
    insights.push({
      category: "ratio",
      priority: 74,
      text: `Разходите са само ${formatPercent(ratio)} от приходите — маржът изглежда здрав.`
    });
  }
}

function addOccupancyComparisonInsights(insights: FinanceInsight[], occupancy: number, previousOccupancy: number, rows: Array<{ iso: string; occupied: number; percent: number }>, previousRows: Array<{ iso: string; occupied: number; percent: number }>, previousMonthLabel: string) {
  if (previousOccupancy > 0) {
    const diff = Math.round(occupancy - previousOccupancy);
    if (Math.abs(diff) >= 3) {
      insights.push({
        category: "occupancy",
        priority: 88,
        text: `Заетостта е с ${Math.abs(diff)} п.п. ${diff > 0 ? "над" : "под"} ${previousMonthLabel}.`
      });
    }
  }

  const fullDays = rows.filter((row) => row.percent >= 99).length;
  const previousFullDays = previousRows.filter((row) => row.percent >= 99).length;
  const fullDayDelta = fullDays - previousFullDays;
  if (Math.abs(fullDayDelta) >= 2) {
    insights.push({
      category: "occupancy",
      priority: 83,
      text: `Има ${Math.abs(fullDayDelta)} ${fullDayDelta > 0 ? "повече" : "по-малко"} напълно заети дни спрямо ${previousMonthLabel}.`
    });
  }

  const emptyDays = rows.filter((row) => row.percent <= 0).length;
  if (emptyDays >= 4) {
    insights.push({
      category: "operations",
      priority: 80,
      text: `Има ${emptyDays} напълно свободни дни — добър фокус за директни оферти.`
    });
  }

  const weekendAverage = averageOccupancy(rows.filter((row) => isWeekendDate(row.iso)));
  const weekdayAverage = averageOccupancy(rows.filter((row) => !isWeekendDate(row.iso)));
  if (weekendAverage >= 80) {
    insights.push({
      category: "occupancy",
      priority: 79,
      text: `Уикендите са почти запълнени: средно ${formatPercent(weekendAverage)} заетост.`
    });
  } else if (weekendAverage > 0 && weekendAverage < 45) {
    insights.push({
      category: "operations",
      priority: 82,
      text: `Уикендите са под 45% заетост — има място за бърза промоция.`
    });
  }

  if (weekdayAverage > 0 && weekdayAverage + 20 < weekendAverage) {
    insights.push({
      category: "operations",
      priority: 72,
      text: `Делниците изостават с ${Math.round(weekendAverage - weekdayAverage)} п.п. спрямо уикендите.`
    });
  }
}

function addRoomPerformanceInsights(insights: FinanceInsight[], data: AppData, month: string, previousMonth: string) {
  const currentTop = getTopRoomForMonth(data, month);
  const previousTop = getTopRoomForMonth(data, previousMonth);
  if (currentTop) {
    insights.push({
      category: "rooms",
      priority: 76,
      text: `Най-търсената стая е ${currentTop.room} с ${currentTop.nights} заети нощувки.`
    });
  }
  if (currentTop && previousTop && currentTop.room !== previousTop.room) {
    insights.push({
      category: "rooms",
      priority: 70,
      text: `Миналия месец водеше ${previousTop.room}, а сега води ${currentTop.room}.`
    });
  }

  const villaOccupancy = calculatePropertyMonthOccupancy(data, month, "villa");
  const houseOccupancy = calculatePropertyMonthOccupancy(data, month, "house");
  if (Math.abs(villaOccupancy - houseOccupancy) >= 12) {
    insights.push({
      category: "rooms",
      priority: 73,
      text: `${villaOccupancy > houseOccupancy ? "Вилата" : "Къщата"} има по-силна заетост с ${Math.round(Math.abs(villaOccupancy - houseOccupancy))} п.п. разлика.`
    });
  }
}

function addOperationalFinanceInsights(insights: FinanceInsight[], data: AppData, month: string, rows: Array<{ iso: string; occupied: number; percent: number }>) {
  const noDeposit = activeMonthReservations(data, month).filter((reservation) => reservation.depositAmount <= 0).length;
  if (noDeposit > 0) {
    insights.push({
      category: "operations",
      priority: 94,
      text: `Има ${noDeposit} резервации без капаро — добре е да се потвърдят.`
    });
  }

  const weakPeriods = getWeakOccupancyRuns(rows);
  if (weakPeriods.length) {
    const first = weakPeriods[0];
    insights.push({
      category: "operations",
      priority: 87,
      text: `Слаб период: ${formatShortDate(first.start)}–${formatShortDate(first.end)} е под 30% заетост.`
    });
  }

  const half = Math.ceil(rows.length / 2);
  const firstHalf = averageOccupancy(rows.slice(0, half));
  const secondHalf = averageOccupancy(rows.slice(half));
  if (firstHalf > 0 && secondHalf > 0 && Math.abs(secondHalf - firstHalf) >= 10) {
    insights.push({
      category: "occupancy",
      priority: 75,
      text: `Втората половина на месеца е ${secondHalf > firstHalf ? "по-силна" : "по-слаба"} с ${Math.round(Math.abs(secondHalf - firstHalf))} п.п.`
    });
  }
}

function selectFinanceInsights(insights: FinanceInsight[]): FinanceInsight[] {
  const seen = new Set<string>();
  const categoryCounts = new Map<FinanceInsightCategory, number>();
  const selected: FinanceInsight[] = [];
  for (const insight of insights.sort((a, b) => b.priority - a.priority)) {
    if (seen.has(insight.text)) continue;
    const categoryCount = categoryCounts.get(insight.category) || 0;
    if (categoryCount >= 2) continue;
    selected.push(insight);
    seen.add(insight.text);
    categoryCounts.set(insight.category, categoryCount + 1);
    if (selected.length >= 8) break;
  }
  return selected;
}

function averageOccupancy(rows: Array<{ percent: number }>): number {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + row.percent, 0) / rows.length;
}

function isWeekendDate(isoDate: string): boolean {
  const day = parseISODate(isoDate).getDay();
  return day === 0 || day === 5 || day === 6;
}

function getTopRoomForMonth(data: AppData, month: string): { room: string; nights: number } | null {
  const counts = new Map<string, number>();
  const reservations = Object.values(data.reservations).filter((reservation) => reservation.status !== "cancelled");
  for (const reservation of reservations) {
    const property = PROPERTIES.find((item) => item.id === reservation.propertyId);
    if (!property) continue;
    const nightsInMonth = eachNight(reservation.checkin, reservation.checkout).filter((night) => monthKey(night) === month).length;
    if (nightsInMonth <= 0) continue;
    const rooms = reservation.rooms.includes("all") ? property.rooms : reservation.rooms.map(String);
    for (const room of rooms) {
      const key = `стая ${room}`;
      counts.set(key, (counts.get(key) || 0) + nightsInMonth);
    }
  }
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "bg", { numeric: true }));
  return ranked[0] ? { room: ranked[0][0], nights: ranked[0][1] } : null;
}

function calculatePropertyMonthOccupancy(data: AppData, month: string, propertyId: PropertyId): number {
  const property = PROPERTIES.find((item) => item.id === propertyId);
  if (!property) return 0;
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const reservations = Object.values(data.reservations).filter((reservation) => reservation.status !== "cancelled");
  const occupied = Array.from({ length: days }, (_, index) => {
    const iso = `${month}-${String(index + 1).padStart(2, "0")}`;
    const propertyOccupancy = getPropertyDayOccupancies(reservations, iso).find((item) => item.propertyId === propertyId);
    return propertyOccupancy?.occupied || 0;
  }).reduce((sum, value) => sum + value, 0);
  return property.rooms.length > 0 ? occupied / (property.rooms.length * days) * 100 : 0;
}

function getWeakOccupancyRuns(rows: Array<{ iso: string; percent: number }>): Array<{ start: string; end: string; length: number }> {
  const runs: Array<{ start: string; end: string; length: number }> = [];
  let current: { start: string; end: string; length: number } | null = null;
  for (const row of rows) {
    if (row.percent < 30) {
      current = current
        ? { start: current.start, end: row.iso, length: current.length + 1 }
        : { start: row.iso, end: row.iso, length: 1 };
    } else if (current) {
      if (current.length >= 3) runs.push(current);
      current = null;
    }
  }
  if (current && current.length >= 3) runs.push(current);
  return runs.sort((a, b) => b.length - a.length);
}

function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
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





