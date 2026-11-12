"""Try-on quality evaluation for the local compositor: grid + metrics (lead's quality pass, Nov 2026).

Renders 5 synthetic personas x garment fixtures through the configured VTON provider and the runtime
guard, exactly like `POST /v1/tryon` (readiness cut-out -> provider -> AI label -> guard), then writes

  docs/quality/tryon-grid[-LABEL].png     the render grid (synthetic garments only; never the real photo)
  docs/quality/tryon-metrics-LABEL.json   per-render metrics
  docs/quality/tryon-quality.md           table comparing every label found (e.g. before / after)

Metrics (all computed from the persona silhouette, independent of the provider's internals):
  placement_err_pct  |garment top - anchor| + distance of the hem outside its category band, % of body height
  leakage_pct        share of the persona's light undershirt still visible after try-on (tops and dresses)
  aspect_dist_pct    |rendered h/w / cut-out h/w - 1|: non-uniform stretching
  guard              guard verdict and reasons
  latency_ms         provider + guard, PREVIEW tier (HD reported separately)

Usage (from apps/ai): .venv/bin/python scripts/tryon_quality.py --label after [--real]
`--real` adds the Wikimedia brown tee (fetched, local only) to the metrics and writes its grid to the
git-ignored fixtures cache instead of docs/.
"""
from __future__ import annotations

import argparse
import inspect
import json
import statistics
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import make_seed_assets as seeds  # noqa: E402
import quality_fixtures as fx  # noqa: E402
from app import config, garment, guard  # noqa: E402
from app.landmarks import HEM_TARGET, PLACEMENT, landmarks  # noqa: E402
from app.main import _label  # noqa: E402
from app.providers import get_provider  # noqa: E402
from app.twin import subject  # noqa: E402

DOCS = ROOT.parents[1] / "docs" / "quality"
UNDERSHIRT = np.array([236, 232, 226], dtype=np.float32)  # make_seed_assets.persona tee colour
GRID_ROWS = [("tee-brown", "t-shirt", "top"), ("kitenge-dress", "Kitenge dress", "dress"),
             ("skirt", "skirt", "skirt"), ("shirt", "shirt", "top")]
EXTRA_ROWS = [("tee-dark", "tee", "top"), ("tee-light", "Polo", "top"), ("tee-mid", "", "top")]


def _alpha_box(a: np.ndarray, thr: float):
    ys, xs = np.nonzero(a > thr)
    if len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def metrics(twin_resized: Image.Image, output: Image.Image, alpha: np.ndarray | None, cut: Image.Image, cls: str) -> dict:
    tw = np.asarray(twin_resized.convert("RGB"), dtype=np.float32)
    out = np.asarray(output.convert("RGB"), dtype=np.float32)
    mask, box = subject(twin_resized)
    body = landmarks(mask, box)
    if alpha is None:
        alpha = (np.abs(tw - out).max(axis=-1) > 24).astype(np.float32)
    gb = _alpha_box(alpha, 0.5)
    res: dict = {}
    if gb:
        anchor = body.neck_y if PLACEMENT[cls]["anchor"] == "neck" else body.waist_y
        lo, hi = PLACEMENT[cls]["hem"]
        hem = body.frac(gb[3])
        hem_out = max(0.0, lo - hem, hem - hi)
        res["placement_err_pct"] = round(100 * (abs(gb[1] - anchor) / body.height + hem_out), 2)
        res["hem_frac"] = round(hem, 3)
        res["hem_target"] = HEM_TARGET[cls]
        ca = np.asarray(cut)[..., 3]
        cb = _alpha_box(ca, 127)
        r_aspect = (gb[3] - gb[1]) / max(1, gb[2] - gb[0])
        c_aspect = (cb[3] - cb[1]) / max(1, cb[2] - cb[0])
        res["aspect_dist_pct"] = round(100 * abs(r_aspect / c_aspect - 1), 1)
    else:
        res.update(placement_err_pct=None, aspect_dist_pct=None)
    if cls in ("top", "dress"):
        rows = np.arange(tw.shape[0])[:, None] >= body.head_y1
        shirt = (np.abs(tw - UNDERSHIRT).max(axis=-1) <= 18) & mask & rows
        still = shirt & (np.abs(out - UNDERSHIRT).max(axis=-1) <= 18)
        res["leakage_pct"] = round(100 * still.sum() / max(1, shirt.sum()), 2)
    else:
        res["leakage_pct"] = None
    return res


