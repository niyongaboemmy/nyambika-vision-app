# R4 spike: fine-tuned local model on consented garment data + advanced trend insights

**Status: spike, not committed.** Plan §11 says every R4 item "starts with a spike and an NLB-style evaluation before commitment". This document is that spike's decision report. Everything here runs on CPU with **synthetic data only** (no real people, no real designs). Both features ship dark behind flags that are **off by default**: `ml.local_attr_spike` and `insights.trends_spike`.

**Recommendation in one line.** Data governance and trends: **Go** to a pilot behind flags, once the listed production items are done. Local attribute model: **Iterate.** The pipeline, gate and router work, but hand-crafted CPU features do not transfer beyond our own generator. Only the colour head passes. Next step: a frozen open encoder (+ LoRA) evaluated on a real consented holdout. Criteria are in §7.

---

## 1. What was built

| Piece | Where | Notes |
|---|---|---|
| Consent purposes `TRAINING_DATA_GARMENT:<page>` and `…:<page>:<product>` | `apps/api/src/modules/mlspike/training-consent.ts` | Uses the existing hash-chained ledger (`ConsentService`). Default OUT. A product record overrides the page record. Latest record wins. |
| Maker opt-in UI | `/studio/[pageId]/training` (linked from Settings) | Page switch, per-piece Share / Keep private, "In dataset" chips, withdrawal count. |
| Tombstones | `TrainingTombstone` | Written on every grant → withdrawal transition (page or product). |
| Dataset versions + manifest | `TrainingDataset`, gateway `POST /v1/ml/dataset/build` (`apps/ai/app/mlspike/dataset.py`) | Per-item provenance: page, product, variant, licence, consent record id, consented/captured time, pixel sha256, labels, screen score. Content hash, parent hash and diff (added / removed / removed by withdrawal). |
| Shopper data excluded by code | `assertCatalogueImage` (API) + `assert_trainable` (gateway) | Only `public/media/…` catalogue photos and generated synthetic images can enter. Twins, looks, wardrobe, avatars, clips and `private/` raise an error. Path matching is token-based because ids are random cuids. |
| PII / person screen | `apps/ai/app/mlspike/screen.py` | Drops any image with a face-like skin blob (two eye features) or a pair of arm strips. Evaluated per skin tone. |
| Synthetic corpus + datasheet | `synth.py`, `docs/datasheets/synthetic-garments.md` | 5 garment types × 4 pattern families × 3 photo qualities × 8 colours. Generators v1 and v2 (domain-randomised). |
| Tiny model | `model.py`, `features.py`, `pipeline.py` | Multi-head softmax linear probe in numpy (category / pattern family / colour). Inputs: the existing Snap 64-d embedding + an 80-cell shape code + 8 tone moments. Temperature scaling per head. Artefact is a 28 KB JSON file. |
| NLB-style eval → `ModelEval` (`kind=ATTR_SPIKE`) | `evaluate.py`, `POST /admin/mlspike/train-eval` | Per-subgroup accuracy / F1, fairness gap, calibration (ECE), drift (PSI), selective accuracy, out-of-distribution (OOD) probe, PII-screen eval. **Per-head release.** |
| Registry gate | `NLB_GATED_TIERS.ATTR_SUGGEST = "ATTR_SPIKE"` (one line in `nlb-gate.ts`) | Activation needs a passing eval for this exact version, ≤ 92 days old, with a commercial licence. Uses the same E39 code path as `PATCH /admin/models/:id`. |
| E42 routing | Route `attr` in `apps/ai/app/inference/` | `pool` backend = the self-hosted model (in-process on CPU here, health UP). Policy `pool-only` + `in-region`, so maker photos never go to a hosted vendor. If no backend can serve, rules fall back to dominant colour only. |
| ✨ Auto-fill in the product editor | `components/mlspike-suggest.tsx` | Shows only heads that passed. One tap applies a fix through the normal PATCH. Local (e.g. Kinyarwanda) colour names are never overwritten. Blocked heads are explained. |
| Trends | `trends.ts`, `trends-seed.ts`, `trends-copy.ts`, `TrendSignal`, `components/mlspike-trends.tsx` | k-anonymous rising colours / patterns / occasions by week and region, demand vs supply gaps, price-band hints. Bootstrap-stable items only. RW / EN / FR rule copy, optionally rephrased through the existing `/v1/insights/phrase` (Claude or pool LLM), with rules as the fallback. |
| Trends eval → `ModelEval` (`kind=TRENDS_PRIVACY`, model `trends-spike@1`) | `POST /admin/mlspike/trends/eval` | Independent privacy re-derivation for 13 viewers + cluster bootstrap (B = 50). |
| Real-data ingest (unexercised with real data) | `POST /admin/mlspike/trends/ingest` | Muse intents (ASK) + paid orders (ORDER) → pseudonymised signals (HMAC of the user id, same salt as pilot analytics). |

