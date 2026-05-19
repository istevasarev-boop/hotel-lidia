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

## Tests

```bash
npm run test
```

The tests cover booking conflict logic, whole-property reservations, overlapping dates, edit/delete behavior, and checkout date exclusivity.