def run_one(provider, twin: Image.Image, cut: Image.Image, category: str, tier: str):
    started = time.perf_counter()
    r = provider.generate(twin, cut, category, tier)
    labelled, label_box = _label(r.image)
    kwargs = {"exclude_box": label_box}
    if "category" in inspect.signature(guard.evaluate).parameters:
        kwargs["category"] = category
    verdict = guard.evaluate(r.twin_resized, labelled, cut, r.garment_alpha, r.subject_box, **kwargs)
    return r, labelled, verdict, int((time.perf_counter() - started) * 1000)


def _cell(img: Image.Image, verdict: dict, w: int = 180, h: int = 320) -> Image.Image:
    c = img.convert("RGB").copy()
    c.thumbnail((w, h), Image.LANCZOS)
    cell = Image.new("RGB", (w, h), (20, 18, 24))
    cell.paste(c, ((w - c.width) // 2, (h - c.height) // 2))
    d = ImageDraw.Draw(cell)
    ok = verdict["passed"]
    tag = "PASS" if ok else "WITHHELD " + ",".join(verdict["reasons"])[:26]
    d.rectangle((0, 0, w, 16), fill=(18, 110, 60) if ok else (150, 30, 30))
    d.text((4, 2), tag, fill=(255, 255, 255), font_size=11)
    return cell


def grid(cells: list[list[Image.Image]], row_names: list[str], path: Path, title: str):
    w, h, lab = 180, 320, 110
    top = 44
    out = Image.new("RGB", (lab + w * 5, top + h * len(cells)), (250, 248, 244))
    d = ImageDraw.Draw(out)
    d.text((8, 6), title, fill=(30, 30, 30), font_size=13)
    for i in range(5):
        d.text((lab + i * w + 60, 26), f"persona {i + 1}", fill=(30, 30, 30), font_size=12)
    for r, row in enumerate(cells):
        d.text((6, top + r * h + h // 2), row_names[r], fill=(30, 30, 30), font_size=12)
        for i, c in enumerate(row):
            out.paste(c, (lab + i * w, top + r * h))
    path.parent.mkdir(parents=True, exist_ok=True)
    out = out.quantize(colors=192, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    out.save(path, optimize=True)


def evaluate(label: str, real: bool = False) -> dict:
    provider = get_provider(config.VTON_PROVIDER)
    tmp = Path(tempfile.mkdtemp(prefix="tryonq-"))
    personas = []
    for i, (skin, wf) in enumerate(seeds.PERSONAS, start=1):
        personas.append(Image.open(seeds.persona(skin, wf, tmp / f"persona-{i}.png")))
    photos = {k: Image.open(p) for k, (p, _) in fx.synthetic(tmp / "garments").items()}
    rows_def = GRID_ROWS + EXTRA_ROWS
    if real:
        tee = fx.real_tee()
        if tee is not None:
            photos["real-tee"] = tee
            rows_def = rows_def + [("real-tee", "T-Shirt", "top")]
    rows, cells, readiness = [], {}, {}
    for name, category, cls in rows_def:
        a = garment.assess(photos[name], category)
        readiness[name] = {"readiness": a["readiness"], "checks": a["checks"]}
        cut = a["cutout"]
        for p, twin in enumerate(personas, start=1):
            r, labelled, verdict, ms = run_one(provider, twin, cut, category, "PREVIEW")
            m = metrics(r.twin_resized, labelled, r.garment_alpha, cut, cls)
            rows.append({"garment": name, "category": category, "class": cls, "persona": p, **m,
                         "guard_passed": verdict["passed"], "reasons": verdict["reasons"],
                         "identity": verdict["identity_similarity"], "fidelity": verdict["garment_fidelity"],
                         "latency_ms": ms})
            cells.setdefault(name, []).append(_cell(labelled, verdict))
    hd = [run_one(provider, personas[i], garment.assess(photos["tee-brown"], "t-shirt")["cutout"], "t-shirt", "HD")[3]
          for i in range(5)]
    report = {"label": label, "provider": provider.model_version("PREVIEW"), "rows": rows, "readiness": readiness,
              "hd_latency_ms_mean": round(statistics.mean(hd), 1)}
    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / f"tryon-metrics-{label}.json").write_text(json.dumps(report, indent=1))
    names = [n for n, _, _ in GRID_ROWS]
    suffix = "" if label == "after" else f"-{label}"
    grid([cells[n] for n in names], names, DOCS / f"tryon-grid{suffix}.png",
         f"Local compositor try-on grid ({label}); synthetic personas and garments")
    if "real-tee" in cells:
        grid([cells["real-tee"]], ["real tee"], fx.CACHE / f"tryon-grid-real-{label}.png", f"Real tee ({label}), local only")
    return report


def summarise(report: dict) -> dict:
    out = {}
    for g in dict.fromkeys(r["garment"] for r in report["rows"]):
        rs = [r for r in report["rows"] if r["garment"] == g]
        mean = lambda k: (round(statistics.mean([r[k] for r in rs if r[k] is not None]), 2)  # noqa: E731
                          if any(r[k] is not None for r in rs) else None)
        out[g] = {"category": rs[0]["category"], "placement": mean("placement_err_pct"), "leak": mean("leakage_pct"),
                  "aspect": mean("aspect_dist_pct"), "passed": sum(r["guard_passed"] for r in rs),
                  "reasons": sorted({x for r in rs for x in r["reasons"]}), "latency": mean("latency_ms"),
                  "readiness": report["readiness"][g]["readiness"],
                  "exposure": report["readiness"][g]["checks"].get("exposure")}
    return out


def table(reports: list[dict]) -> str:
    lines = ["| Garment (category sent) | Run | Readiness (exposure) | Placement err % | Undershirt leak % | Aspect distortion % | Guard pass /5 (reasons) | Latency ms |",
             "|---|---|---|---|---|---|---|---|"]
    sums = [(r["label"], summarise(r)) for r in reports]
    garments = list(dict.fromkeys(g for _, s in sums for g in s))
    fmt = lambda v: "n/a" if v is None else f"{v:g}"  # noqa: E731
    for g in garments:
        for label, s in sums:
            if g not in s:
                continue
            x = s[g]
            lines.append(f"| {g} (`{x['category'] or '(empty)'}`) | {label} | {x['readiness']} ({'ok' if x['exposure'] else 'fail'}) | "
                         f"{fmt(x['placement'])} | {fmt(x['leak'])} | {fmt(x['aspect'])} | {x['passed']} "
                         f"({', '.join(x['reasons']) or '-'}) | {fmt(x['latency'])} |")
    hd = ", ".join(f"{r['label']} {r['hd_latency_ms_mean']} ms" for r in reports)
    lines.append("")
    lines.append(f"HD tier (1024 px) mean latency, tee on all personas: {hd}.")
    return "\n".join(lines)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--label", default="after")
    p.add_argument("--real", action="store_true", help="include the fetched Wikimedia tee (local only)")
    a = p.parse_args(argv)
    report = evaluate(a.label, a.real)
    reports = [json.loads(f.read_text()) for f in sorted(DOCS.glob("tryon-metrics-*.json"))]
    reports.sort(key=lambda r: (r["label"] != "before", r["label"]))
    text = table(reports)
    doc = DOCS / "tryon-quality.md"
    start, end = "<!-- metrics:start -->", "<!-- metrics:end -->"
    body = doc.read_text() if doc.exists() else f"# Try-on quality\n\n{start}\n{end}\n"
    head, rest = body.split(start, 1)
    doc.write_text(f"{head}{start}\n{text}\n{end}{rest.split(end, 1)[1]}")
    print(text)
    print(json.dumps({g: v for g, v in summarise(report).items()}, indent=1)[:3000])


if __name__ == "__main__":
    main()
