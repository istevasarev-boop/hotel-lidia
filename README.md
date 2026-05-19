# Hotel Lidia

Modern PWA for Hotel Lidia reservations and finances.

## What Stays Compatible

- Firebase Realtime Database path: `lydia_hotel_v1`
- Backup path: `lydia_hotel_v1_backups`
- Existing reservation data/schema is preserved.
- External Firebase shape remains compatible with the old HTML app:
  - `reservationMasters/{groupId}`
  - `reservations/{villa|house}/{YYYY-MM}[]`
  - `finances/incomes/{YYYY-MM}[]`
  - `finances/expenses/{YYYY-MM}[]`

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` from `.env.example`.

3. Add the Firebase web app values:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_DATABASE_URL=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

4. Run locally:

```bash
npm run dev
```

For phone testing on the same Wi-Fi:

```bash
npm run dev:phone
```

## Firebase Auth Setup

1. Open Firebase Console.
2. Go to `Authentication` -> `Sign-in method`.
3. Enable `Email/Password`.
4. Go to `Authentication` -> `Users`.
5. Add approved users only, for example your account and your mother's account.
6. After Vercel deploy, go to `Authentication` -> `Settings` -> `Authorized domains`.
7. Add the Vercel production domain, for example `hotel-lidia.vercel.app`.

The app shows a login screen until a Firebase Auth user signs in.

## Firebase Realtime Database Rules

Use authenticated access for the production app:

```json
{
  "rules": {
    "lydia_hotel_v1": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "lydia_hotel_v1_backups": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

This does not change data schema. It only requires users to log in.

## Vercel Deployment

1. Push this project to GitHub.
2. Open Vercel and import the GitHub repository.
3. In Vercel Project Settings -> Environment Variables, add:

```txt
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_DATABASE_URL
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

4. Use the values from Firebase Console -> Project settings -> General -> Your apps -> Web app config.
5. Deploy.
6. Copy the Vercel production domain.
7. Add that domain to Firebase Authentication authorized domains.
8. Open the Vercel URL on phone/desktop and log in.

## PWA / Phone Install

The app includes:

- `public/manifest.json`
- `public/sw.js`
- mobile viewport metadata

After deploying to HTTPS on Vercel, open the site on the phone and use:

- iPhone Safari: Share -> Add to Home Screen
- Android Chrome: Install app / Add to Home screen

## Booking.com iCal Availability MVP

Booking.com availability is derived from the normal Hotel Lidia calendar. The calendar remains the operational source of truth: reservations decide physical occupancy, and the Booking layer only stores how much of the remaining safe inventory the owner intentionally opens to Booking.com.

Mapping:

- Villa SPA: rooms `5`, `9`, `10`
- Villa Balcony: rooms `7`, `8`, `11`
- House SPA: rooms `1`, `3`
- House Balcony: rooms `2`, `4`
- Room `6` is direct-sale only and is excluded from Booking.com.

Rules:

- Closed by default. Missing inventory means blocked on Booking.com.
- Reservations always win. A direct reservation or whole-property reservation automatically blocks Booking.com availability.
- The app calculates physical free rooms from reservations, then clamps opened inventory with `safeInventory = min(openedInventory, physicalFreeInventory)`.
- The app stores only the explicit intent to open inventory in `bookingOpenInventory`; it does not duplicate room occupancy.
- Feed URLs use long random tokens stored in `bookingFeedTokens`.

Feeds:

```txt
/api/ical/villa/spa?token=...
/api/ical/villa/balcony?token=...
/api/ical/house/spa?token=...
/api/ical/house/balcony?token=...
```

Booking.com imports iCal as blocked/unblocked dates. Standard iCal does not reliably express a changing inventory count for one room type, so this MVP safely blocks a type only when the safe inventory is `0`. If exact inventory counts must be pushed to Booking.com, use a certified channel manager or the Booking.com Connectivity API.

Booking.com setup:

1. Open Booking.com Extranet.
2. Go to `Calendar & Pricing` -> `Sync calendars`.
3. Add an iCal connection for each Booking.com room type.
4. Paste the matching feed URL from Calendar -> Booking mode.
5. Wait for Booking.com to refresh the feed. iCal sync is not instant and Booking.com controls refresh timing.

## Tests

```bash
npm run test
```

The tests cover booking conflict logic, whole-property reservations, overlapping dates, edit/delete behavior, and checkout date exclusivity.
