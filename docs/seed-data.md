# Seed data: sources, licences, regeneration

The default seed looks like a real Kigali marketplace but is **fictional and legal**:

- **Makers, owners and phone numbers are invented.** Each name was checked against public web info for clashes with real Rwandan businesses (see the collision check below).
- **Garment images are real photos** of garments with **no people** in them, all openly licensed. Every stored image carries its credit, and so does every cut-out, recolour or illustration made from it.
- **Personas** (the synthetic try-on models) are illustrations for now. `scripts/personas/` holds the path to AI-generated, fictional people.
- **Pilot shoppers** are clearly synthetic ("Synthetic shopper NNNN", +25078999xxxx). They are opt-in through `db:seed:pilot` and never part of `db:seed`.

Research behind all of this: the seed research report (Commons licence verification, RWF price bands, lead times, size charts and RW/EN/FR patterns, Law 058/2021 notes).

## 1. Garment photos

| File | Role |
|---|---|
| `scripts/seed-assets/sources.json` | 57 verified Commons items (40 garments, 17 swatches): page, author, licence, licence URL, share-alike, logo flag |
| `scripts/seed-assets/recipes.json` | How each seed image is made: crop, label blur, emblem mask, studio margin, backdrop evening, recolours, illustrations |
| `scripts/seed-assets/fetch.py` | Downloads into `scripts/seed-assets/.cache/` (gitignored). Follows the Commons robot policy: descriptive User-Agent with a contact URL, one request at a time, a pause between requests, 960 px thumbnails, no re-downloads. The files are untrusted data and are only ever decoded as images. |
| `scripts/seed-assets/build.py` | Runs each image through the **real garment pipeline**: AI gateway `/v1/garment/assess` for the readiness checks and background removal. Writes `apps/api/storage/seed/real/<key>-photo.jpg`, `<key>-cutout.png` and `index.json`, plus the committed `scripts/seed-assets/attribution.json`. |
| `scripts/seed-assets/attribution.json` | One credit per seed image: sources (title, author, page, licence), the licence of the derived file, share-alike flag, changes made, illustration flag |

The build produced 38 recipes and 56 images (originals plus recolours). Of these, 47 pass the assess readiness checks. The 6 busy shop photos come out NEEDS_BETTER_PHOTO on purpose: Isimbi Tailoring's market stall, the Kanombe sundress, Akeza's burgundy dress and Gikondo's vintage shirt. They exercise the "needs a better photo" studio flow honestly. Three are not try-on items: two fabric swatches and a stole.

**Changes made to photos** (also listed in each credit):
- crop
- **brand label blurred** (the Gap shirt; the H&M shirt is not seeded)
- **printed emblem removed** (the Peace Monitoring Group tee)
- studio margin
- backdrop evened to studio grey
- resize
- background removed (cut-out)
- recoloured: hue rotated or tinted over the photo's own shading, as "faithful colourways"

**Dropped after visual review:**
- g08: its white-on-white cut-out failed.
- g15 and g16: the door background was left in the cut-out.
- g19: white tee on white.
- g23: pale shirt on white.
- g06: it carries a round badge.
- g26, g29, g30, g34 and g37 were never used: side view, a form with a head, busy floors, overexposure.

**Try-on preflight in the seed.** A READY photo must also pass the try-on quality guard on synthetic personas 2 and 5 (`/v1/tryon`). Otherwise the product is seeded as NEEDS_BETTER_PHOTO with a note, so shoppers never get withheld looks.

Today the guard withholds:
- the three long skirts (ankle pencil, A-line midi, grey wool midi);
- the floor-length sprig gown;
- the navy aloha shirt on persona 5.

The cause is the local compositor's hem placement check (`placement_implausible`), not the photos. This finding is for the try-on owner. Flat wrappers are not try-on items.

**Skirt illustrations.** Two skirt products are procedural knee-length A-line illustrations, like the umushanana, marked `illustration` and textured with swatch photos:
- Urudodo's kitenge skirt: Rwandan igitenge (BY-SA) and adire (CC0);
- Isimbi's kente skirt: two CC0 kente cloths.

They keep office outfits (wardrobe restyle) possible while the long-skirt photos are guard-withheld.

### Licences

