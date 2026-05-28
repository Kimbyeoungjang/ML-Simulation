#!/usr/bin/env python3
"""Run TileForge GEMM shapes on a real TPU with JAX.

Typical flow:
  npm run tpu:export -- --shapes examples/shapes.csv --out .tileforge/tpu/tpu_benchmark_shapes.csv
  python scripts/tpu_matmul_bench.py --shapes .tileforge/tpu/tpu_benchmark_shapes.csv --out tpu_measurements.csv
  npm run tpu:import -- --predictions .tileforge/tpu/tpu_benchmark_shapes.csv --measurements tpu_measurements.csv

The script measures device execution time of one JIT-compiled matmul shape at a time.
Compile time and warm-up iterations are excluded from the reported timings.
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import statistics
import time
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class Shape:
    id: str
    model: str
    op_name: str
    m: int
    n: int
    k: int
    dtype: str


def _first(row: dict[str, str], *names: str, default: str = "") -> str:
    lowered = {key.strip().lower().replace("_", ""): value for key, value in row.items()}
    for name in names:
        value = lowered.get(name.strip().lower().replace("_", ""))
        if value not in (None, ""):
            return value
    return default


def _positive_int(value: str, field: str) -> int:
    try:
        parsed = int(float(value))
    except ValueError as exc:
        raise ValueError(f"Invalid {field}: {value}") from exc
    if parsed <= 0:
        raise ValueError(f"Invalid {field}: {value}")
    return parsed


def read_shapes(path: str, dtype_override: str | None) -> list[Shape]:
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        shapes: list[Shape] = []
        for idx, row in enumerate(reader):
            m = _positive_int(_first(row, "m"), "m")
            n = _positive_int(_first(row, "n"), "n")
            k = _positive_int(_first(row, "k"), "k")
            dtype = dtype_override or _first(row, "dtype", default="bf16")
            shapes.append(
                Shape(
                    id=_first(row, "id", default=f"row_{idx}"),
                    model=_first(row, "model", default="tpu-model"),
                    op_name=_first(row, "op_name", "opName", default=f"op_{idx}"),
                    m=m,
                    n=n,
                    k=k,
                    dtype=dtype,
                )
            )
        return shapes


def percentile(values: list[float], q: float) -> float:
    if not values:
        return math.nan
    ordered = sorted(values)
    pos = (len(ordered) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return ordered[lo]
    return ordered[lo] * (hi - pos) + ordered[hi] * (pos - lo)


def jax_dtype(jnp, dtype_name: str):
    normalized = dtype_name.lower()
    if normalized in {"bf16", "bfloat16", "bytes2"}:
        return jnp.bfloat16
    if normalized in {"f32", "float32", "fp32", "bytes4"}:
        return jnp.float32
    if normalized in {"f16", "float16", "fp16"}:
        return jnp.float16
    raise ValueError(f"Unsupported dtype '{dtype_name}'. Use bf16, f32, or f16.")


def bench_shape(shape: Shape, reps: int, warmup: int, donate: bool) -> dict[str, float | int | str]:
    import jax
    import jax.numpy as jnp

    dtype = jax_dtype(jnp, shape.dtype)
    a = jnp.ones((shape.m, shape.k), dtype=dtype)
    b = jnp.ones((shape.k, shape.n), dtype=dtype)

    if donate:
        # Donation is disabled by default because this benchmark reuses inputs.
        # Keep the branch for users who intentionally create fresh inputs later.
        matmul = jax.jit(lambda x, y: x @ y, donate_argnums=(0, 1))
    else:
        matmul = jax.jit(lambda x, y: x @ y)

    # First run compiles. Exclude it from timing.
    matmul(a, b).block_until_ready()

    for _ in range(warmup):
        matmul(a, b).block_until_ready()

    times_us: list[float] = []
    for _ in range(reps):
        t0 = time.perf_counter()
        matmul(a, b).block_until_ready()
        t1 = time.perf_counter()
        times_us.append((t1 - t0) * 1e6)

    flops = 2 * shape.m * shape.n * shape.k
    median_us = statistics.median(times_us)
    achieved_tflops = flops / (median_us * 1e-6) / 1e12
    return {
        "id": shape.id,
        "model": shape.model,
        "op_name": shape.op_name,
        "m": shape.m,
        "n": shape.n,
        "k": shape.k,
        "dtype": shape.dtype,
        "median_us": median_us,
        "mean_us": statistics.mean(times_us),
        "min_us": min(times_us),
        "max_us": max(times_us),
        "p90_us": percentile(times_us, 0.90),
        "achieved_tflops": achieved_tflops,
        "reps": reps,
    }


def write_rows(path: str, rows: Iterable[dict[str, float | int | str]]) -> None:
    rows = list(rows)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    fieldnames = [
        "id",
        "model",
        "op_name",
        "m",
        "n",
        "k",
        "dtype",
        "median_us",
        "mean_us",
        "min_us",
        "max_us",
        "p90_us",
        "achieved_tflops",
        "reps",
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark TileForge GEMM shapes on JAX/TPU.")
    parser.add_argument("--shapes", default=".tileforge/tpu/tpu_benchmark_shapes.csv")
    parser.add_argument("--out", default="tpu_measurements.csv")
    parser.add_argument("--reps", type=int, default=50)
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--dtype", default=None, help="Override CSV dtype: bf16, f32, or f16")
    parser.add_argument("--limit", type=int, default=0, help="Run only the first N rows")
    parser.add_argument("--donate", action="store_true", help="Use JAX donation. Off by default for stable repeated timing.")
    args = parser.parse_args()

    shapes = read_shapes(args.shapes, args.dtype)
    if args.limit > 0:
        shapes = shapes[: args.limit]
    if not shapes:
        raise SystemExit("No shapes to benchmark")

    rows: list[dict[str, float | int | str]] = []
    for shape in shapes:
        result = bench_shape(shape, reps=args.reps, warmup=args.warmup, donate=args.donate)
        rows.append(result)
        print(result, flush=True)
        write_rows(args.out, rows)

    print(f"Wrote {len(rows)} TPU measurement rows to {args.out}")


if __name__ == "__main__":
    main()
