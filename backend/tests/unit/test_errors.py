from app.core import errors
from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_app_error_subclasses_carry_status_and_code():
    assert errors.NotFoundError("x").status_code == 404
    assert errors.ConflictError("x").status_code == 409
    assert errors.ValidationAppError("x").status_code == 422
    assert errors.AuthError("x").status_code == 401
    assert errors.ForbiddenError("x").status_code == 403
    assert errors.PayloadTooLargeError("x").status_code == 413
    err = errors.NotFoundError("missing series")
    assert err.code == "not_found"
    assert err.message == "missing series"


def test_error_payload_shape():
    payload = errors.error_payload("not_found", "missing series")
    assert payload == {"error": {"code": "not_found", "message": "missing series", "details": None}}


def test_handlers_emit_uniform_json():
    app = FastAPI()
    errors.register_exception_handlers(app)

    @app.get("/boom")
    def boom():
        raise errors.ConflictError("email already registered")

    client = TestClient(app)
    resp = client.get("/boom")
    assert resp.status_code == 409
    body = resp.json()
    assert body["error"]["code"] == "conflict"
    assert body["error"]["message"] == "email already registered"


def test_request_validation_error_uses_same_envelope():
    from pydantic import BaseModel

    app = FastAPI()
    errors.register_exception_handlers(app)

    class Body(BaseModel):
        n: int

    @app.post("/v")
    def v(body: Body):
        return {"ok": True}

    client = TestClient(app)
    resp = client.post("/v", json={"n": "not-an-int"})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["details"] is not None
