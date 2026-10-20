"""History endpoints: what the sensors recorded over time.

Everything here is computed from rows in the `samples` table (written by the
runtime) plus the user's own events/sessions. No synthetic data: an empty range
comes back as an empty list, and the UI shows an empty state for it.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from ..config import settings
from ..database import get_db
from ..engine.core import scoring
from ..engine.core.baseline import stats_from_json
from ..models import Baseline, Event, Sample, User, WorkSession
from ..schemas import (
    DaySummary,
    EventPage,
    HeatmapCell,
    HistoryPoint,
    HistorySeries,
    HistorySummary,
)
from ..security import get_current_user

router = APIRouter(prefix="/api/history", tags=["history"])

RANGES = ("1h", "today", "7d", "30d")
METRICS = ("score", "posture", "screen", "lighting", "movement")
MAX_POINTS = 180
_EXPORT_ROW_LIMIT = 50_000


def _resolve(rng: str) -> tuple[str, datetime, datetime, str]:
    """Return (range, from, to, strftime format used for SQL grouping)."""
    if rng not in RANGES:
        rng = "1h"
    to = datetime.now(timezone.utc)
    if rng == "today":
        frm = to.replace(hour=0, minute=0, second=0, microsecond=0)
        return rng, frm, to, "%Y-%m-%d %H:%M"
    span = {"1h": timedelta(hours=1), "7d": timedelta(days=7), "30d": timedelta(days=30)}[rng]
    frm = to - span
    fmt = "%Y-%m-%d %H:%M" if span <= timedelta(days=1) else "%Y-%m-%d %H:00"
    return rng, frm, to, fmt


def _baseline_stats(db: DbSession, user_id: int) -> dict:
    base = (
        db.query(Baseline)
        .filter(Baseline.user_id == user_id, Baseline.is_active)
        .order_by(Baseline.id.desc())
        .first()
    )
    return stats_from_json(base.json_stats) if base else {}


def _bucket_rows(db: DbSession, user_id: int, frm: datetime, to: datetime, fmt: str):
    """Average each recorded column per time bucket (SQL does the heavy lifting)."""
    cols = (
        func.avg(Sample.score),
        func.avg(Sample.neck_angle),
        func.avg(Sample.shoulder_tilt),
        func.avg(Sample.head_forward),
        func.avg(Sample.distance_proxy),
        func.avg(Sample.lux),
        func.avg(Sample.movement),
        func.count(Sample.id),
    )
    group_expr = func.strftime(fmt, Sample.ts)
    rows = (
        db.query(group_expr, *cols)
        .filter(Sample.user_id == user_id, Sample.ts >= frm, Sample.ts <= to)
        .group_by(group_expr)
        .order_by(group_expr)
        .all()
    )
    out = []
    for r in rows:
        try:
            bucket = datetime.strptime(r[0], fmt).replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            continue
        out.append((bucket, r[1:]))
    return out


def _merge(rows, max_points: int = MAX_POINTS):
    """Fold SQL buckets into at most `max_points` chart points."""
    if not rows:
        return []
    if len(rows) <= max_points:
        return rows
    chunk = (len(rows) + max_points - 1) // max_points
    merged = []
    for i in range(0, len(rows), chunk):
        part = rows[i : i + chunk]
        # average the numeric aggregates (already averaged per bucket) weighted by n
        n = sum((v[7] or 0) for _, v in part)
        if n <= 0:
            n = len(part)
        avgs = []
        for idx in range(7):
            total = sum((v[idx] or 0.0) * (v[7] or 0) for _, v in part)
            avgs.append(total / n if n else None)
        merged.append((part[0][0], (*avgs, n)))
    return merged


def _factor_scores(stats: dict, neck: float | None, dist: float | None, lux: float | None, mov: float | None) -> dict:
    return {
        "posture": scoring.score_posture(neck, stats.get("neck_angle"), settings.posture_z_penalty)
        if neck is not None
        else None,
        "screen": scoring.score_screen(dist, stats.get("distance_proxy"), settings.screen_z_penalty)
        if dist is not None
        else None,
        "lighting": scoring.score_lighting(lux, settings.lux_comfort_min, settings.lux_comfort_max),
        "movement": scoring.score_movement(mov, settings.movement_min),
    }


@router.get("", response_model=HistorySeries)
def history_series(
    range: str = Query(default="1h"),
    metrics: str = Query(default="score"),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> HistorySeries:
    wanted = [m.strip() for m in metrics.split(",") if m.strip()]
    unknown = [m for m in wanted if m not in METRICS]
    if unknown:
        raise HTTPException(422, f"Unknown metric(s): {', '.join(unknown)}. Use {', '.join(METRICS)}.")
    if not wanted:
        wanted = ["score"]

    rng, frm, to, fmt = _resolve(range)
    stats = _baseline_stats(db, user.id)
    rows = _merge(_bucket_rows(db, user.id, frm, to, fmt))

    points: list[HistoryPoint] = []
    for ts, v in rows:
        score, neck, tilt, head, dist, lux, mov, n = v
        factors = _factor_scores(stats, neck, dist, lux, mov)
        data: dict = {"ts": ts, "n": int(n or 0), "lux": lux}
        if "score" in wanted:
            data["score"] = score
        if "posture" in wanted:
            data["posture"] = factors["posture"]
        if "screen" in wanted:
            data["screen"] = factors["screen"]
        if "lighting" in wanted:
            data["lighting"] = factors["lighting"]
        if "movement" in wanted:
            data["movement"] = factors["movement"]
        points.append(HistoryPoint(**data))

    total_minutes = max(1.0, (to - frm).total_seconds() / 60.0)
    return HistorySeries(
        range=rng,
        from_ts=frm,
        to_ts=to,
        bucket_minutes=round(total_minutes / max(1, len(points)), 2),
        metrics=wanted,
        points=points,
    )


def _session_windows(db: DbSession, user_id: int, frm: datetime, to: datetime) -> list[WorkSession]:
    return (
        db.query(WorkSession)
        .filter(
            WorkSession.user_id == user_id,
            WorkSession.start <= to,
            (WorkSession.end.is_(None)) | (WorkSession.end >= frm),
        )
        .order_by(WorkSession.start.asc())
        .all()
    )


def _overlap_minutes(start: datetime, end: datetime, frm: datetime, to: datetime) -> float:
    s = max(_aware(start), frm)
    e = min(_aware(end), to)
    return max(0.0, (e - s).total_seconds() / 60.0)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@router.get("/summary", response_model=HistorySummary)
def history_summary(
    range: str = Query(default="7d"),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> HistorySummary:
    rng, frm, to, _ = _resolve(range)

    # --- samples ---
    agg = db.query(
        func.count(Sample.id),
        func.avg(Sample.score),
        func.max(Sample.score),
        func.min(Sample.score),
    ).filter(Sample.user_id == user.id, Sample.ts >= frm, Sample.ts <= to)
    n, avg_score, best, worst = agg.one()

    good = (
        db.query(func.count(Sample.id))
        .filter(
            Sample.user_id == user.id,
            Sample.ts >= frm,
            Sample.ts <= to,
            Sample.score >= 80,
        )
        .scalar()
        or 0
    )

    # --- per-day ---
    day_rows = (
        db.query(
            func.strftime("%Y-%m-%d", Sample.ts),
            func.avg(Sample.score),
            func.count(Sample.id),
        )
        .filter(Sample.user_id == user.id, Sample.ts >= frm, Sample.ts <= to)
        .group_by(func.strftime("%Y-%m-%d", Sample.ts))
        .order_by(func.strftime("%Y-%m-%d", Sample.ts))
        .all()
    )
    day_good = dict(
        db.query(func.strftime("%Y-%m-%d", Sample.ts), func.count(Sample.id))
        .filter(
            Sample.user_id == user.id,
            Sample.ts >= frm,
            Sample.ts <= to,
            Sample.score >= 80,
        )
        .group_by(func.strftime("%Y-%m-%d", Sample.ts))
        .all()
    )

    # --- heatmap (day x hour) ---
    heat_rows = (
        db.query(
            func.strftime("%Y-%m-%d", Sample.ts),
            func.strftime("%H", Sample.ts),
            func.avg(Sample.score),
            func.count(Sample.id),
        )
        .filter(Sample.user_id == user.id, Sample.ts >= frm, Sample.ts <= to)
        .group_by(func.strftime("%Y-%m-%d", Sample.ts), func.strftime("%H", Sample.ts))
        .order_by(func.strftime("%Y-%m-%d", Sample.ts), func.strftime("%H", Sample.ts))
        .all()
    )
    heatmap = [
        HeatmapCell(day=d, hour=int(h), avg_score=round(float(a or 0.0), 1), n=int(c))
        for d, h, a, c in heat_rows
    ]

    # --- sessions / breaks ---
    sessions = _session_windows(db, user.id, frm, to)
    hours = 0.0
    sessions_by_day: dict[str, list[WorkSession]] = {}
    for s in sessions:
        end = s.end or _aware(to)
        hours += _overlap_minutes(s.start, end, frm, to) / 60.0
        sessions_by_day.setdefault(_aware(s.start).date().isoformat(), []).append(s)
    breaks = sum(int(s.break_count or 0) for s in sessions)

    by_day: list[DaySummary] = []
    for d, d_avg, d_n in day_rows:
        in_day = sessions_by_day.get(d, [])
        day_hours = sum(
            _overlap_minutes(s.start, s.end or _aware(to), frm, to) for s in in_day
        ) / 60.0
        by_day.append(
            DaySummary(
                day=d,
                hours=round(day_hours, 2),
                avg_score=round(float(d_avg), 1) if d_avg is not None else None,
                good_pct=round(100.0 * day_good.get(d, 0) / d_n, 1) if d_n else None,
                sessions=len(in_day),
            )
        )

    # --- events ---
    drift_episodes = (
        db.query(func.count(Event.id))
        .filter(
            Event.user_id == user.id,
            Event.type == "drift",
            Event.ts >= frm,
            Event.ts <= to,
        )
        .scalar()
        or 0
    )

    return HistorySummary(
        range=rng,
        from_ts=frm,
        to_ts=to,
        samples=int(n or 0),
        hours=round(hours, 2),
        avg_score=round(float(avg_score), 1) if avg_score is not None else None,
        best_score=round(float(best), 1) if best is not None else None,
        worst_score=round(float(worst), 1) if worst is not None else None,
        good_pct=round(100.0 * good / n, 1) if n else None,
        drift_episodes=int(drift_episodes),
        sessions=len(sessions),
        breaks=breaks,
        by_day=by_day,
        heatmap=heatmap,
        insight=_insight(avg_score, n, int(drift_episodes), heatmap),
    )


def _insight(avg_score, n, drift_episodes, heatmap) -> str:
    """One plain-English card, derived only from the numbers we just counted."""
    if not n:
        return "No readings in this range yet. Start a monitoring session to build history."
    avg = float(avg_score)
    if drift_episodes:
        return (
            f"{drift_episodes} posture drift episode{'s' if drift_episodes != 1 else ''} in this "
            f"range (average score {avg:.0f}). Your score drops when you hold one position too long."
        )
    # worst hour of day with enough readings
    worst = None
    for cell in heatmap:
        if cell.n < 8:
            continue
        if worst is None or cell.avg_score < worst.avg_score:
            worst = cell
    if worst and worst.avg_score < avg - 6:
        return (
            f"Your score dips to {worst.avg_score:.0f} around {worst.hour:02d}:00 — "
            f"that is the best time of day to plan a break (period average {avg:.0f})."
        )
    if avg < 70:
        return (
            f"Your score averages {avg:.0f} in this range, below your comfort target of 80. "
            "Check the posture page to see which factor is costing you the most points."
        )
    if n and avg >= 85:
        return f"Solid stretch: your score averages {avg:.0f} and stayed consistent across this range."
    return f"Your score averages {avg:.0f} across this range with {n} readings — steady overall."


@router.get("/events", response_model=EventPage)
def history_events(
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    type: str | None = Query(default=None),
    range: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> EventPage:
    q = db.query(Event).filter(Event.user_id == user.id)
    if type and type != "all":
        q = q.filter(Event.type == type)
    if range:
        _, frm, to, _ = _resolve(range)
        q = q.filter(Event.ts >= frm, Event.ts <= to)
    total = q.count()
    items = q.order_by(Event.ts.desc()).offset(offset).limit(limit).all()
    return EventPage(items=list(items), total=total, limit=limit, offset=offset)


@router.get("/event-types")
def event_types(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> list[str]:
    rows = (
        db.query(Event.type)
        .filter(Event.user_id == user.id)
        .distinct()
        .order_by(Event.type)
        .all()
    )
    return [r[0] for r in rows]


@router.get("/export.csv")
def export_csv(
    range: str = Query(default="7d"),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> StreamingResponse:
    _, frm, to, _ = _resolve(range)

    def generate():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            ["ts", "score", "neck_angle", "shoulder_tilt", "head_forward", "distance_proxy", "movement", "lux"]
        )
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        q = (
            db.query(Sample)
            .filter(Sample.user_id == user.id, Sample.ts >= frm, Sample.ts <= to)
            .order_by(Sample.ts.asc())
            .limit(_EXPORT_ROW_LIMIT)
        )
        for row in q.yield_per(500):
            writer.writerow(
                [
                    _aware(row.ts).isoformat(),
                    row.score,
                    row.neck_angle,
                    row.shoulder_tilt,
                    row.head_forward,
                    row.distance_proxy,
                    row.movement,
                    row.lux,
                ]
            )
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="ergosense-history-{range}.csv"'
        },
    )
