import fs from "node:fs";
import path from "node:path";

const DB_PATH = "lydia_hotel_v1";
const ROOT = process.cwd();

loadDotEnv(path.join(ROOT, ".env.local"));

const databaseUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing NEXT_PUBLIC_FIREBASE_DATABASE_URL.");
  process.exit(1);
}

const response = await fetch(`${databaseUrl}/${DB_PATH}.json`, { cache: "no-store" });
if (!response.ok) {
  console.error(`Firebase read failed: ${response.status}`);
  process.exit(1);
}

const raw = await response.json();
const report = auditLegacyReservations(raw || {});
printReport(report);

function auditLegacyReservations(raw) {
  const masters = raw.reservationMasters && typeof raw.reservationMasters === "object" ? raw.reservationMasters : {};
  const masterIds = new Set(Object.keys(masters));
  const legacyRows = collectLegacyRows(raw.reservations || {});
  const linkedIncomeRows = collectLinkedIncomeRows(raw.finances?.incomes || {});

  const rowOrphans = legacyRows.filter((row) => row.groupId && !masterIds.has(row.groupId));
  const incomeOrphans = linkedIncomeRows.filter((row) => row.linkGroupId && !masterIds.has(row.linkGroupId));
  const deletedFlaggedMasters = Object.entries(masters)
    .filter(([, value]) => Boolean(value?.deleted || value?.deletedAt || value?.status === "deleted"))
    .map(([id, value]) => summarizeMaster(id, value));
  const invalidMasters = Object.entries(masters)
    .map(([id, value]) => validateMaster(id, value))
    .filter(Boolean);
  const duplicateSuspects = findDuplicateSuspects(masters);
  const estimatedRevenueImpact = sum(incomeOrphans.map((row) => row.amount));

  return {
    activeMasterCount: Object.keys(masters).length,
    legacyRowCount: legacyRows.length,
    linkedIncomeCount: linkedIncomeRows.length,
    rowOrphans,
    incomeOrphans,
    deletedFlaggedMasters,
    invalidMasters,
    duplicateSuspects,
    estimatedRevenueImpact
  };
}

function collectLegacyRows(reservations) {
  const rows = [];
  Object.entries(reservations || {}).forEach(([propertyId, months]) => {
    Object.entries(months || {}).forEach(([month, monthRows]) => {
      (Array.isArray(monthRows) ? monthRows : []).forEach((row) => {
        rows.push({
          id: stringValue(row.id),
          groupId: stringValue(row.groupId),
          propertyId,
          month,
          date: stringValue(row.date),
          room: stringValue(row.room),
          guestName: stringValue(row.name),
          amount: numberValue(row.totalAmount || row.advanceAmount)
        });
      });
    });
  });
  return rows;
}

function collectLinkedIncomeRows(incomes) {
  const rows = [];
  Object.entries(incomes || {}).forEach(([month, monthRows]) => {
    (Array.isArray(monthRows) ? monthRows : []).forEach((row, index) => {
      if (!row?.linkGroupId) return;
      rows.push({
        id: `${month}:${index}`,
        month,
        linkGroupId: stringValue(row.linkGroupId),
        date: stringValue(row.date),
        guestName: stringValue(row.note),
        amount: numberValue(row.amount)
      });
    });
  });
  return rows;
}

function validateMaster(id, value) {
  const issues = [];
  const propertyId = stringValue(value.buildingKey);
  const checkin = stringValue(value.checkin);
  const checkout = stringValue(value.checkout);
  const rooms = Array.isArray(value.rooms) ? value.rooms.map(String) : [];

  if (!["villa", "house"].includes(propertyId)) issues.push("invalid property");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin)) issues.push("invalid checkin");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkout)) issues.push("invalid checkout");
  if (checkin && checkout && checkout <= checkin) issues.push("checkout <= checkin");
  if (!rooms.length) issues.push("missing rooms");
  if (propertyId === "villa" && !rooms.every((room) => room === "all" || ["5", "6", "7", "8", "9", "10", "11"].includes(room))) issues.push("invalid villa room");
  if (propertyId === "house" && !rooms.every((room) => room === "all" || ["1", "2", "3", "4"].includes(room))) issues.push("invalid house room");

  return issues.length ? { id, guestName: stringValue(value.name), checkin, checkout, propertyId, rooms, issues } : null;
}

function findDuplicateSuspects(masters) {
  const groups = new Map();
  Object.entries(masters).forEach(([id, value]) => {
    const key = [
      stringValue(value.buildingKey),
      stringValue(value.checkin),
      stringValue(value.checkout),
      Array.isArray(value.rooms) ? value.rooms.map(String).sort().join(",") : "",
      normalizeText(value.name)
    ].join("|");
    groups.set(key, [...(groups.get(key) || []), { id, value }]);
  });

  return Array.from(groups.values())
    .filter((items) => items.length > 1)
    .map((items) => ({
      ids: items.map((item) => item.id),
      guestName: stringValue(items[0].value.name),
      checkin: stringValue(items[0].value.checkin),
      checkout: stringValue(items[0].value.checkout),
      propertyId: stringValue(items[0].value.buildingKey),
      rooms: Array.isArray(items[0].value.rooms) ? items[0].value.rooms.map(String) : []
    }));
}

function summarizeMaster(id, value) {
  return {
    id,
    guestName: stringValue(value.name),
    checkin: stringValue(value.checkin),
    checkout: stringValue(value.checkout),
    propertyId: stringValue(value.buildingKey),
    rooms: Array.isArray(value.rooms) ? value.rooms.map(String) : []
  };
}

function printReport(report) {
  console.log("Hotel Lidia reservation audit");
  console.log(`Active reservationMasters: ${report.activeMasterCount}`);
  console.log(`Legacy calendar rows: ${report.legacyRowCount}`);
  console.log(`Linked reservation income rows: ${report.linkedIncomeCount}`);
  console.log(`Orphan calendar rows: ${report.rowOrphans.length}`);
  console.log(`Orphan linked income rows: ${report.incomeOrphans.length}`);
  console.log(`Deleted-flagged masters: ${report.deletedFlaggedMasters.length}`);
  console.log(`Invalid masters: ${report.invalidMasters.length}`);
  console.log(`Duplicate suspects: ${report.duplicateSuspects.length}`);
  console.log(`Estimated orphan income impact: ${Math.round(report.estimatedRevenueImpact)} EUR`);
  printList("Orphan calendar rows", report.rowOrphans, 20);
  printList("Orphan linked income rows", report.incomeOrphans, 20);
  printList("Deleted-flagged masters", report.deletedFlaggedMasters, 20);
  printList("Invalid masters", report.invalidMasters, 20);
  printList("Duplicate suspects", report.duplicateSuspects, 20);
}

function printList(title, rows, limit) {
  if (!rows.length) return;
  console.log(`\n${title}:`);
  rows.slice(0, limit).forEach((row) => console.log(JSON.stringify(row)));
  if (rows.length > limit) console.log(`... ${rows.length - limit} more`);
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, "utf8").split(/\r?\n/).forEach((line) => {
    const match = /^\s*([^#=\s]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) return;
    const [, key, rawValue] = match;
    if (process.env[key]) return;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  });
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function sum(values) {
  return values.reduce((total, value) => total + numberValue(value), 0);
}

function normalizeText(value) {
  return stringValue(value).trim().toLocaleLowerCase("bg-BG").replace(/\s+/g, " ");
}
