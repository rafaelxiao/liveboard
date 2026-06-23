"""initial empty migration

Revision ID: 0001
Revises:
Create Date: 2026-06-19 00:00:00.000000
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Phase 0 establishes the migration baseline. Models arrive in Phase 1+.
    pass


def downgrade() -> None:
    pass
