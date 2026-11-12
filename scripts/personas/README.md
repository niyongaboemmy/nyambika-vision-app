# Synthetic personas (try-on models)

Eight AI-generated, fictional full-body people for try-on demos, the AI product studio and the synthetic pilot. They
replace the current flat-illustration personas. **No real person is used anywhere**: no stock photos, no CC photos
of people, no face references.

| | |
|---|---|
| Model | `Tongyi-MAI/Z-Image-Turbo` (Apache-2.0, 6B, 9 steps). Fallback `black-forest-labs/FLUX.1-schnell` (Apache-2.0, 4 steps). Never FLUX.1-dev (non-commercial). |
| Matrix | p1–p5 women, p6–p8 men; Monk skin tones 6–10; sizes S–XL; ages 24–50 (see `PERSONAS` in `generate.py`) |
| Pose | Full body, front, A-pose, neutral expression, plain grey fitted base clothes, seamless light-grey backdrop |
| Output | `persona-1.png` … `persona-8.png`, 720×1280, EXIF stripped, PNG text + XMP `DigitalSourceType=trainedAlgorithmicMedia`, "AI-generated, fictional person" |
| Provenance | `candidates/log.jsonl` (prompt, negative, seed, model id + Hugging Face commit, steps, device) and `generation.json` for the picked set |

## Where to run it

Not on the 16 GB dev laptop. Either:

- **Rented GPU** (RTX 4090 / A10 / L4, ≥ 16 GB VRAM): about 1–2 h including review, under USD 5.
- **Apple Silicon Mac with ≥ 32 GB unified memory** (MPS, bf16): about 1–3 min per image.

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r scripts/personas/requirements.txt
huggingface-cli login            # only if the model download asks for it
```

## Steps

```bash
cd scripts/personas
python generate.py candidates --out out --seeds 20          # 8 × 20 candidates (add --model flux-schnell for the fallback)
# Human review of out/candidates/: realism, anatomy, hands, full body in frame, no caricatured features (bias review).
python generate.py pick --out out p1=1004 p2=1011 p3=1002 p4=1017 p5=1008 p6=1013 p7=1001 p8=1019
python generate.py check --out out                          # writes out/resemblance-check.md
# Upload each persona to Google Lens and TinEye; reject and regenerate any that looks like a real or known person.
python generate.py check --out out --confirm                # records the check in generation.json
```

## Swap-in (one seed run)

```bash
cp scripts/personas/out/persona-*.png scripts/personas/out/generation.json apps/api/storage/personas/
pnpm --filter @nyambika/api db:seed:personas                # or the full: pnpm --filter @nyambika/api db:seed
```

The persona seed (`apps/api/prisma/seed-personas.ts`) sees `generation.json`, keeps the PNGs (no longer overwrites them
with the illustrations), counts the personas (8), and writes `storage/personas/manifest.json` with a new set version.
The API reads that manifest (`src/modules/twin/personas.ts`), so without code changes:

- the persona picker (3D mirror, AI studio) offers 8 personas;
- every persona try-on cache key becomes `persona-N:vX`, so old renders on the illustrated set are not reused;
- the 3D turnaround cache moves to `public/personas/turnaround/vX/`;
- `db:seed:pilot` encrypts the new images as the synthetic pilot twins on its next run.

To go back to the illustrated set, delete `generation.json` and `persona-6..8.png` from `apps/api/storage/personas/`
and re-run `db:seed:personas` (version returns to 0).

UI: label personas as "Synthetic model" wherever they appear (the app already marks persona renders as AI models).
