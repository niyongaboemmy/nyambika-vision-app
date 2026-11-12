# Try-on quality (local compositor), Nov 2026

The lead tested the gateway with a real product photo of a plain short-sleeve tee (Wikimedia Commons
"BrownIEditShirt-plainBackground.png", CC BY-SA 3.0) on synthetic personas 3 and 5. This pass fixes what that test
found, inside the CPU stand-in (`apps/ai/app/providers/local_compositor.py`, `garment.py`, `guard.py`,
`landmarks.py`). The stand-in is still not a generative try-on model; see "What the stand-in cannot do" below.

| Finding | Fix |
|---|---|
| The persona's white undershirt showed at the shoulders and torso sides | The twin's upper garment is segmented: a near-uniform colour region connected to the chest, distinct from the skin tone sampled at the neck, plus its anti-aliased/ringing rim. Every part the new garment leaves exposed is filled with **skin** (upper arms continuing under the old sleeves, the neck, the midriff, necklines framed by the new garment) or with **background** (outside the body). Skin tone comes from the twin's own visible skin. On a plain backdrop the fill uses the exact backdrop colour. The identity region (head, top 16% of the subject) is never modified and stays pixel-identical. |
| Non-uniform stretch made shirts boxy and distorted prints | One scale factor: the garment's flat chest width (waistband for skirts) is matched to the twin's torso width with ease, bounded by the shoulders (0.6 to 0.95 × shoulder width) and divided by a wrap factor (0.78, flat-lay width to front-projected worn width). Length follows the garment's own aspect. The collar is anchored at the neck base (skirts: waistband at the waist). Hem clamp per class (top 0.49 to 0.64 of body height, i.e. at the hips; skirt and dress up to calf 0.86), with at most ±20% vertical correction and a small uniform shrink for very long tops. A PIL MESH warp wraps the torso cylindrically (prints stay true in the centre and compress toward the sides), lets sleeves hang outward and nudges torso rows toward the silhouette (±6%). Shading keeps the garment's own luminance and darkens the sides and edges. The cut-out's light rim is decontaminated (no white halo on dark fabric). |
| Dark garments failed the photo check | Exposure is no longer judged on mean luminance. It fails on: no highlight anywhere (p99 < 100: underexposed), more than 35% of garment pixels crushed or blown, a very dark or very bright garment with no texture (mean high-pass < 0.5), or a flat histogram (p98 − p2 < 40). Notes now say which: too dark, overexposed or washed out. |
| The guard passed a shirt rendered as a dress | New `placement_implausible` reason: the rendered garment box against body landmarks (collar within 7% of body height of the neck base, or skirt waistband at 0.30 to 0.52; hem inside the class band; width 0.7 to 3.4 × shoulders; centred). New `garment_distorted` reason: rendered aspect vs cut-out aspect outside 0.6 to 1.6. Skin-tone delta now compares skin with skin (eroded so motion frames still align) and ignores pixels the provider deliberately changed. |
| Unknown categories were silently treated as a dress | `garment.canonical_category` maps catalogue text case-insensitively in EN/FR/RW (shirt, t-shirt, tee, polo, top, blouse, jacket, skirt, jupe, ijipo, dress, robe, gown, umushanana, kanzu…). The head noun wins ("dress shirt" is a top, "shirt dress" is a dress). Fabric/style words (kitenge, wrap, ankara…) and unknown text are guessed from the cut-out's shape (sleeves, flare, aspect). The verdict carries `placement.class` and `class_source`. |

## Grid

After: `docs/quality/tryon-grid.png` (5 personas × procedural brown tee, kitenge dress, skirt, kitenge shirt).
Before: `docs/quality/tryon-grid-before.png` (same inputs, previous compositor). The grid uses a procedural brown tee
in place of the Wikimedia photo, because that photo carries a third-party word mark. `--real` renders the real tee to
the git-ignored `apps/ai/tests/fixtures/.cache/tryon-grid-real-*.png`, and its numbers are in the table.

## Metrics

