#!/usr/bin/env python3
"""Run TileForge tiling plans on a real TPU with JAX.

Input is the tpu_plan.json emitted by scripts/tiling-experiment.ts.
The script intentionally does not depend on the TileForge web server.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import statistics
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    import jax
    import jax.numpy as jnp
    from jax import lax
except Exception as exc:  # pragma: no cover - this runs on the TPU VM, not in CI
    raise SystemExit(
        "JAX import failed. On a Cloud TPU VM, install/activate the TPU JAX runtime first. "
        "Example: pip install -U 'jax[tpu]' -f https://storage.googleapis.com/jax-releases/libtpu_releases.html\n"
        f"Original error: {exc}"
    )


@dataclass(frozen=True)
class BenchSample:
    target: str
    target_label: str
    shape_id: str
    model: str
    op_name: str
    m: int
    n: int
    k: int
    dtype_bytes: int
    strategy: str
    tile_m: int
    tile_n: int
    tile_k: int
    estimated_cycles: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark TileForge tiling strategies on a real TPU using JAX.")
    parser.add_argument("--plan", required=True, help="Path to tpu_plan.json produced by scripts/tiling-experiment.ts")
    parser.add_argument("--out", default=".tileforge/experiments/tpu-run", help="Output directory")
    parser.add_argument("--target", default="", help="Only run samples for this target id, e.g. tpu-v6e")
    parser.add_argument("--strategy", default="", help="Only run one strategy: no_tiling, baseline_tiling, recommended_tiling")
    parser.add_argument("--limit", type=int, default=0, help="Maximum number of plan rows to run")
    parser.add_argument("--warmup", type=int, default=2, help="Warmup iterations per sample")
    parser.add_argument("--iterations", type=int, default=10, help="Timed iterations per sample")
    parser.add_argument("--dtype", choices=["bf16", "fp32"], default="bf16", help="Input dtype")
    parser.add_argument("--seed", type=int, default=0, help="PRNG seed")
    parser.add_argument("--max-elements", type=int, default=300_000_000, help="Skip samples when A+B+C elements exceed this value")
    parser.add_argument("--skip-correctness", action="store_true", help="Skip optional correctness check against untiled matmul for small shapes")
    parser.add_argument("--correctness-elements", type=int, default=8_000_000, help="Only check correctness below this total element threshold")
    return parser.parse_args()


def load_samples(plan_path: Path, target_filter: str = "", strategy_filter: str = "", limit: int = 0) -> List[BenchSample]:
    data = json.loads(plan_path.read_text(encoding="utf-8"))
    raw_samples = data.get("samples", [])
    samples: List[BenchSample] = []
    for item in raw_samples:
        shape = item["shape"]
        tile = item["tile"]
        sample = BenchSample(
            target=str(item.get("target", "")),
            target_label=str(item.get("targetLabel", item.get("target", ""))),
            shape_id=str(shape.get("id", shape.get("opName", "shape"))),
            model=str(shape.get("model", "model")),
            op_name=str(shape.get("opName", shape.get("id", "matmul"))),
            m=int(shape["m"]),
            n=int(shape["n"]),
            k=int(shape["k"]),
            dtype_bytes=int(shape.get("dtypeBytes", 2)),
            strategy=str(item["strategy"]),
            tile_m=int(tile["tileM"]),
            tile_n=int(tile["tileN"]),
            tile_k=int(tile["tileK"]),
            estimated_cycles=float(item.get("estimatedCycles", 0.0)),
        )
        if target_filter and sample.target != target_filter:
            continue
        if strategy_filter and sample.strategy != strategy_filter:
            continue
        samples.append(sample)
    if limit > 0:
        samples = samples[:limit]
    return samples


def pad_to_multiple(value: int, tile: int) -> int:
    return int(math.ceil(value / max(1, tile)) * max(1, tile))


def make_tiled_matmul(m: int, n: int, k: int, tile_m: int, tile_n: int, tile_k: int):
    tile_m = max(1, min(tile_m, m))
    tile_n = max(1, min(tile_n, n))
    tile_k = max(1, min(tile_k, k))
    mp = pad_to_multiple(m, tile_m)
    np = pad_to_multiple(n, tile_n)
    kp = pad_to_multiple(k, tile_k)
    m_tiles = mp // tile_m
    n_tiles = np // tile_n
    k_tiles = kp // tile_k

    @jax.jit
    def tiled_matmul(a, b):
        a_pad = jnp.pad(a, ((0, mp - m), (0, kp - k)))
        b_pad = jnp.pad(b, ((0, kp - k), (0, np - n)))
        c0 = jnp.zeros((mp, np), dtype=jnp.float32)

        def body_m(i, c_acc):
            row = i * tile_m

            def body_n(j, c_inner):
                col = j * tile_n
                block0 = jnp.zeros((tile_m, tile_n), dtype=jnp.float32)

                def body_k(t, block_acc):
                    kk = t * tile_k
                    a_block = lax.dynamic_slice(a_pad, (row, kk), (tile_m, tile_k))
                    b_block = lax.dynamic_slice(b_pad, (kk, col), (tile_k, tile_n))
                    prod = lax.dot_general(
                        a_block,
                        b_block,
                        (((1,), (0,)), ((), ())),
                        preferred_element_type=jnp.float32,
                    )
                    return block_acc + prod.astype(jnp.float32)

                block = lax.fori_loop(0, k_tiles, body_k, block0)
                return lax.dynamic_update_slice(c_inner, block, (row, col))

            return lax.fori_loop(0, n_tiles, body_n, c_acc)

        c = lax.fori_loop(0, m_tiles, body_m, c0)
        return c[:m, :n]

    return tiled_matmul, {"padded_m": mp, "padded_n": np, "padded_k": kp, "m_tiles": m_tiles, "n_tiles": n_tiles, "k_tiles": k_tiles}


def make_inputs(sample: BenchSample, dtype: str, seed: int):
    key = jax.random.PRNGKey(seed)
    k1, k2 = jax.random.split(key)
    if dtype == "bf16":
        jdtype = jnp.bfloat16
    else:
        jdtype = jnp.float32
    a = jax.random.normal(k1, (sample.m, sample.k), dtype=jnp.float32).astype(jdtype)
    b = jax.random.normal(k2, (sample.k, sample.n), dtype=jnp.float32).astype(jdtype)
    return a, b


def maybe_correctness_check(fn, a, b, sample: BenchSample, max_elements: int) -> Tuple[Optional[float], Optional[str]]:
    total_elements = sample.m * sample.k + sample.k * sample.n + sample.m * sample.n
    if total_elements > max_elements:
        return None, "skipped_large"
    ref = (a @ b).astype(jnp.float32)
    got = fn(a, b).astype(jnp.float32)
    diff = jnp.max(jnp.abs(ref - got)).block_until_ready()
    return float(diff), None


def benchmark_one(sample: BenchSample, args: argparse.Namespace, row_index: int) -> Dict[str, Any]:
    total_elements = sample.m * sample.k + sample.k * sample.n + sample.m * sample.n
    if total_elements > args.max_elements:
        return {
            "status": "skipped",
            "skip_reason": f"total elements {total_elements} > max-elements {args.max_elements}",
        }

    a, b = make_inputs(sample, args.dtype, args.seed + row_index * 9973)
    fn, meta = make_tiled_matmul(sample.m, sample.n, sample.k, sample.tile_m, sample.tile_n, sample.tile_k)

    # Compile and warm up. JAX dispatch is async, so every measured result must be blocked.
    for _ in range(max(0, args.warmup)):
        fn(a, b).block_until_ready()

    times_ms: List[float] = []
    for _ in range(max(1, args.iterations)):
        start = time.perf_counter()
        fn(a, b).block_until_ready()
        end = time.perf_counter()
        times_ms.append((end - start) * 1000.0)

    correctness_max_abs = None
    correctness_note = None
    if not args.skip_correctness:
        correctness_max_abs, correctness_note = maybe_correctness_check(fn, a, b, sample, args.correctness_elements)

    mean_ms = statistics.mean(times_ms)
    median_ms = statistics.median(times_ms)
    min_ms = min(times_ms)
    p90_ms = sorted(times_ms)[max(0, min(len(times_ms) - 1, int(math.ceil(0.90 * len(times_ms)) - 1)))]
    flops = 2.0 * sample.m * sample.n * sample.k
    tflops_mean = flops / (mean_ms / 1000.0) / 1e12
    tflops_best = flops / (min_ms / 1000.0) / 1e12
    return {
        "status": "ok",
        "backend": jax.default_backend(),
        "devices": ";".join(str(d) for d in jax.devices()),
        "mean_ms": mean_ms,
        "median_ms": median_ms,
        "min_ms": min_ms,
        "p90_ms": p90_ms,
        "std_ms": statistics.pstdev(times_ms) if len(times_ms) > 1 else 0.0,
        "tflops_mean": tflops_mean,
        "tflops_best": tflops_best,
        "correctness_max_abs": correctness_max_abs,
        "correctness_note": correctness_note,
        **meta,
    }


def csv_escape(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def write_csv(path: Path, rows: List[Dict[str, Any]]) -> None:
    fieldnames = [
        "target", "target_label", "strategy", "shape_id", "model", "op_name", "M", "N", "K",
        "tileM", "tileN", "tileK", "estimated_cycles", "status", "skip_reason",
        "mean_ms", "median_ms", "min_ms", "p90_ms", "std_ms", "tflops_mean", "tflops_best",
        "padded_m", "padded_n", "padded_k", "m_tiles", "n_tiles", "k_tiles",
        "correctness_max_abs", "correctness_note", "backend", "devices",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})


def aggregate_totals(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    groups: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for row in rows:
        if row.get("status") != "ok":
            continue
        key = (str(row["target"]), str(row["strategy"]))
        g = groups.setdefault(key, {
            "target": row["target"],
            "target_label": row["target_label"],
            "strategy": row["strategy"],
            "total_mean_ms": 0.0,
            "total_min_ms": 0.0,
            "sample_count": 0,
        })
        g["total_mean_ms"] += float(row["mean_ms"])
        g["total_min_ms"] += float(row["min_ms"])
        g["sample_count"] += 1
    no_tiling = {g["target"]: g["total_mean_ms"] for g in groups.values() if g["strategy"] == "no_tiling"}
    totals = []
    for g in groups.values():
        base = no_tiling.get(g["target"])
        g = dict(g)
        g["speedup_vs_no_tiling_mean"] = (base / g["total_mean_ms"]) if base and g["total_mean_ms"] else ""
        totals.append(g)
    return sorted(totals, key=lambda x: (x["target"], ["no_tiling", "baseline_tiling", "recommended_tiling"].index(x["strategy"])))


def write_totals_csv(path: Path, rows: List[Dict[str, Any]]) -> None:
    fieldnames = ["target", "target_label", "strategy", "total_mean_ms", "total_min_ms", "speedup_vs_no_tiling_mean", "sample_count"]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})


def fmt_short(value: float) -> str:
    if value >= 1_000_000:
        return f"{value/1_000_000:.1f}M"
    if value >= 1_000:
        return f"{value/1_000:.1f}K"
    if value >= 10:
        return f"{value:.1f}"
    return f"{value:.2f}"


def write_svg(path: Path, totals: List[Dict[str, Any]]) -> None:
    strategies = ["no_tiling", "baseline_tiling", "recommended_tiling"]
    colors = {"no_tiling": "#7f8c8d", "baseline_tiling": "#3498db", "recommended_tiling": "#2ecc71"}
    targets = sorted({str(row["target"]) for row in totals})
    values = {(str(row["target"]), str(row["strategy"])): float(row["total_mean_ms"]) for row in totals}
    max_v = max(values.values(), default=1.0)
    width, height = 1120, 620
    left, right, top, bottom = 90, 40, 70, 120
    plot_w, plot_h = width - left - right, height - top - bottom
    group_w = plot_w / max(1, len(targets))
    bar_w = min(70, group_w / 5)
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">']
    parts.append('<rect width="100%" height="100%" fill="white"/>')
    parts.append(f'<text x="{width/2}" y="34" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700">Real TPU tiling benchmark: total mean latency</text>')
    parts.append(f'<line x1="{left}" y1="{top + plot_h}" x2="{left + plot_w}" y2="{top + plot_h}" stroke="#222"/>')
    parts.append(f'<line x1="{left}" y1="{top}" x2="{left}" y2="{top + plot_h}" stroke="#222"/>')
    for i in range(6):
        y = top + plot_h - plot_h * i / 5
        v = max_v * i / 5
        parts.append(f'<line x1="{left}" y1="{y}" x2="{left + plot_w}" y2="{y}" stroke="#e5e5e5"/>')
        parts.append(f'<text x="{left - 10}" y="{y + 4}" text-anchor="end" font-family="Arial, sans-serif" font-size="12">{fmt_short(v)} ms</text>')
    for ti, target in enumerate(targets):
        cx = left + group_w * ti + group_w / 2
        parts.append(f'<text x="{cx}" y="{top + plot_h + 35}" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="700">{target}</text>')
        for si, strategy in enumerate(strategies):
            v = values.get((target, strategy), 0.0)
            h = plot_h * v / max_v if max_v else 0
            x = cx - (bar_w * 1.5) + si * bar_w
            y = top + plot_h - h
            parts.append(f'<rect x="{x}" y="{y}" width="{bar_w * 0.82}" height="{h}" rx="4" fill="{colors[strategy]}"/>')
            parts.append(f'<text x="{x + bar_w * 0.41}" y="{max(top + 12, y - 6)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11">{fmt_short(v)}</text>')
    legend_y = height - 55
    for i, strategy in enumerate(strategies):
        x = left + i * 250
        parts.append(f'<rect x="{x}" y="{legend_y}" width="18" height="18" fill="{colors[strategy]}" rx="3"/>')
        parts.append(f'<text x="{x + 26}" y="{legend_y + 14}" font-family="Arial, sans-serif" font-size="14">{strategy}</text>')
    parts.append('</svg>')
    path.write_text("\n".join(parts), encoding="utf-8")


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    samples = load_samples(Path(args.plan), args.target, args.strategy, args.limit)
    if not samples:
        raise SystemExit("No samples matched the requested filters.")

    metadata = {
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "plan": str(Path(args.plan).resolve()),
        "targetFilter": args.target,
        "strategyFilter": args.strategy,
        "jaxVersion": getattr(jax, "__version__", "unknown"),
        "backend": jax.default_backend(),
        "devices": [str(d) for d in jax.devices()],
        "platform": os.uname().sysname if hasattr(os, "uname") else os.name,
        "args": vars(args),
    }
    (out_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    rows: List[Dict[str, Any]] = []
    for idx, sample in enumerate(samples):
        print(f"[TPU] start {idx + 1}/{len(samples)} {sample.target}/{sample.strategy}/{sample.shape_id} "
              f"M,N,K={sample.m},{sample.n},{sample.k} tile={sample.tile_m}x{sample.tile_n}x{sample.tile_k}", flush=True)
        base = {
            "target": sample.target,
            "target_label": sample.target_label,
            "strategy": sample.strategy,
            "shape_id": sample.shape_id,
            "model": sample.model,
            "op_name": sample.op_name,
            "M": sample.m,
            "N": sample.n,
            "K": sample.k,
            "tileM": sample.tile_m,
            "tileN": sample.tile_n,
            "tileK": sample.tile_k,
            "estimated_cycles": sample.estimated_cycles,
        }
        try:
            result = benchmark_one(sample, args, idx)
            row = {**base, **result}
            rows.append(row)
            if row.get("status") == "ok":
                print(f"[TPU] done  {sample.target}/{sample.strategy}/{sample.shape_id} "
                      f"mean={row['mean_ms']:.3f} ms best={row['min_ms']:.3f} ms TFLOP/s={row['tflops_mean']:.2f}", flush=True)
            else:
                print(f"[TPU] skip  {sample.target}/{sample.strategy}/{sample.shape_id}: {row.get('skip_reason')}", flush=True)
        except Exception as exc:  # keep going so one bad tile does not erase the experiment
            row = {**base, "status": "failed", "skip_reason": "", "error": repr(exc)}
            rows.append(row)
            print(f"[TPU] fail  {sample.target}/{sample.strategy}/{sample.shape_id}: {exc!r}", flush=True)
        write_csv(out_dir / "tpu_results.csv", rows)
        (out_dir / "tpu_results.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")

    totals = aggregate_totals(rows)
    write_totals_csv(out_dir / "tpu_totals.csv", totals)
    (out_dir / "tpu_totals.json").write_text(json.dumps(totals, indent=2), encoding="utf-8")
    write_svg(out_dir / "tpu_total_latency.svg", totals)
    print(f"Done: {out_dir}")
    print("- tpu_results.csv")
    print("- tpu_totals.csv")
    print("- tpu_total_latency.svg")


if __name__ == "__main__":
    main()
