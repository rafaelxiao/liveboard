#!/usr/bin/env python3
"""
LiveBoard — Mock Data Generator

Generates 2–3 years of realistic multi-strategy, multi-asset trading data
for 2 series (real + sim), and POSTs it all via the API.

Usage:
    uv run python scripts/generate_mock_data.py \
        --api-key lbk_... \
        --backend http://localhost:8002 \
        --seed 42
"""

import argparse
import datetime as dt
import json
import math
import random
import sys
import time
import uuid

import requests

# ── Configuration ──────────────────────────────────────────────────────────

SERIES_CONFIGS = [
    {
        "name": "Alpha-Real",
        "tag": "real",
        "base_currency": "USD",
        "session_tz": "America/New_York",
    },
    {
        "name": "Alpha-Sim",
        "tag": "sim",
        "base_currency": "USD",
        "session_tz": "America/New_York",
    },
]

STRATEGIES = [
    "momentum-equity",
    "mean-rev-crypto",
    "arbitrage-fx",
    "trend-following-commodity",
]

INSTRUMENTS = [
    {"symbol": "ES", "asset_class": "future", "multiplier": 50, "currency": "USD"},
    {"symbol": "NQ", "asset_class": "future", "multiplier": 20, "currency": "USD"},
    {"symbol": "BTC-USD", "asset_class": "crypto", "multiplier": 1, "currency": "USD"},
    {"symbol": "ETH-USD", "asset_class": "crypto", "multiplier": 1, "currency": "USD"},
    {"symbol": "EUR-USD", "asset_class": "fx", "multiplier": 1, "currency": "EUR"},
    {"symbol": "GBP-USD", "asset_class": "fx", "multiplier": 1, "currency": "GBP"},
    {"symbol": "CL", "asset_class": "future", "multiplier": 1000, "currency": "USD"},
    {"symbol": "GC", "asset_class": "future", "multiplier": 100, "currency": "USD"},
]

# Which instruments each strategy trades
STRATEGY_INSTRUMENTS = {
    "momentum-equity": ["ES", "NQ"],
    "mean-rev-crypto": ["BTC-USD", "ETH-USD"],
    "arbitrage-fx": ["EUR-USD", "GBP-USD"],
    "trend-following-commodity": ["CL", "GC"],
}

# Capital allocation per strategy
STRATEGY_CAPITAL = {
    "momentum-equity": 800_000,
    "mean-rev-crypto": 500_000,
    "arbitrage-fx": 400_000,
    "trend-following-commodity": 300_000,
}

# Base fee structure per asset class (per fill, can be negative for rebates)
FEE_TEMPLATES = {
    "future": {"commission": 2.50, "exchange_fee": 1.50, "regulatory_fee": 0.02},
    "crypto": {"commission": 0, "exchange_fee": 0.0015, "regulatory_fee": 0},
    "fx": {"commission": 0, "exchange_fee": 0.0001, "regulatory_fee": 0},
}

# Seed prices (approximate early-2024 levels)
BASE_PRICES = {
    "ES": 4800, "NQ": 17000,
    "BTC-USD": 44000, "ETH-USD": 2300,
    "EUR-USD": 1.08, "GBP-USD": 1.27,
    "CL": 73, "GC": 2050,
}

# How much the sim account differs from real (slippage simulation)
SIM_SLIPPAGE = 0.0005  # 5 bps worse execution on average
SIM_TIMING_JITTER_SEC = 30  # ±30s execution timing difference

# ── Helpers ────────────────────────────────────────────────────────────────

def utc(ts_str: str) -> str:
    """Return ISO-8601 UTC string."""
    return ts_str.replace(" ", "T") + "Z"


def drift_price(base: float, rng: random.Random, vol: float) -> float:
    """Random-walk price drift with mean-reversion."""
    change = rng.gauss(0, vol * base)
    return base + change


def random_fees(rng: random.Random, asset_class: str) -> dict[str, float]:
    """Generate realistic fee components for a single fill."""
    tmpl = FEE_TEMPLATES[asset_class]
    fees = {}
    for key, base_val in tmpl.items():
        if base_val == 0:
            fees[key] = 0
        elif base_val < 1:  # percentage-based
            fees[key] = round(base_val * (1 + rng.gauss(0, 0.2)), 6)
        else:  # fixed $
            fees[key] = round(base_val, 2)
    # Occasional maker rebate
    if rng.random() < 0.05:
        fees["commission"] = -fees.get("commission", 2.50)
    return fees


