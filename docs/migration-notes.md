# Migration Notes

## Old App

The old single-file HTML app stored data under:

```txt
lydia_hotel_v1
```

Important old structures:

```txt
reservationMasters/{groupId}
reservations/{buildingKey}/{YYYY-MM}[]
finances/incomes/{YYYY-MM}[]
finances/expenses/{YYYY-MM}[]
```

The old app duplicated reservation data:

- `reservationMasters` had the main reservation.
- `reservations` had one row per booked room per night.
- Linked automatic reservation income used `finances.incomes[*].linkGroupId`.

## New App

The new app intentionally keeps the old Firebase schema. It reads and writes:

```txt
lydia_hotel_v1
```

Backups are written to:

```txt
lydia_hotel_v1_backups
```

The React code converts the old structures into typed objects in memory, but saves back to the original `reservationMasters`, per-night `reservations`, and monthly `finances` objects.

## Compatibility

On load, the app tries:

1. `lydia_hotel_v1`
2. browser local cache under `lidia_hotel_cache_v1`
3. empty data

When Firebase data is loaded, the app converts:

- `buildingKey` to `propertyId`
- `name` to `guestName`
- `advanceAmount` to `depositAmount`
- `reservationMasters` to `reservations`
- manual finance rows to `manualIncomes` / `expenses`

If `reservationMasters` is missing, reservations are reconstructed from the per-night room rows in `reservations/{villa|house}/{YYYY-MM}`. Automatic old income rows with `linkGroupId` are not treated as manual income because reservation revenue is calculated directly from the reservation totals.

## Recommended Safe Migration

1. Export JSON from the old HTML app.
2. Save a copy somewhere safe.
3. Deploy the new app with Firebase env vars, or rely on the original embedded Firebase project config.
4. Open the app.
5. If old Firebase data appears, review the calendar and reservation list.
6. Use JSON export in the new app to create a backup.
7. Keep a copy of the exported JSON before making large edits.

## Data Safety

The new app saves the original-compatible data object and creates backups under:

```txt
lydia_hotel_v1_backups
```

A future hardening step can move reservation writes to Firebase transactions or server-side validation if multiple people will edit reservations at exactly the same time.
