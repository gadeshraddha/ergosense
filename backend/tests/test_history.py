"""Tests for the posture / history / sessions endpoints (M4 + M6).

Run from `backend/`:  pytest
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.engine.runtime import manager
from app.main import create_app
from app.models import Baseline, Event, Sample, User, WorkSession


@pytest.fixture()
def ctx(monkeypatch):
    """A client plus a direct DB handle, backed by a fresh in-memory database."""
    monkeypatch.setattr("app.main.init_db", lambda: None)
    manager._runtimes.clear()
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
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
        token = c.post(
            "/api/auth/register",
            json={"name": "Guddu", "email": "guddu@example.com", "password": "strongpass1"},
        ).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        uid = c.get("/api/auth/me", headers=headers).json()["id"]
        yield c, headers, uid, Session
    manager._runtimes.clear()


def _auth(ctx):
    client, headers, uid, _ = ctx
    return client, headers, uid


def add_sample(db, uid, *, ts, score=88.0, neck=6.0, lux=520.0, movement=0.05, dist=0.4):
    db.add(
        Sample(
            user_id=uid,
            ts=ts,
            neck_angle=neck,
            shoulder_tilt=0.8,
            head_forward=0.5,
            distance_proxy=dist,
            movement=movement,
            lux=lux,
            score=score,
        )
    )
    db.commit()


# --- history ----------------------------------------------------------------
def test_history_requires_auth(ctx):
    client, _, _, _ = ctx
    assert client.get("/api/history").status_code == 401
    assert client.get("/api/history/summary").status_code == 401
    assert client.get("/api/history/events").status_code == 401
    assert client.get("/api/history/export.csv").status_code == 401


def test_history_empty_range_returns_no_points_not_fake_ones(ctx):
    client, headers, _, _ = ctx
    r = client.get("/api/history?range=1h", headers=headers)
    assert r.status_code == 200
    assert r.json()["points"] == []
    assert r.json()["bucket_minutes"] >= 0

    s = client.get("/api/history/summary?range=today", headers=headers).json()
    assert s["samples"] == 0
    assert s["avg_score"] is None
    assert s["by_day"] == [] or all(d["sessions"] == 0 for d in s["by_day"])
    assert "No readings" in s["insight"]


def test_history_rejects_unknown_metric_or_range(ctx):
    client, headers, _, _ = ctx
    assert client.get("/api/history?metrics=posture,fake", headers=headers).status_code == 422
    # unknown ranges fall back to the default instead of crashing
    assert client.get("/api/history?range=nonsense", headers=headers).status_code == 200


def test_history_series_groups_stored_samples(ctx):
    client, headers, uid, Session = ctx
    now = datetime.now(timezone.utc)
    with Session() as db:
        for i, score in enumerate((80.0, 72.0, 91.0)):
            add_sample(db, uid, ts=now - timedelta(minutes=30 - i * 10), score=score, neck=4 + i)
            _ = i

    r = client.get("/api/history?range=1h&metrics=score,posture,lighting", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["metrics"] == ["score", "posture", "lighting"]
    assert len(body["points"]) >= 1
    first = body["points"][0]
    assert first["n"] >= 1
    assert first["score"] is not None
    assert first["posture"] is not None  # recomputed from the stored features
    assert first["lux"] is not None


def test_history_summary_counts_real_rows(ctx):
    client, headers, uid, Session = ctx
    now = datetime.now(timezone.utc)
    with Session() as db:
        for i in range(5):
            add_sample(db, uid, ts=now - timedelta(minutes=i * 2), score=85.0 + i)
        db.add(Event(user_id=uid, ts=now - timedelta(minutes=1), type="drift", severity="info", message="drift mild"))
        db.add(
            WorkSession(
                user_id=uid,
                start=now - timedelta(minutes=45),
                end=now - timedelta(minutes=15),
                avg_score=87.0,
                break_count=2,
            )
        )
        db.commit()

    s = client.get("/api/history/summary?range=today", headers=headers).json()
    assert s["samples"] == 5
    assert s["avg_score"] == pytest.approx(87.0, abs=0.5)
    assert s["best_score"] == 89.0
    assert s["worst_score"] == 85.0
    assert s["good_pct"] == 100.0
    assert s["drift_episodes"] == 1
    assert s["sessions"] == 1
    assert s["breaks"] == 2
    assert len(s["by_day"]) >= 1
    assert s["by_day"][0]["day"] == now.date().isoformat()
    assert s["heatmap"], "heatmap cells should come from the same rows"
    assert s["insight"] and "No readings" not in s["insight"]


def test_history_events_filter_and_pagination(ctx):
    client, headers, uid, Session = ctx
    now = datetime.now(timezone.utc)
    with Session() as db:
        for i in range(3):
            db.add(Event(user_id=uid, ts=now - timedelta(minutes=i), type="voice", severity="info", message=f"v{i}"))
        db.add(Event(user_id=uid, ts=now, type="drift", severity="warning", message="d0"))
        db.commit()

    all_events = client.get("/api/history/events?limit=2&offset=0", headers=headers).json()
    assert all_events["total"] == 4
    assert len(all_events["items"]) == 2
    page2 = client.get("/api/history/events?limit=2&offset=2", headers=headers).json()
    assert len(page2["items"]) == 2
    ids = {e["id"] for e in all_events["items"]} | {e["id"] for e in page2["items"]}
    assert len(ids) == 4

    only_drift = client.get("/api/history/events?type=drift", headers=headers).json()
    assert only_drift["total"] == 1
    assert only_drift["items"][0]["type"] == "drift"

    types = client.get("/api/history/event-types", headers=headers).json()
    assert set(types) == {"voice", "drift"}


def test_history_events_are_per_user(ctx):
    client, headers, uid, Session = ctx
    other = client.post(
        "/api/auth/register",
        json={"name": "B", "email": "b@example.com", "password": "strongpass1"},
    ).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    now = datetime.now(timezone.utc)
    with Session() as db:
        db.add(Event(user_id=uid, ts=now, type="voice", severity="info", message="mine"))
        db.commit()

    assert client.get("/api/history/events", headers=headers).json()["total"] == 1
    assert client.get("/api/history/events", headers=other_headers).json()["total"] == 0


def test_history_export_csv_downloads_rows(ctx):
    client, headers, uid, Session = ctx
    now = datetime.now(timezone.utc)
    with Session() as db:
        add_sample(db, uid, ts=now - timedelta(minutes=1))
    r = client.get("/api/history/export.csv?range=7d", headers=headers)
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    assert "attachment" in r.headers["content-disposition"]
    lines = [ln for ln in r.text.strip().splitlines() if ln]
    assert lines[0].startswith("ts,score,neck_angle")
    assert len(lines) == 2  # header + one stored row


# --- posture ----------------------------------------------------------------
def test_posture_summary_without_baseline_is_honest(ctx):
    client, headers, _, _ = ctx
    r = client.get("/api/posture/summary", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["calibrated"] is False
    assert body["present"] is False
    assert body["score"] is None  # no reading yet -> null, never a fake 100
    assert body["source"] == "none"
    assert len(body["features"]) == 4
    assert all(f["status"] == "unknown" for f in body["features"])
    assert all(f["current"] is None for f in body["features"])
    assert body["tip"]


def test_posture_summary_uses_baseline_and_stored_sample(ctx):
    client, headers, uid, Session = ctx
    now = datetime.now(timezone.utc)
    with Session() as db:
        db.add(
            Baseline(
                user_id=uid,
                is_active=True,
                json_stats={
                    "stats": {
                        "neck_angle": {"mean": 5.0, "std": 2.0, "median": 5.0, "mad": 1.0, "n": 60},
                        "distance_proxy": {"mean": 0.4, "std": 0.1, "median": 0.4, "mad": 0.05, "n": 60},
                        "shoulder_tilt": {"mean": 1.0, "std": 1.0, "median": 1.0, "mad": 0.5, "n": 60},
                        "head_forward": {"mean": 0.5, "std": 0.5, "median": 0.5, "mad": 0.2, "n": 60},
                    }
                },
            )
        )
        add_sample(db, uid, ts=now - timedelta(minutes=1), neck=11.0, score=64.0)  # z = +3
        db.commit()

    body = client.get("/api/posture/summary", headers=headers).json()
    assert body["calibrated"] is True
    assert body["present"] is True
    assert body["source"] == "stored"
    assert body["score"] == 64.0

    neck = next(f for f in body["features"] if f["key"] == "neck_angle")
    assert neck["current"] == 11.0
    assert neck["baseline"] == 5.0
    assert neck["z"] == pytest.approx(3.0, abs=0.01)
    assert neck["status"] == "poor"
    assert neck["higher_is_worse"] is True

    # the worst feature drives a concrete, feature-specific tip
    assert "leaning" in body["tip"].lower()
    assert body["today"]["n"] >= 1
    assert body["today"]["poor_pct"] == 100.0


def test_posture_trend_returns_buckets(ctx):
    client, headers, uid, Session = ctx
    now = datetime.now(timezone.utc)
    with Session() as db:
        for i in range(4):
            add_sample(db, uid, ts=now - timedelta(minutes=10 + i), neck=4 + i)
    r = client.get("/api/posture/trend?range=1h", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["range"] == "1h"
    assert len(body["points"]) >= 1
    assert body["points"][0]["neck_angle"] is not None
    assert body["mild_z"] == 1.0


# --- sessions ---------------------------------------------------------------
def test_sessions_stats_start_empty(ctx):
    client, headers, _, _ = ctx
    r = client.get("/api/sessions/stats", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["today_minutes"] == 0
    assert body["today_breaks"] == 0
    assert body["week_minutes"] == 0
    assert body["next_break_minutes"] is None
    assert body["sessions"] == []
    assert len(body["by_day"]) == 7
    assert all(d["work_minutes"] == 0 for d in body["by_day"])


def test_sessions_stats_from_stored_sessions_and_samples(ctx):
    client, headers, uid, Session = ctx
    now = datetime.now(timezone.utc)
    with Session() as db:
        # open session started 40 minutes ago
        db.add(WorkSession(user_id=uid, start=now - timedelta(minutes=40), end=None))
        # closed session yesterday
        db.add(
            WorkSession(
                user_id=uid,
                start=now - timedelta(days=1, hours=2),
                end=now - timedelta(days=1, hours=1),
                avg_score=85.0,
                break_count=1,
            )
        )
        add_sample(db, uid, ts=now - timedelta(minutes=5), score=77.0)
        db.commit()

    body = client.get("/api/sessions/stats", headers=headers).json()
    assert body["today_minutes"] == pytest.approx(40, abs=2)
    assert body["today_sessions"] == 1
    assert body["today_avg_score"] is None  # session is still running
    assert body["week_minutes"] == pytest.approx(100, abs=2)
    assert body["week_breaks"] == 1

    yesterday = (now - timedelta(days=1)).date().isoformat()
    row = next(d for d in body["by_day"] if d["day"] == yesterday)
    assert row["work_minutes"] == pytest.approx(60, abs=1)
    assert row["breaks"] == 1
    assert row["avg_score"] == 85.0  # no readings that day -> the session's own average

    today_row = next(d for d in body["by_day"] if d["day"] == now.date().isoformat())
    assert today_row["avg_score"] == 77.0  # real stored sample, not a placeholder

    assert len(body["sessions"]) == 2
    running = next(s for s in body["sessions"] if s["end"] is None)
    assert running["minutes"] == pytest.approx(40, abs=2)


def test_break_endpoint_writes_event_and_returns_ok(ctx):
    client, headers, uid, Session = ctx
    r = client.post("/api/sessions/break", headers=headers)
    assert r.status_code == 200
    assert r.json()["ok"] is True
    with Session() as db:
        assert db.query(Event).filter(Event.user_id == uid, Event.type == "break").count() == 1
    page = client.get("/api/history/events?type=break", headers=headers).json()
    assert page["total"] == 1


def test_sessions_list_requires_auth_and_returns_own(ctx):
    client, headers, uid, Session = ctx
    assert client.get("/api/sessions").status_code == 401
    assert client.get("/api/sessions/stats").status_code == 401

    now = datetime.now(timezone.utc)
    with Session() as db:
        db.add(WorkSession(user_id=uid, start=now - timedelta(minutes=10), end=now, avg_score=90.0))
        db.commit()
    rows = client.get("/api/sessions", headers=headers).json()
    assert len(rows) == 1
    assert rows[0]["avg_score"] == 90.0

    cur = client.get("/api/sessions/current", headers=headers).json()
    assert cur["present"] is False


# --- mode switch ------------------------------------------------------------
def test_mode_switch_moves_between_mock_and_real(ctx):
    client, headers, _, _ = ctx
    r = client.post("/api/monitor/mode", json={"mode": "real"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["mode"] == "real"

    live = client.get("/api/monitor/live", headers=headers).json()
    assert live["mode"] == "real"
    assert live["features"] == {}  # never carries mock features into real mode
    assert live["present"] is False

    # the switch is recorded so the timeline shows what happened
    assert client.get("/api/history/events?type=mode", headers=headers).json()["total"] == 1

    assert client.post("/api/monitor/mode", json={"mode": "mock"}, headers=headers).json()["mode"] == "mock"
    assert client.post("/api/monitor/mode", json={"mode": "bogus"}, headers=headers).status_code == 422