Produced by `apps/ai/scripts/tryon_quality.py --label before|after --real`. Each row averages 5 personas, PREVIEW
tier, and runs the full gateway path (readiness cut-out → provider → AI label → guard).

- **Placement err**: collar distance from the anchor plus the hem's distance outside its band, as % of body height.
- **Undershirt leak**: share of the persona's undershirt pixels still visible (tops and dresses only).
- **Aspect distortion**: |rendered h/w ÷ cut-out h/w − 1|. After the fix it is mostly the intended wrap: a flat-lay
  tee is about 28% wider than it looks when worn. Before the fix the tee was stretched about 2.2× vertically.
- **Guard**: "before" rows show the previous guard, which had no placement check and passed every render, including
  the tee rendered as a dress. Re-checked with the new guard, that render is withheld with `placement_implausible` and
  `garment_distorted` (`test_guard_withholds_a_shirt_placed_as_a_dress`).
- **Latency**: provider + label + guard. The "before" figures were measured on a quieter machine. Compositor alone is
  about 220 to 260 ms at HD (1024 px) and about 70 ms at PREVIEW; the guard adds about 60 to 100 ms. These were
  measured while other agents shared the CPU (load average about 10).

<!-- metrics:start -->
| Garment (category sent) | Run | Readiness (exposure) | Placement err % | Undershirt leak % | Aspect distortion % | Guard pass /5 (reasons) | Latency ms |
|---|---|---|---|---|---|---|---|
| tee-brown (`t-shirt`) | before | READY (ok) | 6.11 | 9.97 | 119.76 | 5 (-) | 44.8 |
| tee-brown (`t-shirt`) | after | READY (ok) | 1.13 | 0 | 22.94 | 5 (-) | 126.8 |
| kitenge-dress (`Kitenge dress`) | before | READY (ok) | 0.91 | 9.82 | 22.14 | 5 (-) | 42.8 |
| kitenge-dress (`Kitenge dress`) | after | READY (ok) | 0.91 | 0 | 8.42 | 5 (-) | 137.8 |
| skirt (`skirt`) | before | READY (ok) | 4.08 | n/a | 12.4 | 5 (-) | 40 |
| skirt (`skirt`) | after | READY (ok) | 0.91 | n/a | 16.48 | 5 (-) | 90.4 |
| shirt (`shirt`) | before | READY (ok) | 0.91 | 0.25 | 24.1 | 5 (-) | 75.8 |
| shirt (`shirt`) | after | READY (ok) | 1 | 0 | 7.8 | 5 (-) | 122.4 |
| tee-dark (`tee`) | before | READY (ok) | 6.11 | 9.91 | 119.76 | 5 (-) | 41 |
| tee-dark (`tee`) | after | READY (ok) | 1.13 | 0 | 22.74 | 5 (-) | 121.8 |
| tee-light (`Polo`) | before | READY (ok) | 6.11 | 10.15 | 119.38 | 5 (-) | 42.8 |
| tee-light (`Polo`) | after | READY (ok) | 1.13 | 0 | 23.46 | 5 (-) | 122.2 |
| tee-mid (`(empty)`) | before | READY (ok) | 6.11 | 9.98 | 119.76 | 5 (-) | 40.8 |
| tee-mid (`(empty)`) | after | READY (ok) | 1.13 | 0 | 22.58 | 5 (-) | 124.4 |
| real-tee (`T-Shirt`) | before | NEEDS_BETTER_PHOTO (fail) | 6.56 | 7.59 | 98.7 | 5 (-) | 48.8 |
| real-tee (`T-Shirt`) | after | READY (ok) | 1.13 | 0 | 18.4 | 5 (-) | 158 |

HD tier (1024 px) mean latency, tee on all personas: before 85.2 ms, after 278.8 ms.
<!-- metrics:end -->

Exposure tests (`apps/ai/tests/test_tryon_quality.py`): dark, brown, mid and light tees pass. Underexposed (×0.12
plus noise), crushed (gamma 2.6), blown (×6 + 90) and washed-out (contrast ÷ 6.7) versions of dark, mid and light tees
all fail. The seeded patterned garments still pass.

