# Engineering Backlog — Hotel Lidia SaaS
Date: 2026-11-17 | Draft v0.1 | All estimates directional *person-hours*, not commitments.
Baseline commit: aa1299bcb1cec9598ddef0787329874b43d43fdc
Scope freeze: reuse functions only. No production commits, database changes, or service provisioning from this plan.

## Milestone 0 — Discovery and readiness (must finish before product code)
| ID | Priority | Task | Source areas | Est. | Acceptance |
|---|---|---|---|---:|---|
| D0-01 | P0 | Inventory hardcoded identifiers, database paths, room mappings and integration URLs | domain/reservations/types.ts; domain/booking/availability.ts; lib/firebase/db.ts; app/api/*; HotelApp.tsx | 3-5h | every constant gets target configuration owner |
| D0-02 | P0 | Read-only deployed auth/rules + service account permission review | Firebase Console; lib/firebase/admin.ts; app/api/session; API routes | 3-6h | documented access graph, no secret values copied |
| D0-03 | P0 | Existing test baseline | package.json; tests/** | 2-4h | npm ci, npm run lint, npm run test, npm run build results captured; none asserted passed until run |
| D0-04 | P0 | Threat model and tenant authorization rules | db.ts; APIs; backups; iCal; ESTI | 4-6h | cross-tenant deny matrix with positive/negative cases |
| D0-05 | P1 | Approve data-store architecture (ADR-003) | architecture decisions | 2-3h | signed decision and transaction concurrency proof plan |

## Milestone 1 — Isolated workspace
| ID | Priority | Task | Est. | Acceptance |
|---|---|---|---:|---|
| I1-01 | P0 | Private SaaS repo from sanitized source baseline | 2-4h | separate GitHub repo, no credentials/guest data/history leakage |
| I1-02 | P0 | Independent Vercel and Firebase test projects | 3-6h | production credentials/IDs absent; synthetic-only fixtures |
| I1-03 | P0 | CI gate: lint, unit tests, build, PR review | 3-5h | failed checks block merge |
| I1-04 | P0 | Synthetic fixtures: villa (1 unit), guesthouse (8 rooms), small hotel (20 rooms) | 3-5h | deterministic reservation, expense and availability cases |

## Milestone 2 — Core refactoring
| ID | Priority | Task | Existing source | Est. | Acceptance |
|---|---|---|---|---:|---|
| C2-01 | P0 | Generic organization/property/unit types, replace fixed union | domain/reservations/types.ts; legacyAdapter.ts | 8-14h | arbitrary IDs and room counts work; legacy fixtures still import |
| C2-02 | P0 | Extract calendar/reservation UI modules | components/HotelApp.tsx (~306KB) | 12-24h | parity on booking, edit, delete, filters, mobile |
| C2-03 | P0 | Extract reservation rules and dates into pure core | domain/reservations/* | 5-8h | existing conflict/checkout/whole-property tests pass |
| C2-04 | P1 | Generalize finance KPIs / occupancy denominator | domain/finance/kpis.ts, revenueBreakdown.ts | 5-9h | occupancy denominator derives from eligible units; no hardcoded 11 |
| C2-05 | P1 | Configurable booking inventory categories | domain/booking/availability.ts | 6-10h | no hardcoded spa/balcony/room IDs |

## Milestone 3 — SaaS foundations
| ID | Priority | Task | Est. | Acceptance |
|---|---|---|---:|---|
| S3-01 | P0 | Tenant-aware persistence and granular write/transaction strategy | 12-22h | concurrent edits preserve data; no whole-tenant overwrite |
| S3-02 | P0 | Auth organization membership, roles and server checks | 12-20h | owner, manager, staff permissions enforced on every protected path |
| S3-03 | P0 | Firebase rules and emulator isolation tests | 8-14h | org A cannot read/change org B through SDK or REST |
| S3-04 | P0 | Owner property and unit setup; safe limits | 8-14h | new owner can configure 1, 8 or 20 units without code changes |
| S3-05 | P0 | Tenant-specific backup/export/import recovery | 8-14h | no cross-tenant restores; recovery drill documented |
| S3-06 | P1 | Central subscription entitlements and gates | 6-10h | UI and APIs enforce Basic/Family/Pro; downgrade non-destructive |
| S3-07 | P1 | Optional adapters: iCal + ESTI configuration | 7-14h | no Hotel Lidia URL/ID fallback; safe tokens; iCal limitation disclosed |
| S3-08 | P2 | Enquiries/marketing adapter gating | 4-8h | disabled until tenant-specific integration configured |

## Milestone 4 — Controlled pilot
| ID | Priority | Task | Est. | Acceptance |
|---|---|---|---:|---|
| P4-01 | P0 | Three-property scenario/UAT matrix | 5-8h | complete create/edit/cancel/whole-property/finance journeys |
| P4-02 | P0 | Adversarial authorization + race condition tests | 6-12h | no cross-tenant access, double-booking or silent lost update |
| P4-03 | P0 | Restore drill, connectivity, mobile smoke tests | 5-8h | recover synthetic org from backup; documented rollback |
| P4-04 | P1 | Pilot onboarding and support runbook | 4-7h | manual provisioning feasible, no production guest data exposure |

## Execution rules
- Start implementation only in the future private SaaS repository.
- One small PR per task (or tightly coupled group); no speculative reformatting.
- Each PR: source baseline, changed-file list, test output, screenshots if UI, rollback strategy, no new features.
- No merge while P0 security, concurrency, or tenant isolation acceptance tests fail.
- Package prices/caps require separate product approval; they are not development scope expansion.
- Estimates should be revised after D0-03 and D0-05.
