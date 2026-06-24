from fastapi import APIRouter

from app.routers import (
    admin,
    api_keys,
    auth,
    benchmark,
    comparisons,
    fx,
    health,
    ingestion,
    instruments,
    metrics,
    series,
    share_links,
)

api_router = APIRouter(prefix="/v1")

# Bulk share listing — must be on api_router directly to avoid route collision
# with /series/{series_id}/shares in share_links.router
from app.routers.share_links import list_all_shares
api_router.add_api_route("/series/shares", list_all_shares, methods=["GET"])

api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(admin.router)
api_router.include_router(api_keys.router)
api_router.include_router(series.router)
api_router.include_router(instruments.router)
api_router.include_router(fx.router)
api_router.include_router(benchmark.router)
api_router.include_router(ingestion.router)
api_router.include_router(metrics.router)
api_router.include_router(comparisons.router)
api_router.include_router(share_links.router)
