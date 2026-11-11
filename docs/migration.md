# Migrating existing member pages (E17)

Implements plan §16 (waves, cutover runbook) and FR-MIG-01..05. The legacy export format is still open (OI-04), so the legacy data is first **transformed** into the bundle below and then imported from **Host admin → Migration**.

## Bundle format

```jsonc
{
  "wave": "Wave 1 · pilot cohort",
  "pages": [{
    "legacyUrl": "https://old.nyambika.rw/shop/uwase",   // becomes the redirect source (path only)
    "handle": "uwase-couture",                         // new address: /m/<handle>
    "name": "Uwase Couture",
    "memberType": "TAILOR | COOPERATIVE | SELLER",
    "ownerPhone": "0788…", "ownerName": "…",
    "story": "…", "district": "…", "sector": "…", "whatsapp": "…", "momoMerchant": "…",
    "products": [{
      "legacyId": "OLD-101", "title": "…", "description": "…", "category": "dress",
      "priceRwf": 36000, "madeToOrder": true, "leadTimeDays": 3,
      "occasions": ["wedding"], "styles": ["elegant"], "fabric": "Cotton kitenge",
      "colours": [{ "name": "Indigo", "hex": "#2B4EA2", "sizes": ["S","M","L"], "stock": 0,
                    "imageUrl": "https://…" /* or */ , "imageB64": "…" }]
    }]
  }]
}
```

A synthetic example: `apps/ai/.venv/bin/python scripts/migration/make-sample-wave.py wave0.json`.

## Runbook mapping

| Plan §16.3 step | In the product |
|---|---|
| 2. Export → transform → import, checksums, image re-processing | Import stores a SHA-256 of each source page; every photo runs through quality check, background removal, readiness and embedding. Pages and products are created hidden (DRAFT). Defects are logged per page. |
| 3. Owner review link, fixes within 48 h | "Send review link" sends a WhatsApp link to `/migrate/<token>`. The owner signs in with their registered phone, sees the page and defects, and can fix things in the Page manager or request changes (goes to moderation). |
| 4. Owner sign-off recorded | Sign-off is stored with a timestamp and audit-log entry. Go-live is blocked until then. |
| 5. Go-live, 301 redirects | "Go live + redirect" publishes the page (verified) and its products, and enables the legacy redirect. Old URLs hit a catch-all route that issues a permanent redirect (308) to `/m/<handle>`. |
| 6. Monitor 404s and traffic | Redirect hit counts per page; unmatched legacy paths are counted under "Unmatched legacy URLs". |
| 7. Rollback | "Roll back" disables the redirect and hides the new page; the legacy page stays the live one. |

## Full-network waves (E21)

Host admin → Migration → **Whole network** (`/admin/network`) takes the same bundle format with up to 2,000 pages. Pages import on the `migration-import` BullMQ queue: each wave has its own concurrency window ("at a time", 1–16; dispatch is serialised with a Postgres advisory lock) and the worker has a global cap (`MIGRATION_WORKER_CONCURRENCY`, default 6). A page that fails half-way is removed so a re-run can import it.

| Step | In the product |
|---|---|
| Owner outreach | "Send review links" sends a WhatsApp link to every owner not yet invited (idempotent). Unsigned pages are chased on the wave's cadence (default days 2, 5, 9 after the invite) by a 10-minute sweep; "Chase unsigned now" runs it on demand and "Rehearse cadence" (dev only) moves the clock forward 3 days. |
| Dashboard | Progress, peak in-flight imports, funnel (imported → review sent → signed off → live), defects by category (photos, MoMo missing, no products, short story), failed imports, redirect hits. |
| Cut-over checklist | Automatic: all imported, every owner invited, no blocker defects, ≥ 95% signed off (Gate 4). Manual: failures handled, redirect map exported (ticked by the export), DNS, rollback rehearsed (ticked by a rollback), support briefed. |
| Redirect map | CSV (`legacy_host, legacy_path, target, status, redirect_active, hits`) or an nginx `map $uri $nyambika_new { … }` block for the legacy domain's edge. |
| Go live / rollback | "Go live: all signed off" publishes every signed-off page and enables its redirect. "Roll back whole wave" cancels queued imports, hides every page of the wave and switches its redirects off; legacy pages stay live. |

Synthetic network for testing: `apps/ai/.venv/bin/python scripts/migration/make-network.py OUT.json 200` (≈200 pages with deliberate defects, two duplicate handles and one invalid record).
