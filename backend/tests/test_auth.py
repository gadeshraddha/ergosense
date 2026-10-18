"""Tests for health + authentication. Run from `backend/`:  pytest"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import create_app


@pytest.fixture()
def client(monkeypatch):
    # Never touch the real ergosense.db file during tests.
    monkeypatch.setattr("app.main.init_db", lambda: None)
    # A fresh in-memory database for every test.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    from app import models  # noqa: F401

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = create_app()
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c


def _register(client, name="Guddu", email="guddu@example.com", password="strongpass1"):
    return client.post("/api/auth/register", json={"name": name, "email": email, "password": password})


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert "mock" in r.json()


def test_register_returns_token_and_user(client):
    r = _register(client)
    assert r.status_code == 201
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["email"] == "guddu@example.com"
    assert "password" not in str(body).lower().replace("password_hash", "")


def test_duplicate_email_rejected(client):
    assert _register(client).status_code == 201
    r = _register(client, email="GUDDU@example.com")  # same email, different case
    assert r.status_code == 409


def test_short_password_rejected(client):
    r = _register(client, password="short")
    assert r.status_code == 422


def test_invalid_email_rejected(client):
    r = _register(client, email="not-an-email")
    assert r.status_code == 422


def test_login_success_and_me(client):
    _register(client)
    r = client.post("/api/auth/login", json={"email": "guddu@example.com", "password": "strongpass1"})
    assert r.status_code == 200
    token = r.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["name"] == "Guddu"


def test_login_wrong_password(client):
    _register(client)
    r = client.post("/api/auth/login", json={"email": "guddu@example.com", "password": "wrongpass1"})
    assert r.status_code == 401
    assert "Incorrect" in r.json()["detail"]


def test_login_unknown_email(client):
    r = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "whatever123"})
    assert r.status_code == 401


def test_me_without_token_is_401(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_with_garbage_token_is_401(client):
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.token"})
    assert r.status_code == 401


def test_two_users_are_independent(client):
    t1 = _register(client, name="A", email="a@example.com").json()["access_token"]
    t2 = _register(client, name="B", email="b@example.com").json()["access_token"]
    me1 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {t1}"}).json()
    me2 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {t2}"}).json()
    assert me1["email"] == "a@example.com"
    assert me2["email"] == "b@example.com"
    assert me1["id"] != me2["id"]
