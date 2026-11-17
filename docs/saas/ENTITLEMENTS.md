# Subscription Entitlements — Working Proposal v0.1
2026-11-17. NOT APPROVED, NOT implemented.

## Packages
| Capability | Basic €9/mo | Family €19/mo | Pro €39/mo |
|---|---|---|---|
| Unit cap across org | 2 | 10 | 25 |
| Reservations, calendar, guest details | Yes | Yes | Yes |
| Deposits and booking statuses | Yes | Yes | Yes |
| Manual income/expenses | No | Yes | Yes |
| Finance KPIs and occupancy | No | Basic | Full existing reporting |
| Configurable iCal feeds | No | Yes* | Yes* |
| ESTI export (BG only) | No | Yes* | Yes* |
| More than one property under org | No | No | Yes |
| Enquiries/marketing dashboards | No | No | Optional only if safely configurable |
| Secure storage, backups/export | Yes | Yes | Yes |
*Subject to adapter generalization and full compliance validation; no claim of channel-manager parity.

## Key decisions pending
- Count all rentable units across the organization; clarify room-type inventory vs physical rooms.
- Plan upgrade is immediate; downgrade never deletes rooms, bookings or finances. Over-limit units should become read-only until resolution, with reservations still viewable/exportable.
- Define trial access and manual pilot invoices separately from public launch.
- Define user/staff seat caps only after customer discovery.
- Show pricing in EUR, excluding or including VAT consistently as legally required.
- Pricing assumptions need validation through owner interviews.

## Enforcement
- Single server-side entitlements resolver: orgId + subscription state + catalog version.
- Every API action checks org membership, action permission, then plan entitlement.
- UI feature visibility is convenience, not access control.
- Do not hide essential security, backup or export behind a paid tier.
- Record denial reasons and test forged plan values, direct API calls, downgrade/upgrade and expired subscription states.
