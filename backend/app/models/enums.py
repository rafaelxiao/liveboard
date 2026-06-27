from enum import StrEnum


class AssetClass(StrEnum):
    EQUITY = "equity"
    FUTURE = "future"
    OPTION = "option"
    FX = "fx"
    CRYPTO = "crypto"
    CFD = "cfd"


class Side(StrEnum):
    BUY = "buy"
    SELL = "sell"


class Bucket(StrEnum):
    EXTERNAL = "EXTERNAL"
    FREE_CASH = "FREE_CASH"
    STRATEGY = "STRATEGY"


class PositionEffect(StrEnum):
    OPEN = "open"
    CLOSE = "close"


class IngestionKind(StrEnum):
    FILLS = "fills"
