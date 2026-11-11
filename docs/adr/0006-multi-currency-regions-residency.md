# ADR-0006: Multi-currency money, EAC regions, data residency, Stripe export and product passports

- Status: Accepted (R3, E40/E41)
- Related: FR-ORD-08, FR-DPP-01..04, NFR-SCL-04, CON-08, OP-2

## Context
Nyambika launches in Rwanda but plans pilots in Kenya, Uganda and Tanzania, plus export and diaspora orders. Today every amount is an `Int` of RWF (`priceRwf`, `totalRwf`), payments are MTN MoMo / Airtel Money pushes into the maker's merchant account, and every page is implicitly Rwandan. Central collection stays off pending regulator approval (CON-08), so every new payment path must still pay the maker directly (OP-2). Several countries will expect personal and order data to stay in-country.

## Decision

### Money
- **New code stores money as integer minor units plus an ISO 4217 code** (`amountMinor` + `currency`). Exponents follow ISO: RWF 0, UGX 0, KES 2, TZS 2, USD 2, EUR 2 (they also match Stripe's zero-decimal list for our currencies).
- Shared math lives in `packages/contracts/src/region.ts`: `parseMajor` (string → minor, rejects too many decimals), `formatMoney`, `convertMinor`, `shareBp`, `vatIncluded`. **No floats:** rates are decimal strings and conversion is exact BigInt rational arithmetic with a single **half-even** rounding step. Non-integer inputs throw.
- Legacy `*Rwf` columns on `Order`, `OrderItem` and `Payment` are untouched. For non-RWF orders they hold an RWF *reporting* equivalent only. The charged amount lives in **`OrderMoney`** (charged currency, items, delivery, maker-funded discount, total, refunds, method, and the "≈" display snapshot).
- Product prices in a page's own currency live in **`ProductPrice`**; no row means `priceRwf` in RWF. **A missing price is never derived by conversion.** A non-RWF product without a price simply can't be bought.

### FX: display, never charge
- `FxRate` rows hold units of `quote` per 1 USD, with `source` and `fetchedAt`. `FxService` picks an adapter: `FixedFxAdapter` (default; **synthetic** dev rates, source `dev-fixed-synthetic`) or `OpenExchangeRatesAdapter` (`FX_PROVIDER=openexchangerates`, `FX_API_KEY`, not exercised locally). Rates older than 24 h are flagged as stale.
- Shoppers choose a **display currency** (cookie for everyone, plus `ShopperPrefs` once signed in). Prices show the maker's currency first and "≈ USD 34.75" second. Checkout says "You'll be charged KES 4,750" and labels the ≈ as reference only. The display amount and rate are stored as a snapshot on `OrderMoney`. **Nothing converts at payment time.**

### Regions
- **`RegionConfig`** (seeded by the migration for RW/KE/UG/TZ) holds currency, wallets, dial code, languages, VAT basis points, tax note, legal-entity text, residency targets, the launch flag and the manual checklist ticks. Only RW is launched. The tax and legal texts start with "Draft" for counsel to replace.
- **`PageRegion`** is the region attribute per page (NFR-SCL-04): region, currency, M-Pesa till, cross-border opt-in, export (card) opt-in, Stripe connected account. No row means RW.
- Phone validation per country (`normalizePhone`) accepts local and international formats and rejects numbers from another country. M-Pesa checkout validates the payer's number against the maker's country.
- **Ranking:** `rankByRegion` shows makers from the shopper's country first. Makers in other countries appear **only** when the shopper opted in to cross-border shopping **and** the maker opted in to selling cross-border. `/makers` server-renders with the `nya_cc` / `nya_xb` cookies.
- **Wallets:** `WalletProvider` adapters. `MockWalletProvider` (dev; HMAC-signed webhook, simulated STK prompt on the order screen) and a `DarajaMpesaProvider` **stub** (M-Pesa Express to the maker's own BuyGoods till; `MPESA_PROVIDER=daraja`; not exercised, and it needs Safaricom approval for per-maker tills). RWF MoMo/Airtel keep the existing E05 path.
- **Swahili (`sw`)** is added to i18n as a *starter* catalogue that is **machine-drafted** and flagged `SW_MACHINE_DRAFTED`. Native review is a manual launch-checklist item. Missing keys fall back to English.
- **Admin:** `/admin/regions` has a region switcher, automatic checks (fresh FX rate, wallets, phone format, languages, final tax/legal text, residency route, a pilot page) plus manual sign-offs (regulator, data protection, counsel, language review, support line, regional infra). Launch is blocked until every item is done. All changes are audit-logged.

### Data residency (seam only)
- Each region maps to an object-store **bucket** and a **Postgres schema/database** (`RegionConfig.storageBucket` / `dbSchema`; defaults `nyambika-ke-nbo` / `region_ke`, …).
- `ResidencyService` is the routing seam that sits behind the existing `StorageService` and Prisma access:
  - `RESIDENCY_MODE=off` (default): everything stays in the home store and DB. Routes are reported, not applied.
  - `RESIDENCY_MODE=prefix`: objects for non-home regions are written under `regions/<bucket>/…`, standing in for the regional bucket. The first user is the passport snapshot archive (`passports/<id>/v<n>.json`).
  - `DATABASE_URL_<REGION>`: `prismaFor(region)` returns a client bound to that regional database.
- **Out of scope:** actually running several databases, moving existing rows, and cross-region queries (directory, admin totals). A real cut-over needs per-region services or a router in front of read paths, a migration plan per table family, and legal sign-off on which data (twins, measurements, orders, messages) must stay in-country.

### Export via Stripe Connect (FR-ORD-08)
- The maker connects their **own** Stripe account (Express). We store only `acct_…`.
- Card payments use **direct charges**: PaymentIntents and refunds are created with the `Stripe-Account` header and **no `application_fee_amount`**, so funds settle to the maker and Nyambika never collects.
- Webhooks go to `/stripe/webhook`. `main.ts` keeps the raw body, and the `t=…,v1=…` HMAC-SHA256 signature is checked in constant time with a 300 s tolerance. Events are idempotent (`StripeEvent`). **Connected-account routing:** an event settles a payment only if `event.account` equals the account the PaymentIntent was created on and the amount and currency match exactly.
- Without `STRIPE_SECRET_KEY`, `MockStripeAdapter` simulates accounts and intents. The mock Payment Element (test cards 4242… / 4000…0002) confirms through `/region/stripe/mock/confirm`, which posts a correctly signed Connect webhook, so the signature and routing path also runs offline. With keys, `HttpStripeAdapter` (REST over fetch, no SDK) and the real Payment Element (Stripe.js with `stripeAccount`) are used. **That path is not exercised in CI.**
- International shipping uses **maker-defined zones** with a flat fee in the maker's currency (`ShippingZone`, `"*"` for rest of world).
- Maker-funded discounts (E30) apply in the page's own currency, in whole major units, just as for RWF. The platform never tops up.

### Digital Product Passport (FR-DPP-01..04)
- `PassportData` (Zod) covers fibre composition (must total 100%), fabric and origin, maker/cooperative attribution (makers who consented), handmade, production date/batch, process steps, care, repair/alteration services, certifications, a carbon placeholder, claims, an optional GTIN and free `extensions` for future EU fields.
- Each publish writes an **immutable `ProductPassportVersion`** with the changed fields. `ProductPassport` points to the current version. Editing the claims resets host verification (FR-DPP-04).
- The public page `/p/<productId>` is light, editorial and printable, with a hang-tag QR and version history (`?v=n`). It embeds **JSON-LD** (schema.org Product plus a `dpp:` namespace). The **GS1 Digital Link** resolver at `/01/<GTIN-14>` redirects to the passport.
- Field names follow the draft EU ESPR textile vocabulary (`EU_DPP_DRAFT_FIELDS`). This is a **draft alignment** until the delegated act (expected 2027).

## Consequences
- New money code can't silently mix currencies or floats. Legacy RWF reporting keeps working, but GMV across currencies needs explicit FX in reports.
- Hold-to-buy in the looks feed still uses the RWF MoMo path. Non-RW pages sell through the Maker Space checkout.
- Sign-in normalises phone numbers that start with `07` to +250. Kenyan shoppers must type `+254…` until identity becomes region-aware.
- Real Stripe, Daraja and FX adapters are written but untested without credentials.
