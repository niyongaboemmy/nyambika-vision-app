# Datasheet: Nyambika synthetic garment corpus + consented catalogue contributions (R4 spike)

Template: *Datasheets for Datasets* (Gebru et al., 2021), sections and questions abridged. Status: **spike, not committed**. Code: `apps/ai/app/mlspike/` (generator `synth.py`, builder `dataset.py`), `apps/api/src/modules/mlspike/` (consent, versions, tombstones).

## 1. Motivation
- **Purpose.** Test, on CPU and without real people, whether Nyambika can run a consent-first training-data pipeline and a small local model that suggests garment attributes (type, pattern family, main colour) in the studio product editor, and evaluate it NLB-style before any commitment (plan §11).
- **Who created it.** The Nyambika engineering team, in-house. **Funding:** product budget; no third-party data purchase.
- **Not for.** Identifying, profiling or depicting people; inferring anything about shoppers; redistribution.

## 2. Composition
- **Instances.** Two sources, both garment-only:
  1. **Synthetic** (CC0, generated): procedurally drawn garment photos, 120×150 px. Axes: garment type (dress, umushanana, shirt, skirt, trousers) × pattern family (imigongo, kitenge, wax, solid) × photo quality (good, low light, blurry/noisy) = 60 cells, plus main colour (8-colour palette). Each instance is regenerated from its `seed` + labels + generator version (`gen`), so the manifest holds no pixels.
  2. **Consented catalogue** photos: variant photos (`public/media/...`) of published products whose maker opted in (page or product). Labels from the listing: category, colour name (normalised), pattern family only when the maker tagged it; photo quality unknown.
- **Size (dev run, dataset v15/v16, per-cell 16).** ≈ 940 items: 932 synthetic + 6–12 catalogue photos; 28–40 dropped per build (synthetic "person" images by the PII screen, duplicates, withdrawals). Synthetic-only experiment builds: 932 items (generator v1) / 946 (v2).
- **Labels.** `category`, `pattern`, `colour`, `quality` (synthetic: exact by construction; catalogue: maker-entered, may be wrong or missing).
- **Missing data.** Catalogue items lack `quality` and usually `pattern`; those heads mask them out.
- **Confidential / personal data.** None by design. Shopper data (twins, looks, wardrobe, avatars, clips, measurements, private storage) is refused **by code** in two places (`assertCatalogueImage` in the API, `assert_trainable` in the gateway) and raises an error rather than being silently dropped. Images that show a person are removed by the PII screen.
- **Recommended splits.** Train/val = deterministic 85/15 by `sha256(item_id)`. Test = a **fixed benchmark** (generator v1, seed 4242, 10 per cell = 600 images) never present in any manifest, plus the **out-of-distribution probe**: the 40 seed catalogue garments drawn by a different generator (`apps/ai/scripts/make_seed_assets.py`).

## 3. Collection process
- **Synthetic.** `synth.corpus(per_cell, seed, gen)` → specs; `synth.render(spec)` draws a silhouette (v1: one polygon per type with scale/offset jitter; v2: domain-randomised style variants) filled with a pattern tile (imigongo: bold chevrons + nested diamonds; kitenge: large flower motifs; wax: dense dots/rings + speckle; solid: faint weave), then a quality transform (×0.42–0.55 brightness + warm cast; Gaussian blur σ 1.2–1.8 + noise σ 12). The motifs are **stylised stand-ins** from public geometric vocabularies, not copies of any maker's designs.
- **Synthetic attribution.** Synthetic items are attributed round-robin to the pages that opted in, so provenance, withdrawal and tombstones behave exactly as for real contributions.
- **Catalogue.** At build time the API lists pages with a `TRAINING_DATA_GARMENT:<page>` grant (latest ledger record wins, product records override the page), reads only eligible products' variant photos and sends them with provenance to the gateway.
- **Consent.** Opt-in, off by default, per page with per-product overrides, recorded on the hash-chained consent ledger (purpose string, notice version, locale). Withdrawal writes a `TrainingTombstone`.
- **Timeframe.** November 2026 (dev). **Ethical review:** none yet (spike); DPIA addendum required before any real collection (see report).

## 4. Preprocessing / cleaning
- Provenance check: `item_id, page_id, product_id, consent_record_id, licence, consented_at` must all be present, else dropped ("missing provenance").
- Withdrawal: items covered by a tombstone (page, or one product, consented at or before the tombstone) are dropped; their **pixel hashes** are added to `withdrawn_hashes` and the same pixels are excluded under any other product/page in every later version (order-independent two-pass build).
- De-duplication by pixel hash (seed catalogue reuses photos across products).
- **PII screen** (`screen.py`, `pii-screen/1`): drops images with a face-like skin blob with two eye features, or a pair of arm-like skin strips. Measured: recall 1.00 for every synthetic skin tone MST 3–10 (210 persons), false drops 1.7 % of garments (360); the 5 synthetic personas are dropped, all 40 seed garments kept.
- Raw catalogue pixels are not stored in the manifest; only hashes and references.

## 5. Uses
- **Used for.** Training/evaluating `nyambika-attr-spike` (multi-head linear probe on CPU features).
- **Should not be used for.** Real-world accuracy claims (it is synthetic), any task involving people, design attribution or similarity search that could expose a maker's private pieces.
- **Risks.** Synthetic→real gap (measured: in-distribution type accuracy 1.00 vs 0.80 out of distribution at 100 % confidence); pattern-family labels exist only for our own generator; makers' designs may carry IP and cultural meaning (imigongo).

## 6. Distribution
- Not distributed. Internal only, no redistribution (catalogue licence: "Nyambika training-contribution consent v1, revocable").

## 7. Maintenance
- **Versioning.** `TrainingDataset.version` (monotonic), `hash` = sha256 over sorted (item_id, pixel sha256, labels); `parentHash` links versions; `diff` lists added/removed/removed-by-withdrawal.
- **Withdrawal.** Maker switches off (page) or keeps a piece private → tombstone → next version drops the items and remembers the hashes; models trained on earlier versions must be retrained before the next activation (production need: a retention window for superseded versions/artefacts).
- **Drift.** Each train/eval compares the new version with the previous one (feature PSI mean + label PSI, threshold 0.20).
- **Contact.** Nyambika DPO (privacy) and ML lead.