Migration: `20261111103148_r4_mlspike` (3 tables, 2 flags OFF, the `trends-spike@1` registry row).

## 2. Data governance design

1. **Opt-in, granular, revocable.** The maker decides per page and per piece. Every decision is a ledger record (purpose, notice version, locale, hash chain). The UI says plainly what is shared (garment photos only) and what never is (shopper photos, twins, looks, measurements).
2. **Purpose limitation by code, not policy.** The builder accepts two sources: `catalogue` (from `public/media/`) and `synthetic`. Anything else is a hard error. A refusal is never a silent "drop", so a bug can't quietly launder data.
3. **Provenance on every item.** If an item lacks a page, product, consent record, licence or timestamp, it doesn't enter.
4. **Withdrawal semantics.** A tombstone covers contributions consented at or before it. The *pixels* of withdrawn items go on a `withdrawn_hashes` list carried forward by every later version. So the same photo re-shared under another product, or re-consented later, never comes back. Only new photos enter after a re-consent. The build is two-pass, so this holds whatever order the candidates arrive in. We found this ordering bug during the crawl and fixed it, with a test.
5. **Withdrawn data is touched only to honour the withdrawal.** The API sends withdrawn pieces' photos as *withdrawal references* so the builder can hash them, and the builder then forgets them. Drift checks never re-read withdrawn catalogue photos.
6. **PII screen before entry.** Any image with a person is dropped and the reason is logged in `dropped`.
7. **Residency.** Inference goes through E42 route `attr` with `pool-only` + `in-region`. A request from another region gets the rules fallback and the photo is not sent anywhere (tested).
8. **Trends privacy.** Signals carry an HMAC pseudonym, never a user id or free text. Every published number needs ≥ 10 distinct shoppers. k can be raised but never set below 10. Counts are rounded to 5. Sales-derived numbers also need ≥ 3 makers, ≥ 2 of them other than the viewer, and no maker above 60 % of the cell. Weekly series points below k are drawn as empty dashed slots, never as small numbers.

## 3. Results: local attribute model

Setup: 6 synthetic contributor pages, 16 images per cell. v1 = 932 items. v2 = page 2 withdrawn → 775 items (157 removed by withdrawal). Train / val 85/15. **Test = fixed benchmark** (seed 4242, 600 images, 10 per cell, never in a manifest) + **OOD probe** (the 40 seed catalogue garments from a *different* generator, `make_seed_assets.py`). Thresholds were fixed before the runs (`evaluate.THRESHOLDS`).

### 3.1 Headline (generator v1, default)

