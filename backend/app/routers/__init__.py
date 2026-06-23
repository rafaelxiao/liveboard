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
)

api_router = APIRouter()
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