## What the stand-in cannot do

- **No draping.** The garment is a warped 2D cut-out. There are no folds from the body's pose, no gravity and no fabric
  physics; wrinkles are only those already in the product photo.
- **No occlusion.** Arms crossing the body, hair over the collar and hands in pockets are not handled. The garment is
  always on top of everything below the head, and the old garment is hidden only where it is a near-uniform region
  (true for the personas, approximate for real clothes with prints or layers). Lower garments (the jeans) are never
  hidden, so a short dress shows the jeans underneath.
- **One front pose.** Landmarks come from a front-facing silhouette with standard proportions. Side poses, sitting,
  and children's proportions are out of scope.
- **The worn width is an approximation.** The worn width comes from a fixed wrap factor. Stretch knits, oversized cuts
  and size-specific fit are not modelled (the 3D drape spike covers fit separately).
- **Cut-out limits.** A light grey garment on a white sheet can lose a few edge pixels to the shadow-aware background
  removal. A white garment on a white sheet fails `in_frame`.
- The NLB for still try-on (`app/avatar_eval.py` pattern) uses synthetic personas only. The quality numbers above are
  automated metrics, not a human panel.

## What a real VTON provider adapter needs

- Implement `VTONProvider.generate` (`apps/ai/app/providers/base.py`) and return `VTONResult` with `garment_alpha`
  (garment mask in output coordinates) and, if the provider hides old clothing, `edit_mask`. The guard then keeps
  working unchanged, including `placement_implausible` (pass the catalogue category, as `/v1/tryon` does).
- Route it through the existing slots, not a new path: the E42 router's `hosted` backend
  (`HOSTED_VTON_PROVIDER`, mock-tested contract like the video `hosted-rest` slot) or a self-hosted `pool` backend
  (KServe v2 / OpenAI-compatible), with the in-region policy and fallback to this compositor (ADR-0007).
- **Licence (ADR-0007, CON-02 / AI-BM-05):** commercial use must be allowed. IDM-VTON, OOTDiffusion, CatVTON and
  StableVITON (CC BY-NC-SA 4.0) and anything trained on VITON-HD / DressCode are rejected. A contracted hosted API needs
  a DPA and in-region processing for RW data. Any new model version must pass the NLB release gate on all 5 personas
  (skin tones MST 6 to 10) before `activate`.
- Keep the AI label and C2PA signing in the gateway, after the provider returns.

## Testing on real people

Real-person photos are never seeded or committed. To test on yourself or a consenting colleague, use the app's Mirror:

1. Sign in as a shopper (e.g. `0788000001`, dev OTP shown on screen) and open **Mirror** (`/mirror`).
2. Read and switch on the consent card (twin creation is refused without it; consent is logged by `ConsentService`).
3. Upload or take a full-body, upright photo on a plain wall in soft light. The twin checks (resolution, portrait,
   lighting, one person, head to feet) must all pass. The twin is stored encrypted and served only through signed URLs.
4. Open a maker page (e.g. `/m/kigali-kitenge-house`), pick **Plain cotton tee** (or any product) and tap
   **Try on me**. Withheld looks show no image. The guard verdict (with `reasons`, and `placement` from the gateway)
   is stored on the generation record, and a withheld look also raises a `GUARD_WITHHELD` flag with its reasons for
   the host.
5. When done, delete the twin under Mirror → **Manage or delete my twin** (`/trust`, right to erasure).

## Seeded plain tee

`Plain cotton tee` on Kigali Kitenge House, category `t-shirt`, in Charcoal, Chocolate, Rust and Sky; all four are
READY. The photos are procedural (`make_seed_assets.py --tee`, in-house, no logo, no person). Source and licence are
recorded in `apps/api/prisma/seed-tee.ts` and in `storage/seed/tee/SOURCE.json`. Seed with `pnpm db:seed:tee` (also
run at the end of `pnpm db:seed`). Set `AI_PYTHON` to the venv's Python in a worktree without its own `.venv`.
