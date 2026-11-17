# SaaS Architecture Decisions — Draft v0.1
Date: 2026-11-17 | Status: Proposed, not implementation approval
Source baseline: aa1299bcb1cec9598ddef0787329874b43d43fdc

## ADR-001: Production and source isolation
**Decision: ACCEPTED for planning.** SaaS implementation must start in a separate PRIVATE repository and distinct Vercel/Firebase projects; never use Hotel Lidia's production credentials, database, or live guest data. The source hotel-lidia GitHub repository is PUBLIC. Discovery notes here must be non-sensitive only. No SaaS code or private environment configuration goes into this public repository.

## ADR-002: No-new-product-features freeze
**Decision: ACCEPTED.** V1 is configurable reuse of existing booking calendar, reservation/guest management, deposits, finance, backups and selected existing integrations. Organizational onboarding, authorization, property configuration, plan entitlements and required billing/admin infrastructure are platform foundations, not permission to extend product scope.

## ADR-003: Tenancy model
**Status: PROPOSED; validation gate required.** One SaaS application with per-organization data paths and organization membership enforced by Firebase security rules and server APIs. Model: organizations/{orgId}/settings; organizations/{orgId}/properties/{propertyId}/units/{unitId}; organizations/{orgId}/reservations/{reservationId}; organizations/{orgId}/finances/{entryId}; organizations/{orgId}/backups/{backupId}; memberships/{uid}/{orgId} = role; subscriptions/{orgId} = entitlements. Avoid trusting client-supplied orgId alone. Rules must prevent reading or writing another tenant, including query, export, restore, iCal and backups.

Alternatives considered:
- Separate Firebase project per customer: strongest operational separation, high provisioning/maintenance overhead; possible for a 1–3-customer manual pilot but not preferred long-term.
- PostgreSQL/Supabase with RLS: useful relational constraints, migrations and transactions; adds migration and operational work now.
Decision criteria for final choice: safe atomic booking writes, rule-test coverage, data export/restore, cost and operational burden. Do not finalize without concurrency proof.

## ADR-004: Reservation data writes
**Status: REQUIRED OUTCOME.** Replace whole-hotel PUT/set writes (currently in lib/firebase/db.ts and app/api/reservations/route.ts) with tenant-scoped, granular, atomic operations; revalidate overlapping reservations in the write transaction/serialized critical section. A check before a separate write is insufficient. Define idempotent request IDs; test simultaneous bookings and edits. Do not mutate Hotel Lidia data during this work.

## ADR-005: Modularization
**Status: PROPOSED.** Extract pure booking/date/finance functions first; component boundaries second. Replace fixed 'villa'|'house' property identity and hardcoded rooms with configurable IDs. Maintain an isolated legacy adapter strictly for optional Hotel Lidia migration. Preserve current check-out exclusive dates and whole-property conflicts.

## ADR-006: Plan entitlements
**Status: PROPOSED.** Central plan catalog (versioned) + org subscription state. UI may hide locked modules but API and database access must reject disallowed operations. Plan downgrade must not destroy customer data; choose read-only or grandfathering behavior when over unit limits. Backup/export and security always available to all paid plans. Pilot billing may be manual.

## ADR-007: External integrations
**Status: PROPOSED.** Treat external guest enquiry URL, marketing snapshots, iCal and ESTI as optional adapters with tenant-specific configuration and permissions; none may fall back to Villa Lidia production URLs or tokens. Existing iCal feed logic only blocks date ranges; it cannot guarantee multi-unit inventory synchronization. Do not sell it as a complete channel manager.

## Explicitly deferred
Marketplace, mobile native apps, AI agent, new guest messaging product, dynamic pricing, advanced channel manager, new analytics features.

## Verification gates before code migration
- Determine actual deployed Firebase security rules with authorized read-only inspection.
- Confirm use of Firebase Admin credentials and identify unauthenticated REST fallbacks.
- Run existing test suite in isolated environment.
- Threat-model host-to-host access, backup restore, SSRF to external integrations, IDOR.
- Approve target private repo and secret management.