| Licence of the source | Seed images | Rule we follow |
|---|---|---|
| CC0 / Public domain | g11, g12, g13, g17, kente-umushanana sources (s49, s57) | Credited as a courtesy. Derived files released CC0. |
| CC BY 4.0 / 2.0 | Auckland Museum garments (g20–g40), credited "Auckland Museum" | Credit, licence link, changes indicated |
| CC BY-SA 4.0 / 3.0 | g01–g05, g07, g09, g10, g14, g18, s21, s29, s54 | **Derived images stay CC BY-SA**: the cut-out, recolour or print inherits it. If any source of a file is BY-SA, the file is BY-SA (BY-SA 3.0 adaptations may use 4.0). |
| In-house | Plain cotton tee (procedural, `make_seed_assets.py --tee`), umushanana illustrations (our drawing, textured with the photos above) | Credited as in-house or illustration |

**Try-on demos prefer CC0 and CC BY garments.** A VTON output that composites a BY-SA garment is arguably an adaptation. The anchor and demo products therefore use CC BY photos:
- the crawls' Ineza dress (g32);
- the VR show pieces (g32, g35, g33 and g11);
- the 3D seed and the tailor templates.

The BY-SA items are on regular product pages. None of these images name a brand. Museum metadata such as Dior or Manhattan is never used in titles.

### Umushanana

No person-free umushanana photo exists under an open licence, so the seed uses **procedural illustrations**:
- an umushanana silhouette with a shoulder sash;
- one textured with crops of a CC0 kente cloth and CC0 imigongo art (CC0 result);
- one textured with the Rwandan igitenge print and imigongo patterns (CC BY-SA result).

They are marked `illustration: true`. The ⓘ sheet shows an "Illustration" badge, and the product description says so.

**Recommended:** a half-day flat-lay or ghost-mannequin shoot of 4–6 umushanana and kitenge pieces at a pilot maker. Use a property release and a CC0 or work-for-hire assignment, with a local photographer and a lightbox. Budget about RWF 150–300k. Drop the photos in as new recipes and the illustrations go away.

## 2. Credits in the app

- **Data.** Model `MediaCredit` is keyed by storage path, so every row that reuses a file carries the credit. This covers the KE region copies, cut-outs and the 3D inputs. `ProductCopy` holds RW/EN/FR titles and descriptions. Both come from migration `20261112082010_realistic_seed_data`.
- **API** (public), `src/modules/credits/`:
  - `GET /credits`: all sources, grouped;
  - `GET /credits/media?src=<image url or path>`;
  - `GET /credits/products/:id`;
  - `GET /copy/products/:id?locale=rw|en|fr`.
- **Web:**
  - `components/media-credit.tsx`: the ⓘ button on the product image opens the "Image credit" sheet with source, author, licence and changes, plus a link to all credits;
  - `app/credits/page.tsx`: lists every source and licence;
  - `components/product-copy.tsx`: shows the product title in the shopper's language;
  - hooks: one wrapper in `app/m/[handle]/product-sheet.tsx` and one menu entry.
- The credit format follows CC's recommended practice: title, author, source link, licence link, changes. The ⓘ sheet plus a credits page meets the "reasonable manner" standard.

## 3. Catalogue

Defined in `apps/api/prisma/seed-catalogue.ts`.

| Maker (handle) | Type, place | Login | Products |
|---|---|---|---|
| Umurage Wear (`umurage-wear`) | Tailor, Kimihurura, Gasabo | 0788100001 | 4: anchor "Ineza A-line dress", morph templates, VR showroom and show |
| Urudodo Stitch Collective (`urudodo-collective`) | Cooperative, Nyamirambo, Nyarugenge | admin 0788100002, member 0788100004 | 5 (maker attribution, passport) |
| Kanombe Kitenge Corner (`kanombe-kitenge-corner`) | Seller, Kanombe, Kicukiro | 0788100003 | 6 + plain cotton tee (export settings; the KE page copies its first three) |
| Inkindi Studio (`inkindi-studio`) | Tailor, Kiyovu, Nyarugenge | 0788100005 | 5: umushanana illustration, umushanana service |
| Akeza Couture (`akeza-couture`) | Seller, Kacyiru, Gasabo | 0788100006 | 4 |
| Isimbi Tailoring (`isimbi-tailoring`) | Tailor (market stall), Kimironko, Gasabo | 0788100008 | 4 (3 shop photos that need a better photo, 1 kente skirt illustration) |
| Rebero Threads (`rebero-threads`) | Seller, Kigarama (Rebero), Kicukiro | 0788100009 | 4 tees, including an imigongo chevron print |
| Gikondo Makers Coop (`gikondo-makers-coop`) | Cooperative, Gikondo, Kicukiro | 0788100010 | 3 |
| Nairobi Kikoi Studio (`nairobi-kikoi-studio`) | Seller, Kariokor, Nairobi (KES) | +254711000001 | 3 (region seed) |

