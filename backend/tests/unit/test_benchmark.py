"""Unit tests for benchmark metrics."""

import math
import statistics
from datetime import date

from app.services import benchmark


def test_beta_one_alpha_zero_when_portfolio_equals_benchmark():
    series = {date(2026, 1, d): r for d, r in [(1, 0.01), (2, -0.02), (3, 0.03), (4, 0.00)]}
    out = benchmark.benchmark_metrics(series, series)
    assert math.isclose(out["beta"], 1.0, rel_tol=1e-9)
    assert math.isclose(out["alpha"], 0.0, abs_tol=1e-9)
    assert out["information_ratio"] is None


def test_beta_two_when_portfolio_is_double_benchmark():
    bench = {date(2026, 1, d): r for d, r in [(1, 0.01), (2, -0.02), (3, 0.03), (4, -0.01)]}
    port = {d: 2 * r for d, r in bench.items()}
    out = benchmark.benchmark_metrics(port, bench)
    assert math.isclose(out["beta"], 2.0, rel_tol=1e-9)
    assert math.isclose(out["alpha"], 0.0, abs_tol=1e-9)


def test_information_ratio_value():
    bench = {date(2026, 1, d): r for d, r in [(1, 0.01), (2, 0.01), (3, 0.01), (4, 0.01)]}
    port = {date(2026, 1, d): r for d, r in [(1, 0.02), (2, 0.00), (3, 0.03), (4, 0.02)]}
    out = benchmark.benchmark_metrics(port, bench)
    active = [0.01, -0.01, 0.02, 0.01]
    expected_ir = statistics.fmean(active) / statistics.stdev(active) * math.sqrt(365)
    assert math.isclose(out["information_ratio"], expected_ir, rel_tol=1e-9)


def test_all_none_when_no_overlap():
    out = benchmark.benchmark_metrics({date(2026, 1, 1): 0.01}, {date(2026, 2, 1): 0.02})
    assert out == {"alpha": None, "beta": None, "information_ratio": None}
