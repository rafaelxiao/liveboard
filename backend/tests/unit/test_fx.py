from decimal import Decimal

from app.services import fx

from tests.unit.conftest import make_fx, utc


def test_same_currency_returns_amount(db, series):
    value = fx.to_base(db, series.id, Decimal("123.45"), "USD", utc(2026, 6, 19))
    assert value == Decimal("123.45")  # identity: no DB lookup, not None


def test_as_of_uses_last_rate_at_or_before(db, series):
    make_fx(db, series, ccy_from="EUR", ccy_to="USD", at=utc(2026, 6, 1), rate="1.10")
    make_fx(db, series, ccy_from="EUR", ccy_to="USD", at=utc(2026, 6, 10), rate="1.20")
    rate = fx.as_of_rate(db, series.id, "EUR", "USD", utc(2026, 6, 5))
    assert rate == Decimal("1.10")
    rate2 = fx.as_of_rate(db, series.id, "EUR", "USD", utc(2026, 6, 10))
    assert rate2 == Decimal("1.20")


def test_missing_rate_returns_none(db, series):
    make_fx(db, series, ccy_from="EUR", ccy_to="USD", at=utc(2026, 6, 10), rate="1.20")
    result = fx.to_base(db, series.id, Decimal("100"), "EUR", utc(2026, 6, 5))
    assert result is None  # no rate at or before 06-05; exclude, not assume 1.0


def test_to_base_converts_via_as_of_rate(db, series):
    make_fx(db, series, ccy_from="EUR", ccy_to="USD", at=utc(2026, 6, 1), rate="1.10")
    value = fx.to_base(db, series.id, Decimal("50"), "EUR", utc(2026, 6, 2))
    assert value == Decimal("55.00")  # 50 * 1.10
