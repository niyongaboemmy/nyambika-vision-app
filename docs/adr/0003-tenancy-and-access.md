# ADR-0003: Tenant isolation and per-page access

- Status: Accepted for R1 dev; RLS hardening tracked for S5

## Decision
- Permissions are evaluated **per page** (FR-ACC-04) by the `Access` service: every page-scoped endpoint calls `requirePage(user, page, roles)`. Host admins pass all page checks.
- Shopper twins and looks are only ever queried by `userId = currentUser`. Makers never receive twin or look data (OP-5); orders expose only the buyer's name and phone needed for fulfilment.
- Postgres row-level security policies (plan §17) are **deferred** to the hardening sprint. API guards plus automated cross-tenant tests are the R1 control.

## Consequences
- Every new page-scoped endpoint must call `Access.requirePage`. Code review checks this.
