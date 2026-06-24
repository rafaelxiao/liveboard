"""add_client_movement_id_to_fund_movements

Revision ID: 3138927b0e96
Revises: 0003
Create Date: 2026-06-24 11:31:21.751074
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = '3138927b0e96'
down_revision: str | None = '0003'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('fund_movements', sa.Column('client_movement_id', sa.String(length=128), nullable=False, server_default=''))
    # Backfill existing rows with unique values based on id
    op.execute("UPDATE fund_movements SET client_movement_id = 'fm-legacy-' || id::text WHERE client_movement_id = ''")
    op.create_unique_constraint('uq_fund_movements_series_client_id', 'fund_movements', ['series_id', 'client_movement_id'])


def downgrade() -> None:
    op.drop_constraint('uq_fund_movements_series_client_id', 'fund_movements', type_='unique')
    op.drop_column('fund_movements', 'client_movement_id')