| Head | Accuracy | Macro-F1 | ECE (calibrated / raw) | T | Worst photo-quality group | Fairness gap (quality / pattern / type) | Worst cell (n = 10) | Coverage at p ≥ 0.6 → accuracy when shown | **OOD accuracy (mean confidence)** | Released? |
|---|---|---|---|---|---|---|---|---|---|---|
| Garment type | 1.000 | 1.000 | 0.002 / 0.009 | 0.30 | 1.00 | 0.00 / 0.00 / 0.00 | 1.00 | 99.7 % → 100 % | **0.80 (1.00)**: overconfident by 0.20 | **No** (OOD overconfidence > 0.10) |
| Pattern family | 0.970 | 0.970 | 0.044 / 0.016 | 1.50 | blurry 0.915 | 0.085 / 0.073 / 0.033 | umushanana × kitenge × blurry 0.70 | 95 % → 98.8 % | **not measurable** (no family labels outside our generator) | **No** |
| Main colour | 0.993 | 0.993 | 0.006 / 0.010 | 0.30 | blurry 0.99 | 0.005 / 0.020 / 0.017 | dress × kitenge × blurry 0.90 | 99.8 % → 99.5 % | **1.00 (1.00)** | **Yes** |

Shared checks: PII screen passed, drift passed (PSI 0.001 between v1 and v2). `ModelEval.passed = true`, `heads_passed = ["colour"]`. Training + eval end to end takes ~12 s on one laptop CPU core. A suggestion takes ~36 ms through API → gateway → router → model.

### 3.2 What the spike taught us

- **The synthetic→real gap is the whole story.** In distribution the garment-type head is perfect. On garments drawn by another generator it drops to 0.80 accuracy at 100 % confidence. A live case in the dev catalogue: an umushanana photo was labelled "dress" with p = 1.00. Temperature scaling fitted on in-distribution data does not fix out-of-distribution overconfidence. That is why the OOD probe and the overconfidence limit (≤ 0.10) are now part of the gate.
- **Domain randomisation as implemented (generator v2) did not help.** In distribution, type accuracy fell to 0.79 (umushanana 0.20, worst cell 0.00) and blurry pattern accuracy to 0.87. OOD type accuracy went *down* to 0.725 (confidence 0.86). v1 stays the default. v2 is kept for the comparison (`POST /v1/ml/dataset/build` with `generator: 2`).
- **Photo quality is the binding fairness axis.** Blurry/noisy photos are the worst group in every run. The learning curve narrows the gap but doesn't close it at the cell level:

| Per-cell training images | Items | Pattern acc. | Pattern gap (quality) | Blurry pattern acc. | Worst pattern cell |
|---|---|---|---|---|---|
| 4 | 233 | 0.888 | 0.31 | 0.685 | 0.20 |
| 8 | 470 | 0.960 | 0.105 | 0.895 | 0.70 |
| 16 | 932 | 0.973 | 0.075 | 0.925 | 0.70 |
| 32 | 1 887 | 0.982 | 0.055 | 0.945 | 0.70 |

  Product implication: the readiness pipeline already asks for retakes on poor photos. Makers with poor light (often rural makers, coops) would get worse suggestions, so the gate must stay per photo-quality group.
- **Colour works.** It is the only attribute with OOD evidence. It is offered as a one-tap fix only when the typed colour maps to a *different* palette colour (a likely slip). Local colour names are kept.
- **PII screen.** Recall is 1.00 for every synthetic skin tone MST 3–10 (210 persons) and false drops are 1.7 % (360 garments). The 5 seeded synthetic personas are dropped and all 40 seed garments kept. Caveat: the test persons are simple illustrations. Real photos (partial bodies, mannequins, mirrors, children in the background) will be harder. Under-detection of darker skin is the known failure mode of skin heuristics, so production must use a learned detector, evaluated per MST.
- **Drift check.** It flags a generator change (feature PSI 0.22 > 0.20). It ignores a fresh seed of the same generator (0.007). It **misses** a composition shift: a batch of only low-light gold/crimson photos gave colour label PSI 0.11, under the threshold. Production needs per-cohort (contributor, region) monitoring and a lower label-PSI alert, around 0.1.

### 3.3 How the production version would fine-tune (GPU, LoRA)

