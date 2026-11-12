"""Generate the 8 synthetic try-on personas (fictional people, AI-generated) for Nyambika seed data.

Recommended model: Tongyi-MAI/Z-Image-Turbo (Apache-2.0). Fallback: black-forest-labs/FLUX.1-schnell (Apache-2.0).
Never use FLUX.1-dev (non-commercial) or photos of real people. See README.md in this folder.

Three steps, each logged:

  python generate.py candidates --out out/ [--model z-image|flux-schnell] [--seeds 20] [--only p1,p4]
      → out/candidates/p1-<seed>.png … and out/candidates/log.jsonl (prompt, negative, seed, model id + commit)
  python generate.py pick --out out/ p1=12345 p2=777 …      (after human review: realism, anatomy, hands, bias)
      → out/persona-1.png … persona-8.png (720×1280, EXIF stripped, "AI-generated, fictional person" metadata)
        out/generation.json (provenance; read by the API seed)
  python generate.py check --out out/                        (reverse-image resemblance check)
      → out/resemblance-check.md: one row per persona to tick after Google Lens / TinEye; `pick` refuses to
        mark the set publishable until every row is ticked (re-run `check --confirm` once done).

Swap-in: copy out/persona-*.png and out/generation.json into apps/api/storage/personas/ and run
`pnpm --filter @nyambika/api db:seed:personas` (or the full `db:seed`). Runs on a CUDA GPU (≥ 16 GB VRAM) or an
Apple Silicon Mac with ≥ 32 GB unified memory (MPS). Not runnable on the 16 GB dev laptop.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

W, H = 720, 1280  # final persona size (matches the illustrated set and the try-on pipeline)
GEN_W, GEN_H = 768, 1344  # generation size (multiple of 64), centre-cropped to 9:16 then resized

MODELS = {
    "z-image": {"id": "Tongyi-MAI/Z-Image-Turbo", "licence": "Apache-2.0", "steps": 9, "guidance": 0.0},
    "flux-schnell": {"id": "black-forest-labs/FLUX.1-schnell", "licence": "Apache-2.0", "steps": 4, "guidance": 0.0},
}

# Persona matrix (research §2b): Monk Skin Tone 6–10 × sizes S–XL, women and men, adults 24–50.
MST = {6: "#a07e56", 7: "#825c43", 8: "#604134", 9: "#3a312a", 10: "#292420"}
MST_WORDS = {6: "medium-tan brown", 7: "warm medium brown", 8: "deep brown", 9: "very deep brown", 10: "deepest brown"}
SIZE_WORDS = {"S": "slim build", "M": "average build", "L": "full-figured build", "XL": "curvy plus-size build"}
PERSONAS = [
    {"id": "p1", "gender": "woman", "mst": 6, "size": "S", "age": 24, "hair": "long box braids tied back"},
    {"id": "p2", "gender": "woman", "mst": 7, "size": "M", "age": 31, "hair": "short natural hair"},
    {"id": "p3", "gender": "woman", "mst": 8, "size": "L", "age": 42, "hair": "low bun"},
    {"id": "p4", "gender": "woman", "mst": 9, "size": "XL", "age": 50, "hair": "short natural hair"},
    {"id": "p5", "gender": "woman", "mst": 10, "size": "M", "age": 28, "hair": "shoulder-length locs tied back"},
    {"id": "p6", "gender": "man", "mst": 7, "size": "M", "age": 35, "hair": "close-cropped hair"},
    {"id": "p7", "gender": "man", "mst": 9, "size": "L", "age": 45, "hair": "close-cropped hair and a short beard"},
    {"id": "p8", "gender": "man", "mst": 10, "size": "XL", "age": 27, "hair": "close-cropped hair"},
]

PROMPT = (
    "full-body studio photograph of a fictional {age}-year-old East African {gender}, Monk skin tone {mst} "
    "({skin} skin), {build}, {hair}, standing straight facing the camera, arms slightly away from the body in an "
    "A-pose, neutral relaxed expression, plain flat shoes, fitted plain grey tank top and fitted grey leggings, "
    "seamless light-grey backdrop, soft even lighting, 85mm lens, sharp focus, entire body from head to toe in frame"
)
NEGATIVE = "jewellery, logo, text, watermark, tattoo, props, hat, sunglasses, cropped feet, cropped head, extra limbs, deformed hands, nudity"


def prompt_for(p: dict) -> str:
    return PROMPT.format(age=p["age"], gender=p["gender"], mst=p["mst"], skin=MST_WORDS[p["mst"]], build=SIZE_WORDS[p["size"]], hair=p["hair"])


def device_and_dtype():
    import torch

    if torch.cuda.is_available():
        return "cuda", torch.bfloat16
    if torch.backends.mps.is_available():
        return "mps", torch.bfloat16
    sys.exit("No CUDA GPU or Apple MPS device found. Run on a rented GPU or a ≥ 32 GB Apple Silicon Mac (see README).")


def model_commit(model_id: str) -> str:
    try:
        from huggingface_hub import model_info

        return model_info(model_id).sha or "unknown"
    except Exception:  # offline: the commit is still pinned in the local cache folder name
        return "unknown"


def load_pipeline(key: str):
    from diffusers import DiffusionPipeline

    dev, dtype = device_and_dtype()
    spec = MODELS[key]
    pipe = DiffusionPipeline.from_pretrained(spec["id"], torch_dtype=dtype)
    if dev == "mps":
        pipe = pipe.to("mps")
        pipe.enable_attention_slicing()
    else:
        pipe.enable_model_cpu_offload()  # fits 16–24 GB cards
    return pipe, dev


def to_persona_size(img):
    from PIL import Image

    target = W / H
    w, h = img.size
    if w / h > target:
        nw = int(h * target)
        img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w / target)
        img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return img.convert("RGB").resize((W, H), Image.LANCZOS)


def cmd_candidates(args) -> int:
    import torch

    out = Path(args.out)
    (out / "candidates").mkdir(parents=True, exist_ok=True)
    spec = MODELS[args.model]
    pipe, dev = load_pipeline(args.model)
    commit = model_commit(spec["id"])
    only = set(filter(None, args.only.split(",")))
    with open(out / "candidates" / "log.jsonl", "a") as log:
        for p in PERSONAS:
            if only and p["id"] not in only:
                continue
            prompt = prompt_for(p)
            for k in range(args.seeds):
                seed = args.base_seed + k
                t0 = time.time()
                kw = dict(prompt=prompt, width=GEN_W, height=GEN_H, num_inference_steps=spec["steps"], guidance_scale=spec["guidance"],
                          generator=torch.Generator("cpu").manual_seed(seed))
                if args.model == "z-image":
                    kw["negative_prompt"] = NEGATIVE
                else:
                    kw["max_sequence_length"] = 256  # schnell ignores negative prompts
                img = pipe(**kw).images[0]
                path = out / "candidates" / f"{p['id']}-{seed}.png"
                img.save(path)
                log.write(json.dumps({"persona": p["id"], "seed": seed, "file": path.name, "prompt": prompt, "negative": NEGATIVE if args.model == "z-image" else None,
                                      "model": spec["id"], "modelCommit": commit, "licence": spec["licence"], "steps": spec["steps"], "guidance": spec["guidance"],
                                      "size": [GEN_W, GEN_H], "device": dev, "seconds": round(time.time() - t0, 1)}) + "\n")
                print(f"{p['id']} seed {seed} → {path.name}")
    print("Review the candidates (realism, anatomy, hands, no caricature), then run: generate.py pick p1=<seed> …")
    return 0


def write_png(img, path: Path, meta: dict) -> None:
    """Save without EXIF, with PNG text chunks + XMP marking the image as AI-generated (IPTC trainedAlgorithmicMedia)."""
    from PIL import PngImagePlugin

    xmp = (
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia">'
        '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">AI-generated, fictional person. Synthetic model for Nyambika try-on demos.</rdf:li></rdf:Alt></dc:description>'
        "</rdf:Description></rdf:RDF></x:xmpmeta>"
    )
    info = PngImagePlugin.PngInfo()
    info.add_text("Description", "AI-generated, fictional person")
    info.add_text("DigitalSourceType", "trainedAlgorithmicMedia")
    info.add_text("Software", f"{meta['model']}@{meta['modelCommit']}")
    info.add_text("Comment", json.dumps({k: meta[k] for k in ("persona", "seed", "model", "modelCommit")}))
    info.add_itxt("XML:com.adobe.xmp", xmp)
    clean = img.copy()
    clean.info = {}
    clean.save(path, pnginfo=info)


def cmd_pick(args) -> int:
    from PIL import Image

    out = Path(args.out)
    log = [json.loads(line) for line in (out / "candidates" / "log.jsonl").read_text().splitlines() if line.strip()]
    picks = dict(a.split("=", 1) for a in args.picks)
    missing = [p["id"] for p in PERSONAS if p["id"] not in picks]
    if missing:
        sys.exit(f"pick one seed for every persona; missing: {', '.join(missing)}")
    entries = []
    for i, p in enumerate(PERSONAS, start=1):
        row = next((r for r in log if r["persona"] == p["id"] and str(r["seed"]) == picks[p["id"]]), None)
        if not row:
            sys.exit(f"{p['id']} seed {picks[p['id']]} not found in candidates/log.jsonl")
        img = to_persona_size(Image.open(out / "candidates" / row["file"]))
        dest = out / f"persona-{i}.png"
        write_png(img, dest, row)
        entries.append({"id": p["id"], "file": dest.name, "gender": p["gender"], "mst": p["mst"], "mstHex": MST[p["mst"]], "size": p["size"], "age": p["age"],
                        "prompt": row["prompt"], "negative": row["negative"], "seed": row["seed"], "model": row["model"], "modelCommit": row["modelCommit"],
                        "licence": row["licence"], "sha256": hashlib.sha256(dest.read_bytes()).hexdigest(), "label": "AI-generated, fictional person"})
        print(f"✓ persona-{i}.png ← {row['file']}")
    gen = {"generator": entries[0]["model"].split("/")[-1], "synthetic": True, "createdAt": datetime.now(timezone.utc).isoformat(),
           "resemblanceCheck": "pending", "personas": entries}
    (out / "generation.json").write_text(json.dumps(gen, indent=2))
    print("Next: generate.py check, then copy persona-*.png + generation.json into apps/api/storage/personas/")
    return 0


def cmd_check(args) -> int:
    out = Path(args.out)
    gen_path = out / "generation.json"
    gen = json.loads(gen_path.read_text())
    sheet = out / "resemblance-check.md"
    if args.confirm:
        text = sheet.read_text()
        if "- [ ]" in text:
            sys.exit("resemblance-check.md still has unticked rows")
        gen["resemblanceCheck"] = f"passed {datetime.now(timezone.utc).date()}"
        gen_path.write_text(json.dumps(gen, indent=2))
        print("✓ resemblance check recorded in generation.json")
        return 0
    rows = ["# Reverse-image resemblance check", "",
            "Upload each file to Google Lens (lens.google.com) and TinEye (tineye.com). Reject and regenerate any persona that",
            "resembles a real or known person. Tick the box only when neither search returns a likely match.", ""]
    rows += [f"- [ ] persona-{i}.png ({e['id']}, MST {e['mst']}, {e['size']}): Lens ☐  TinEye ☐  reviewer: ____" for i, e in enumerate(gen["personas"], start=1)]
    sheet.write_text("\n".join(rows) + "\n")
    print(f"Wrote {sheet}. Tick every row, then run: generate.py check --confirm")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("candidates")
    c.add_argument("--out", default="out")
    c.add_argument("--model", choices=list(MODELS), default="z-image")
    c.add_argument("--seeds", type=int, default=20)
    c.add_argument("--base-seed", type=int, default=1000)
    c.add_argument("--only", default="")
    p = sub.add_parser("pick")
    p.add_argument("--out", default="out")
    p.add_argument("picks", nargs="+", help="p1=<seed> … p8=<seed>")
    k = sub.add_parser("check")
    k.add_argument("--out", default="out")
    k.add_argument("--confirm", action="store_true")
    args = ap.parse_args()
    return {"candidates": cmd_candidates, "pick": cmd_pick, "check": cmd_check}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
