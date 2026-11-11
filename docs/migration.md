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
