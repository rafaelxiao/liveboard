"""Benchmark metrics: alpha, beta, information ratio vs uploaded BenchmarkReturn."""

from __future__ import annotations

import math
import statistics
from datetime import date

from app.core.config import settings


def benchmark_metrics(return_series: dict[date, float], benchmark: dict[date, float]) -> dict:
    none = {"alpha": None, "beta": None, "information_ratio": None}
    common = sorted(set(return_series) & set(benchmark))
    if len(common) < 2:
        return none

    port = [return_series[d] for d in common]
    bench = [benchmark[d] for d in common]
    ann = settings.ANNUALIZATION_DAYS

    mean_p = statistics.fmean(port)
    mean_b = statistics.fmean(bench)
    var_b = statistics.pvariance(bench, mu=mean_b)

    out = dict(none)
    if var_b != 0:
        cov = _covariance(port, bench, mean_p, mean_b)
        beta = cov / var_b
        out["beta"] = beta
        out["alpha"] = (mean_p - beta * mean_b) * ann

    active = [p - b for p, b in zip(port, bench, strict=False)]
    if len(active) >= 2:
        std_active = statistics.stdev(active)
        if std_active != 0:
            out["information_ratio"] = statistics.fmean(active) / std_active * math.sqrt(ann)
    return out


def _covariance(xs, ys, mx, my):
    n = len(xs)
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=False)) / n