- **Encoder (frozen, open, permissive).** Candidates: **DINOv2 ViT-S/14 or ViT-B/14** (Meta, Apache-2.0 code + weights), **SigLIP 2 base** (Google, Apache-2.0), or OpenCLIP ViT-B/16 (MIT code). For OpenCLIP, check the weights' training data: LAION-derived checkpoints carry dataset-provenance risk, so prefer DataComp/Re-LAION checkpoints or DINOv2. Keep our heads (category / pattern family / colour / quality). Add **LoRA** (rank 8–16 on attention q/v via PEFT, Apache-2.0) only if a linear probe on frozen features misses the gate.
- **Data.** The consented catalogue manifest (this pipeline) + synthetic augmentation. Labels are maker-entered and confirmed in the editor, which gives an active-learning loop from accepted / overridden suggestions. Keep a **real consented holdout** stratified by garment type × pattern family × photo quality × region, never trained on. This replaces our synthetic OOD probe.
- **Compute (estimate).** ~20 k images, ViT-B LoRA, 10 epochs ≈ 1–2 GPU-hours on one L4/A10-class GPU, i.e. single-digit USD per training run at on-demand prices. Inference on the E42 pool (KServe slot `attr`) is a few ms per image, batched. Weights stay in-region. Pin the exact weight hashes and record licences in ADR-0007's table.
- **Licence notes.** Apache-2.0 / MIT allow commercial use and modification. Keep NOTICE files and don't use non-commercial checkpoints (e.g. CC-BY-NC). Our fine-tuned weights are derived from maker-consented data, so they must be **retrained, not just filtered**, when a withdrawal hits the training set of the serving version. Production policy: retrain at least monthly and on every withdrawal batch, and retire superseded versions in the registry.

## 4. Results: trend insights

Synthetic signals: 11 204 rows (1 600 shoppers × 8 weeks × 4 regions, ASK / TRYON / ORDER), with planted, documented trends (gold for weddings rising, strongest in Kigali; forest green, imigongo and graduation season rising; dresses converting best at 20–40k; a rare colour asked by 6 shoppers; trousers > 70k sold by one maker).

| Check | Result |
|---|---|
| Planted trends recovered (vitest) | gold, imigongo, graduation rising; gold umushanana gap; dress price hint best at 20–40k |
| Small / dominated cells | lilac (6 shoppers) never shown; trousers > 70k (one maker) suppressed |
| Privacy audit (independent re-derivation from raw signals) | **2 743 published cells checked across 13 viewers (none + 12 makers), 0 below k, 0 maker-rule violations** |
| Distinct people, not events | one shopper asking 50 times counts once (test) |
| Bootstrap stability (cluster bootstrap over shoppers, B = 50) | national top-5 rising Jaccard **0.92**. Members see only items stable in ≥ 70 % of resamples (18 hidden as unstable on the dev run) |
| Suppression on the member view | 194 cells hidden (k / maker rule) |
| Stored as | `ModelEval(kind = TRENDS_PRIVACY, modelId = trends-spike@1, passed = true)` |

Lesson from the first eval: top-5 Jaccard over *all* regions hovered at 0.59–0.62, because near-tied small regional cells swap ranks. Rank stability is now measured on the national list, and regional items are judged by per-item stability. That is a methodology choice, made after we saw the data, and we state it here so nobody reads it as a pre-registered threshold.

**Known limits.** Growth is week-over-week interest from distinct people, not a forecast. Price-band hints are correlational ("a hint, not a promise" in the UI). Gaps use public catalogue supply, so a maker with private stock is invisible. With real volumes, many cells will be suppressed outside Kigali. That is expected and honest, but the card may often be empty for small regions.

## 5. Cost

| Item | Spike (measured) | Production (estimate) |
|---|---|---|
| Dataset build (940 items incl. screening) | ~5 s CPU | minutes per 20 k images on CPU; screening with a detector ~5 ms/img on GPU |
| Train + full eval | ~12 s CPU | 1–2 GPU-h per LoRA run (ViT-B), probe-only < 10 min |
| Model artefact | 28 KB JSON | ViT-B + LoRA adapter ~ 350 MB base (shared) + ~5 MB adapter |
| Suggestion latency | ~36 ms end to end | < 100 ms on the pool, batched |
| Trends | ~0.5 s per member view (bootstrap B = 20, cached 10 min) | precompute nightly per region; O(signals) |
| People | — | DPO review of the notice + DPIA addendum, ~2 days; native RW/FR copy review; annotation QA on the holdout (~1 week for 2 k images) |

