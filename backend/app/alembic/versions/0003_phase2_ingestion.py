"""Phase 2 ingestion models: series, accounts, strategies, instruments, fx_rates,
benchmark_returns, fund_movements, fills, ingestion_batches

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-19 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- series ---
    op.create_table(
        "series",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("tag", sa.String(64), nullable=True),
        sa.Column("notes", sa.String(2000), nullable=True),
        sa.Column("base_currency", sa.String(3), nullable=False),
        sa.Column("session_tz", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_series_user_id", "series", ["user_id"])

    # --- accounts ---
    op.create_table(
        "accounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("series_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("series_id"),
    )

    # --- strategies ---
    op.create_table(
        "strategies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("series_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("name_key", sa.String(255), nullable=False),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "series_id", "name_key", name="uq_strategies_series_name_key"
        ),
    )
    op.create_index("ix_strategies_series_id", "strategies", ["series_id"])

    # --- instruments ---
    op.create_table(
        "instruments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("series_id", sa.Integer(), nullable=False),
        sa.Column("symbol", sa.String(64), nullable=False),
        sa.Column("asset_class", sa.String(16), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column(
            "multiplier",
            sa.Numeric(28, 12),
            nullable=False,
            server_default="1",
        ),
        sa.Column("tick_size", sa.Numeric(28, 10), nullable=True),
        sa.Column("lot_size", sa.Numeric(28, 10), nullable=True),
        sa.Column("inferred", sa.Boolean(), nullable=False, server_default="false"),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "series_id", "symbol", name="uq_instrument_series_symbol"
        ),
    )
    op.create_index("ix_instruments_series_id", "instruments", ["series_id"])

    # --- fx_rates ---
    op.create_table(
        "fx_rates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("series_id", sa.Integer(), nullable=False),
        sa.Column("ccy_from", sa.String(3), nullable=False),
        sa.Column("ccy_to", sa.String(3), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rate", sa.Numeric(28, 12), nullable=False),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_fx_rates_series_id", "fx_rates", ["series_id"])
    op.create_index(
        "ix_fx_rates_lookup",
        "fx_rates",
        ["series_id", "ccy_from", "ccy_to", "ts"],
    )

    # --- benchmark_returns ---
    op.create_table(
        "benchmark_returns",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("series_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("return_pct", sa.Numeric(28, 12), nullable=False),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_benchmark_returns_series_id", "benchmark_returns", ["series_id"]
    )

    # --- fund_movements ---
    op.create_table(
        "fund_movements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("series_id", sa.Integer(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("amount", sa.Numeric(28, 10), nullable=False),
        sa.Column("from_bucket", sa.String(16), nullable=False),
        sa.Column("to_bucket", sa.String(16), nullable=False),
        sa.Column("from_strategy_id", sa.Integer(), nullable=True),
        sa.Column("to_strategy_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["from_strategy_id"], ["strategies.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["to_strategy_id"], ["strategies.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_fund_movements_series_id", "fund_movements", ["series_id"]
    )

    # --- fills ---
    op.create_table(
        "fills",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("series_id", sa.Integer(), nullable=False),
        sa.Column("strategy_id", sa.Integer(), nullable=False),
        sa.Column("symbol", sa.String(32), nullable=False),
        sa.Column("side", sa.String(8), nullable=False),
        sa.Column("qty", sa.Numeric(28, 10), nullable=False),
        sa.Column("price", sa.Numeric(28, 10), nullable=False),
        sa.Column(
            "commission", sa.Numeric(28, 10), nullable=False, server_default="0"
        ),
        sa.Column(
            "exchange_fee", sa.Numeric(28, 10), nullable=False, server_default="0"
        ),
        sa.Column(
            "regulatory_fee", sa.Numeric(28, 10), nullable=False, server_default="0"
        ),
        sa.Column(
            "financing_fee", sa.Numeric(28, 10), nullable=False, server_default="0"
        ),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("client_fill_id", sa.String(128), nullable=False),
        sa.Column("signal_id", sa.String(128), nullable=True),
        sa.Column("position_effect", sa.String(16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["strategy_id"], ["strategies.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "series_id", "client_fill_id", name="uq_fills_series_client_fill_id"
        ),
    )
    op.create_index("ix_fills_series_id", "fills", ["series_id"])
    op.create_index("ix_fills_strategy_id", "fills", ["strategy_id"])

    # --- ingestion_batches ---
    op.create_table(
        "ingestion_batches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("series_id", sa.Integer(), nullable=False),
        sa.Column("api_key_id", sa.Integer(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("inserted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rejected", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["api_key_id"], ["api_keys.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ingestion_batches_series_id", "ingestion_batches", ["series_id"]
    )


def downgrade() -> None:
    op.drop_table("ingestion_batches")
    op.drop_table("fills")
    op.drop_table("fund_movements")
    op.drop_table("benchmark_returns")
    op.drop_table("fx_rates")
    op.drop_table("instruments")
    op.drop_table("strategies")
    op.drop_table("accounts")
    op.drop_table("series")
