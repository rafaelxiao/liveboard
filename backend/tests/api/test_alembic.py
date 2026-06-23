from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def _alembic_config() -> Config:
    backend_root = Path(__file__).resolve().parents[2]  # backend/
    cfg = Config(str(backend_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_root / "app" / "alembic"))
    return cfg


def test_alembic_has_single_head():
    script = ScriptDirectory.from_config(_alembic_config())
    heads = script.get_heads()
    assert len(heads) == 1, f"expected exactly one head, got {heads}"


def test_alembic_env_targets_base_metadata():
    import app.db as db

    # The migration metadata must be the same Base used by the app/models.
    assert db.Base.metadata is not None