def build_series_body(cfg: dict[str, str]) -> dict:
    return {
        "name": cfg["name"],
        "tag": cfg["tag"],
        "base_currency": cfg["base_currency"],
        "session_tz": cfg["session_tz"],
    }


def build_fill(series_id: int, strategy: str, symbol: str,
               side: str, qty: float, price: float,
               ts: dt.datetime, rng: random.Random,
               asset_class: str, multiplier: int) -> dict:
    fees = random_fees(rng, asset_class)
    return {
        "client_fill_id": str(uuid.uuid4()),
        "strategy": strategy,
        "symbol": symbol,
        "side": side,
        "qty": qty,
        "price": price,
        "ts": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "commission": fees["commission"],
        "exchange_fee": fees["exchange_fee"],
        "regulatory_fee": fees["regulatory_fee"],
        "financing_fee": 0,
        "position_effect": None,
    }


# ── Main generator ─────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--backend", default="http://localhost:8002")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    headers = {"X-API-Key": args.api_key, "Content-Type": "application/json"}
    base = args.backend.rstrip("/")

    start_date = dt.date(2024, 1, 2)
    end_date = dt.date(2026, 6, 18)
    sim_slippage_factor = 1 + SIM_SLIPPAGE

    series_ids: dict[str, int] = {}

    for cfg in SERIES_CONFIGS:
        resp = requests.post(f"{base}/series", json=build_series_body(cfg), headers=headers)
        if resp.status_code == 201:
            sid = resp.json()["series_id"]
            series_ids[cfg["name"]] = sid
            print(f"✅ Created series '{cfg['name']}' (id={sid})")
        else:
            print(f"❌ Failed to create series '{cfg['name']}': {resp.status_code} {resp.text}")
            sys.exit(1)

        # Post instruments for this series
        instr_body = []
        for instr in INSTRUMENTS:
            instr_body.append({
                "symbol": instr["symbol"],
                "asset_class": instr["asset_class"],
                "multiplier": instr["multiplier"],
                "currency": instr["currency"],
            })
        resp = requests.post(f"{base}/series/{sid}/instruments", json=instr_body, headers=headers)
        print(f"   Instruments: {resp.status_code}")

        # FX rates (EUR-USD ≈ 1.05–1.12 over 2 years, GBP-USD ≈ 1.22–1.30)
        fx_rates = []
        current_date = start_date
        eur_base = 1.08
        gbp_base = 1.27
        while current_date <= end_date:
            eur_base = drift_price(eur_base, rng, 0.0004)
            gbp_base = drift_price(gbp_base, rng, 0.0003)
            ts = dt.datetime.combine(current_date, dt.time(12, 0))
            fx_rates.append({"ccy_from": "EUR", "ccy_to": "USD", "ts": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "rate": str(round(eur_base, 6))})
            fx_rates.append({"ccy_from": "GBP", "ccy_to": "USD", "ts": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "rate": str(round(gbp_base, 6))})
            current_date += dt.timedelta(days=1)
            if len(fx_rates) >= 200:  # batch size
                requests.post(f"{base}/series/{sid}/fx-rates", json=fx_rates, headers=headers)
                fx_rates = []
        if fx_rates:
            requests.post(f"{base}/series/{sid}/fx-rates", json=fx_rates, headers=headers)
        print(f"   FX rates: posted")

        # Fund movements: initial deposit + strategy allocations
        total_capital = sum(STRATEGY_CAPITAL.values())
        fund_movements = [
            {"ts": utc("2024-01-01 09:00:00"), "from_bucket": "EXTERNAL", "to_bucket": "FREE_CASH",
             "amount": total_capital, "currency": "USD"},
        ]
        for strat, amount in STRATEGY_CAPITAL.items():
            fund_movements.append({
                "ts": utc("2024-01-02 08:00:00"), "from_bucket": "FREE_CASH",
                "to_bucket": "STRATEGY", "to_strategy": strat,
                "amount": amount, "currency": "USD",
            })
        # Mid-period re-allocation (shift $100K from momentum to crypto)
        fund_movements.append({
            "ts": utc("2025-06-01 08:00:00"), "from_bucket": "STRATEGY",
            "from_strategy": "momentum-equity", "to_bucket": "STRATEGY",
            "to_strategy": "mean-rev-crypto", "amount": 100_000, "currency": "USD",
        })
        resp = requests.post(f"{base}/series/{sid}/fund-movements", json=fund_movements, headers=headers)
        print(f"   Fund movements: {resp.status_code}")

    # ── Generate fills ──────────────────────────────────────────────────────
    print("\nGenerating fills ...")
    current_prices = dict(BASE_PRICES)
    fill_batches: dict[str, list] = {name: [] for name in series_ids}

    current_date = start_date
    total_fills = 0

    while current_date <= end_date:
        # Only trade on weekdays
        if current_date.weekday() >= 5:
            current_date += dt.timedelta(days=1)
            continue

        for series_name, sid in series_ids.items():
            for strategy in STRATEGIES:
                instruments = STRATEGY_INSTRUMENTS[strategy]
                for symbol in instruments:
                    instr = next(i for i in INSTRUMENTS if i["symbol"] == symbol)
                    asset_class = instr["asset_class"]

                    # Trade ~40% of days per instrument
                    if rng.random() > 0.40:
                        continue

                    # Decide direction (55% buy bias for equity/crypto, 50% for FX)
                    bias = 0.55 if asset_class in ("future", "crypto") else 0.50
                    side = "buy" if rng.random() < bias else "sell"

                    # Quantity (contracts for futures, units for crypto/fx)
                    if asset_class == "future":
                        qty = rng.randint(1, 5)
                    elif symbol in ("BTC-USD",):
                        qty = round(rng.uniform(0.1, 2.0), 4)
                    elif symbol in ("ETH-USD",):
                        qty = round(rng.uniform(1, 20), 2)
                    else:  # fx
                        qty = round(rng.uniform(10_000, 100_000), 2)

                    # Price with random walk + strategy-specific drift
                    price = drift_price(current_prices[symbol], rng, vol=0.003)
                    # Add drift: equity futures +20% annual, crypto +30%, FX flat
                    annual_drift = {"future": 0.08, "crypto": 0.12, "fx": 0.02}[asset_class]
                    price += price * annual_drift / 252 * rng.uniform(-1.5, 1.5)
                    current_prices[symbol] = max(price, current_prices[symbol] * 0.8)

                    # Trading hours
                    hour = rng.randint(9, 15)
                    minute = rng.randint(0, 59)
                    second = rng.randint(0, 59)
                    trade_ts = dt.datetime.combine(current_date, dt.time(hour, minute, second))

                    # For the sim series, add slippage and timing jitter
                    exec_price = price
                    exec_ts = trade_ts
                    if series_name == "Alpha-Sim":
                        slip_dir = 1 if side == "buy" else -1
                        exec_price = round(price * (1 + rng.gauss(slip_dir * SIM_SLIPPAGE, SIM_SLIPPAGE / 2)), 2)
                        exec_ts = trade_ts + dt.timedelta(seconds=rng.randint(-SIM_TIMING_JITTER_SEC, SIM_TIMING_JITTER_SEC))

                    fill = build_fill(sid, strategy, symbol, side, qty, exec_price,
                                      exec_ts, rng, asset_class, instr["multiplier"])
                    fill_batches[series_name].append(fill)
                    total_fills += 1

        # Post in batches of 500
        for name, batch in fill_batches.items():
            if len(batch) >= 500:
                sid = series_ids[name]
                requests.post(f"{base}/series/{sid}/fills:batch", json={"fills": batch}, headers=headers)
                fill_batches[name] = []
        current_date += dt.timedelta(days=1)

    # Post remaining fills
    for name, batch in fill_batches.items():
        if batch:
            sid = series_ids[name]
            requests.post(f"{base}/series/{sid}/fills:batch", json={"fills": batch}, headers=headers)

    print(f"✅ Posted {total_fills} fills across both series")
    print(f"   Real series: {series_ids['Alpha-Real']}")
    print(f"   Sim series:  {series_ids['Alpha-Sim']}")
    print(f"\nOpen http://localhost:5175/dashboard?series={series_ids['Alpha-Real']}")


if __name__ == "__main__":
    main()