## 6. Risks

- **Consent scope.** Makers consent for *garment attribute* training only. Re-using the dataset for generative models, design similarity or anything shown to other makers is out of scope and needs a new purpose. Coop pieces: the coop admin decides today; the credited maker's own consent should also be required (production item).
- **IP and cultural heritage.** Pattern families like imigongo are cultural heritage. A maker's specific design is IP. The model predicts a *family*, never reproduces a design, and the corpus is synthetic stand-ins. Production must not expose training images or nearest neighbours, and must offer takedown.
- **Bias.** Photo quality (lighting and cameras correlate with income and rurality) is the worst axis. The PII screen's skin heuristic risks under-detecting darker skin, measured fine here but on illustrations only. Pattern-family labels exist only for our own generator.
- **Overconfidence out of distribution.** Measured (0.20). Mitigated by OOD + overconfidence gates and per-head release, not by calibration alone.
- **Re-identification via trends.** Mitigated by k ≥ 10, rounding, maker rules and stability filtering. Remaining risk: differencing across overlapping regions and weeks for patient attackers. Production: noise (differential privacy, e.g. ε-budgeted Laplace on counts), cell caching, and an audit log of trend views.
- **Spike shortcuts.** The gateway imports `scripts/make_seed_assets.py` for the OOD probe. Model artefacts and the feature cache live on gateway disk and in memory. The `attr` route is not in the API's `inference-rules.ts` route list (adding it would break existing stored policies under zod 4's exhaustive record), so the admin Inference panel doesn't show it yet.

## 7. Recommendation and criteria

| Track | Decision | Criteria to move on |
|---|---|---|
| Consent ledger purposes, manifests, tombstones, PII screen pipeline | **Go** (pilot behind flag) | DPIA addendum + DPO sign-off on the notice; credited coop-maker consent; learned person detector with recall ≥ 0.98 per MST bucket on a consented real test set; withdrawal → retrain SLA (≤ 30 days) written down |
| Local attribute model | **Iterate** | On a **real consented holdout** (≥ 1 500 images, ≥ 20 makers, stratified by type × pattern × quality × region): per-head macro-F1 ≥ 0.90, worst marginal group ≥ 0.85, fairness gap ≤ 0.10, ECE ≤ 0.05, overconfidence ≤ 0.10, suggestion acceptance ≥ 60 % in a 2-week A/B with ≥ 30 makers. Until then only the colour head may be switched on, for makers who opt in. |
| Trend insights | **Go** (pilot behind flag, real ingest) | 4 weeks of real pseudonymised signals; privacy audit 0 violations every night; national top-5 Jaccard ≥ 0.6; DP noise or caching decision taken; ≥ 50 % of pilot members find the card useful (survey) with no complaint about exposure |
| No-go triggers | — | any shopper datum found in a manifest; any published cell below k; screen recall < 0.95 for any skin-tone bucket; a maker's sales inferable in a red-team exercise |

## 8. How to reproduce

```bash
# AI gateway with this branch (route attr, /v1/ml/*); tests
cd apps/ai && $MAIN/apps/ai/.venv/bin/pytest -q tests/test_mlspike.py
$MAIN/apps/ai/.venv/bin/python scripts/mlspike_experiments.py main|curve|drift|screen   # tables above
# API tests (consent gating, k-anonymity, trends, bootstrap)
cd apps/api && npx vitest run src/modules/mlspike
# End to end (Pixel 7): opt-in → dataset v(n), withdrawal → v(n+1) → eval → gated activation → ✨ suggestion → trends
BASE_URL=http://localhost:3103 API_URL=http://localhost:4103 node scripts/crawl-mlspike.mjs
```
