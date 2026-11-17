# Hotel Lidia → Independent Stays SaaS — Project Charter (Draft v0.1)

Status: Discovery only. No production changes authorized.
Baseline: Hotel Lidia commit aa1299bcb1cec9598ddef0787329874b43d43fdc, 2026-11-17.
Goal: Productize existing functions for micro and family-owned accommodation (villas, cabins, guesthouses, small hotels), without adding guest-facing or operational features.

## Non-negotiables
1. Do not modify Hotel Lidia production branch, Vercel project, Firebase data/rules or live integrations for this project.
2. No actual guest or finance data in SaaS development. Use generated synthetic fixtures.
3. Separate SaaS repository, Firebase project, Vercel project and environment credentials before writing product code. This branch holds *planning documents only*.
4. Every change must link to a scoped task, have acceptance tests and be reviewed before merge; no direct production deploys.
5. Maintain current booking and finance behavior through regression tests.
6. No new features in V1, except essential SaaS foundations: organization onboarding, configurable properties and units, authorization, entitlements and billing/invoicing infrastructure where needed.

## Audited risks (source review, not runtime penetration test)
- Fixed Firebase paths: lydia_hotel_v1, lydia_hotel_v1_backups.
- Hardcoded property IDs villa/house and room mapping in domain/reservations/types.ts and domain/booking/availability.ts.
- Whole-object writes in lib/firebase/db.ts and app/api/reservations/route.ts, posing lost-update risk.
- HotelApp.tsx ~306KB, needs modular extraction.
- Auth identity checks lack a generic organization membership authorization layer.
- Booking.com iCal maps to hardcoded inventory; iCal cannot reliably represent all quantities.
- External enquiries and marketing integrations coupled to Villa Lidia URLs and environment snapshots.
- ESTI has separate Firebase tree and revision/ETag guard; keep as optional BG capability.
- Deployed Firebase rules, production runtime behavior, and security posture are not yet verified.

## V1 scope (existing functionality)
- Reservations with calendar, conflict detection, entire-property booking.
- Guest details, booking status and deposits.
- Manual incomes, expenses, occupancy and basic performance.
- Data export/backups.
- Optional gated modules: iCal feeds, ESTI, enquiries, marketing reporting if integration can be generalized safely.

## Revised package pricing proposal (NOT APPROVED / not final)
Basic €14.99/mo: 1–2 units; calendar, reservations, guest/deposit tracking.
Family €29.99/mo: 3–10 units; plus finances, reports, configurable iCal, optional ESTI.
Pro €79.99/mo: up to 25 units; multiple properties, detailed reporting, optional configurable marketing.
Security, backups and data portability are included in EVERY plan. Entitlements enforced server side.

## Proposed architecture
Organization (tenant) > properties > units/room types > reservations; memberships map user to organization and role (owner/manager/staff).
Tenant-scoped DB paths and server-validated requests. Prefer granular atomic writes / transaction safeguards. Avoid physical property IDs as tenant identifiers.
Legacy Hotel Lidia data format remains an import adapter, not target schema. Separate organization-specific backups and exports.
Decision pending: Firebase Realtime Database tenancy vs alternative; compare against product requirements before selecting.

## Workstreams and gates
D0 Discovery: code inventory, dependencies, auth/data path audit, tests, production rule verification by authorized read-only review. Deliver architecture decision record and prioritized backlog.
D1 Isolation: new SaaS repo, separate test Firebase/Vercel, synthetic fixtures, CI checks. No live customer data.
D2 Core extraction: booking, availability, finance, calendar UI; regression parity.
D3 SaaS foundations: tenant model, memberships, rooms, onboarding, granular writes, backups, entitlements and API authorization.
D4 Pilot: 3 distinct synthetic property setups; security isolation tests, concurrency tests, restore drills, mobile UAT; obtain external property consent for any real-data pilot.
D5 Commercial decision: pricing interviews, onboarding friction, payment arrangements, support estimate, viability gate.

## Required acceptance criteria
- No access to other organizations through client SDK, REST, API routes, direct ID guessing or backups.
- Concurrent changes cannot silently delete a valid reservation.
- Booking conflict, checkout exclusivity and full-property booking tests pass.
- Every organization can configure property and room names/IDs without editing source.
- Feature gates are server enforced; hidden UI is not sufficient.
- Backups and restores cannot cross tenants.
- Hotel Lidia production remains unchanged.
- No real bookings or personal guest data in dev/test fixtures.

## Decisions pending
- SaaS name/brand.
- Final plan prices and feature caps.
- Shared multi-tenant Firebase DB vs alternative.
- Payment provider / manual billing pilot.
- iCal/ESTI readiness in V1.
- Source licensing / private repository governance.

## Next deliverable
Detailed module-by-module extraction backlog with estimated effort, dependencies and test coverage. Planning-only until new isolated SaaS workspace exists.