Unchanged logins: shopper 0788000001 and host 0788900001.

- **Prices** follow the research bands and end in 000 or 500. Examples: dresses RWF 21–68k, umushanana 95k, shirts 21–27.5k, skirts 16.5–22k, tees 8.5–14.5k, kitenge 6 yd 12k.
- **Lead times:** ready-to-wear 1 day; market made-to-order 2–3 days; boutique 5–10 days; ceremony 7–14 days.
- **Size charts:** women XS–XXL (bust/waist/hip with UK/EU sizes) and men's shirts S–XXL (chest/neck). Every product links to its chart, which feeds the size recommendation.
- **Copy:** RW/EN/FR titles and descriptions from the research templates. **Every RW row has `needsReview = true`** until a native Kinyarwanda speaker signs it off. Product.title stays English, which is the app default. The product sheet shows the RW or FR title for those locales.

**Collision check (2026-11-12, web search; RDB not queried):**
- Renamed from the report: "Nyamirambo Stitch Collective" became **Urudodo Stitch Collective**, because it was too close to the real Nyamirambo Women's Center tailoring cooperative.
- Renamed from the report: "Inganzo Studio" became **Inkindi Studio**, because of Inganzo Ngari, the national troupe, in a ceremony-wear context.
- All old seed names were replaced. "Uwase Couture" was close to DoBe Couture (founder Uwase) and "Inzozi" to the Moshions "Inzozi" event.
- No public hits for Umurage Wear, Akeza Couture, Isimbi Tailoring, Rebero Threads, Gikondo Makers Coop, Kanombe Kitenge Corner, Inkindi Studio, Urudodo or Nairobi Kikoi Studio.
- **Before launch:** check each name in the RDB registry (org.rdb.rw) and on Instagram.

## 4. Commands

```bash
# Seed photos (only needed once; db:seed runs these itself when storage/seed/real/index.json is missing)
apps/ai/.venv/bin/python -I scripts/seed-assets/fetch.py
apps/ai/.venv/bin/python -I scripts/seed-assets/build.py            # needs the AI gateway (AI_GATEWAY_URL)

# Fresh database
createdb nyambika_x && DATABASE_URL=… pnpm --filter @nyambika/api db:deploy
pnpm --filter @nyambika/api db:seed          # makers, products, credits, copy, personas, tailor, 3D, VR, region, tee
pnpm --filter @nyambika/api db:seed:agents   # demo API keys (printed once, dev only)
pnpm --filter @nyambika/api db:seed:pilot    # opt-in synthetic pilot shoppers (never in production)
# Each feature seed also runs alone: db:seed:region | :3d | :vr | :tee | :personas
```

In a worktree without its own Python venv, set `AI_PYTHON=$MAIN/apps/ai/.venv/bin/python`.

## 5. Personas swap-in

`scripts/personas/generate.py` and its README implement the recommended path:
- **Model:** Z-Image-Turbo (Apache-2.0), with FLUX.1-schnell as the fallback.
- **Matrix:** 8 personas across Monk skin tones 6–10 and sizes S–XL; full-body front A-pose on a neutral backdrop.
- **Output:** 720×1280 PNGs with EXIF stripped and "AI-generated, fictional person" PNG/XMP metadata (`trainedAlgorithmicMedia`).
- **Provenance:** the prompt, seed, model and Hugging Face commit are logged for every candidate.
- **Resemblance check:** a reverse-image check step (Google Lens / TinEye) before use.

It needs a CUDA GPU or a ≥ 32 GB Apple Silicon Mac. It has not been run here.

To swap in, copy `persona-1..8.png` and `generation.json` into `apps/api/storage/personas/`, then run `pnpm --filter @nyambika/api db:seed:personas`. The persona seed writes `storage/personas/manifest.json` (count 8, new set version). The API reads it through `src/modules/twin/personas.ts`, so:
- the pickers offer 8 personas;
- persona cache keys become `persona-N:vX`, so old renders are not reused;
- the turnaround cache moves to a versioned folder;
- `db:seed:pilot` uses all 8.
