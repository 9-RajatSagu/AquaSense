"""AquaSense API.

Website users sign in with Supabase Auth and send their access token as
"Authorization: Bearer <token>". ESP32 devices send "X-Device-Id" and
"X-Device-Key" headers. Each device belongs to one or more accounts through the
device_members table, so several accounts can watch the same tank.
"""

import hashlib
import hmac
import logging
import math
import os
import secrets
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from supabase import Client, create_client

load_dotenv(Path(__file__).resolve().parent / ".env")

log = logging.getLogger("aquasense")

# Rules used when a reading arrives from a device.
STORE_EVERY_SECONDS = 30      # normal history resolution
SUDDEN_DROP_PCT = 10.0        # drop between two readings, pump off, that is reported
SUDDEN_DROP_MAX_GAP_S = 120   # only compare readings that are close in time
LEVEL_CHANGE_STORE_PCT = 2.0  # store immediately when the level moves this much
DEADBAND_PCT = 3.0            # ignore sensor ripple smaller than this in usage totals
MAX_ROWS = 30000

ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0, O, 1, I

app = FastAPI(title="AquaSense API", version="2.0.0")

origins = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    log.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on the server."})


# ---------------------------------------------------------------- helpers

@lru_cache(maxsize=1)
def db() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.")
    return create_client(url, key)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def key_matches(key: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_key(key), stored_hash)


def current_user(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Please sign in.")
    token = authorization[7:].strip()
    try:
        result = db().auth.get_user(token)
        user = result.user if result else None
    except Exception:
        user = None
    if user is None:
        raise HTTPException(status_code=401, detail="Your session has expired. Sign in again.")
    return str(user.id)


def require_member(device_id: str, user_id: str) -> None:
    res = (
        db()
        .table("device_members")
        .select("device_id")
        .eq("device_id", device_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Device not found.")


def get_settings_row(device_id: str) -> dict:
    res = db().table("device_settings").select("*").eq("device_id", device_id).limit(1).execute()
    if res.data:
        return res.data[0]
    return {"device_id": device_id, "capacity_litres": 600, "low_alert_pct": 20, "offline_after_s": 120}


def device_view(device: dict, settings: dict) -> dict:
    seen = parse_ts(device.get("last_seen"))
    offline_after = settings.get("offline_after_s") or 120
    online = bool(seen and (utcnow() - seen).total_seconds() <= offline_after)
    return {
        "device_id": device["device_id"],
        "name": device["name"],
        "online": online,
        "last_seen": device.get("last_seen"),
        "latest": {
            "level_pct": device.get("last_level_pct"),
            "distance_cm": device.get("last_distance_cm"),
            "water_cm": device.get("last_water_cm"),
            "volume_ml": device.get("last_volume_ml"),
            "pump_on": device.get("last_pump_on"),
            "locked": device.get("last_locked"),
        },
        "settings": {
            "capacity_litres": settings.get("capacity_litres", 600),
            "low_alert_pct": settings.get("low_alert_pct", 20),
            "offline_after_s": settings.get("offline_after_s", 120),
        },
    }


def new_device_id() -> str:
    part = lambda: "".join(secrets.choice(ID_ALPHABET) for _ in range(4))  # noqa: E731
    return f"AQ-{part()}-{part()}"


def fetch_readings(device_id: str, since: datetime, columns: str) -> list:
    rows: list = []
    start = 0
    page = 1000
    while len(rows) < MAX_ROWS:
        res = (
            db()
            .table("readings")
            .select(columns)
            .eq("device_id", device_id)
            .gte("created_at", since.isoformat())
            .order("created_at")
            .range(start, start + page - 1)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page:
            break
        start += page
    return rows


# ---------------------------------------------------------------- models

class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class DeviceLink(BaseModel):
    device_id: str = Field(min_length=3, max_length=40)
    device_key: str = Field(min_length=8, max_length=200)


class SettingsIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    capacity_litres: float = Field(gt=0, le=100000)
    low_alert_pct: float = Field(ge=0, le=100)
    offline_after_s: int = Field(ge=30, le=86400)


class ReadingIn(BaseModel):
    distance_cm: Optional[float] = None
    water_cm: Optional[float] = None
    volume_ml: Optional[float] = None
    level_pct: float = Field(ge=0, le=100)
    pump_on: bool = False
    locked: bool = False


# ---------------------------------------------------------------- health

@app.get("/api/health")
def health():
    try:
        db().table("devices").select("device_id").limit(1).execute()
        return {"application": "AquaSense", "status": "online", "database": "connected"}
    except Exception:
        raise HTTPException(
            status_code=503,
            detail={"application": "AquaSense", "status": "error", "database": "connection_failed"},
        )


# ---------------------------------------------------------------- device side

@app.post("/api/readings", status_code=201)
def ingest_reading(
    reading: ReadingIn,
    x_device_id: str = Header(),
    x_device_key: str = Header(),
):
    client = db()
    device_id = x_device_id.strip().upper()
    res = client.table("devices").select("*").eq("device_id", device_id).limit(1).execute()
    device = res.data[0] if res.data else None
    if device is None or not key_matches(x_device_key.strip(), device["key_hash"]):
        raise HTTPException(status_code=401, detail="Unknown device or wrong key.")

    settings = get_settings_row(device_id)
    now = utcnow()
    level = float(reading.level_pct)

    prev_level = device.get("last_level_pct")
    prev_pump = device.get("last_pump_on")
    prev_locked = bool(device.get("last_locked"))
    last_seen = parse_ts(device.get("last_seen"))
    last_stored = parse_ts(device.get("last_stored_at"))
    gap = (now - last_seen).total_seconds() if last_seen else None

    events = []

    def add_event(kind: str, detail: str) -> None:
        events.append({"device_id": device_id, "kind": kind, "detail": detail, "level_pct": round(level, 1)})

    if last_seen is None:
        add_event("device_online", "First data received from this device.")
    elif gap is not None and gap > settings["offline_after_s"]:
        add_event("device_online", "Device is back online.")

    if prev_pump is not None and prev_pump != reading.pump_on:
        if reading.pump_on:
            add_event("pump_started", f"Pump started at {level:.0f}% level.")
        else:
            add_event("pump_stopped", f"Pump stopped at {level:.0f}% level.")

    if reading.locked and not prev_locked:
        add_event("pump_locked", "Safety timer stopped the pump. Check the water source and the pump.")

    if (
        prev_level is not None
        and not reading.pump_on
        and prev_pump is False
        and gap is not None
        and gap <= SUDDEN_DROP_MAX_GAP_S
        and prev_level - level >= SUDDEN_DROP_PCT
    ):
        add_event("sudden_drop", f"Level fell from {prev_level:.0f}% to {level:.0f}% while the pump was off.")

    low = settings["low_alert_pct"]
    if prev_level is not None and prev_level >= low > level:
        add_event("low_level", f"Level dropped below {low:.0f}%.")

    should_store = (
        last_stored is None
        or (now - last_stored).total_seconds() >= STORE_EVERY_SECONDS
        or bool(events)
        or (prev_level is not None and abs(level - prev_level) >= LEVEL_CHANGE_STORE_PCT)
    )

    if should_store:
        client.table("readings").insert(
            {
                "device_id": device_id,
                "distance_cm": reading.distance_cm,
                "water_cm": reading.water_cm,
                "volume_ml": reading.volume_ml,
                "level_pct": level,
                "pump_on": reading.pump_on,
                "locked": reading.locked,
            }
        ).execute()
    if events:
        client.table("events").insert(events).execute()

    update = {
        "last_seen": now.isoformat(),
        "last_level_pct": level,
        "last_distance_cm": reading.distance_cm,
        "last_water_cm": reading.water_cm,
        "last_volume_ml": reading.volume_ml,
        "last_pump_on": reading.pump_on,
        "last_locked": reading.locked,
    }
    if should_store:
        update["last_stored_at"] = now.isoformat()
    client.table("devices").update(update).eq("device_id", device_id).execute()

    return {"ok": True, "stored": should_store}


# ---------------------------------------------------------------- account side

@app.get("/api/devices")
def list_devices(user_id: str = Depends(current_user)):
    client = db()
    members = client.table("device_members").select("device_id").eq("user_id", user_id).execute().data or []
    ids = [m["device_id"] for m in members]
    if not ids:
        return {"devices": []}
    devices = client.table("devices").select("*").in_("device_id", ids).order("created_at").execute().data or []
    settings = client.table("device_settings").select("*").in_("device_id", ids).execute().data or []
    by_id = {s["device_id"]: s for s in settings}
    return {"devices": [device_view(d, by_id.get(d["device_id"], {})) for d in devices]}


@app.post("/api/devices", status_code=201)
def create_device(body: DeviceCreate, user_id: str = Depends(current_user)):
    client = db()
    key = secrets.token_urlsafe(24)
    device_id = ""
    for _ in range(8):
        candidate = new_device_id()
        exists = client.table("devices").select("device_id").eq("device_id", candidate).limit(1).execute()
        if not exists.data:
            device_id = candidate
            break
    if not device_id:
        raise HTTPException(status_code=500, detail="Could not create a device id. Try again.")

    name = body.name.strip()
    client.table("devices").insert(
        {"device_id": device_id, "key_hash": hash_key(key), "name": name, "created_by": user_id}
    ).execute()
    try:
        client.table("device_members").insert({"device_id": device_id, "user_id": user_id}).execute()
        client.table("device_settings").insert({"device_id": device_id}).execute()
    except Exception:
        client.table("devices").delete().eq("device_id", device_id).execute()
        raise

    device = client.table("devices").select("*").eq("device_id", device_id).limit(1).execute().data[0]
    view = device_view(device, get_settings_row(device_id))
    # The key is returned only once. Only its hash is stored.
    return {"device": view, "device_key": key}


@app.post("/api/devices/link")
def link_device(body: DeviceLink, user_id: str = Depends(current_user)):
    client = db()
    device_id = body.device_id.strip().upper()
    res = client.table("devices").select("*").eq("device_id", device_id).limit(1).execute()
    device = res.data[0] if res.data else None
    if device is None or not key_matches(body.device_key.strip(), device["key_hash"]):
        raise HTTPException(status_code=404, detail="No device matches that id and key.")
    client.table("device_members").upsert(
        {"device_id": device_id, "user_id": user_id}, on_conflict="device_id,user_id"
    ).execute()
    return {"device": device_view(device, get_settings_row(device_id))}


@app.delete("/api/devices/{device_id}")
def remove_device(device_id: str, user_id: str = Depends(current_user)):
    """Removes this device from the signed-in account. If nobody else uses it, it is deleted."""
    client = db()
    require_member(device_id, user_id)
    client.table("device_members").delete().eq("device_id", device_id).eq("user_id", user_id).execute()
    left = client.table("device_members").select("user_id").eq("device_id", device_id).limit(1).execute()
    if not left.data:
        client.table("devices").delete().eq("device_id", device_id).execute()
    return {"ok": True}


@app.delete("/api/account")
def delete_account(user_id: str = Depends(current_user)):
    """Leaves every device, deletes devices nobody else uses, then deletes the login."""
    client = db()
    members = client.table("device_members").select("device_id").eq("user_id", user_id).execute().data or []
    for m in members:
        remove_device(m["device_id"], user_id)
    client.auth.admin.delete_user(user_id)
    return {"ok": True}


@app.get("/api/devices/{device_id}")
def get_device(device_id: str, user_id: str = Depends(current_user)):
    require_member(device_id, user_id)
    res = db().table("devices").select("*").eq("device_id", device_id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Device not found.")
    return {"device": device_view(res.data[0], get_settings_row(device_id))}


@app.put("/api/devices/{device_id}/settings")
def update_settings(device_id: str, body: SettingsIn, user_id: str = Depends(current_user)):
    client = db()
    require_member(device_id, user_id)
    client.table("devices").update({"name": body.name.strip()}).eq("device_id", device_id).execute()
    client.table("device_settings").upsert(
        {
            "device_id": device_id,
            "capacity_litres": body.capacity_litres,
            "low_alert_pct": body.low_alert_pct,
            "offline_after_s": body.offline_after_s,
        },
        on_conflict="device_id",
    ).execute()
    res = client.table("devices").select("*").eq("device_id", device_id).limit(1).execute()
    return {"device": device_view(res.data[0], get_settings_row(device_id))}


@app.get("/api/devices/{device_id}/readings")
def get_readings(
    device_id: str,
    hours: int = Query(default=24, ge=1, le=720),
    user_id: str = Depends(current_user),
):
    require_member(device_id, user_id)
    since = utcnow() - timedelta(hours=hours)
    rows = fetch_readings(device_id, since, "created_at,level_pct,pump_on")

    max_points = 300
    bucket = max(30, math.ceil(hours * 3600 / max_points))
    buckets: dict = {}
    for r in rows:
        ts = parse_ts(r["created_at"])
        if ts is None:
            continue
        idx = int(ts.timestamp() // bucket)
        b = buckets.setdefault(idx, {"sum": 0.0, "n": 0, "pump": False, "t": idx * bucket})
        b["sum"] += float(r["level_pct"])
        b["n"] += 1
        b["pump"] = b["pump"] or bool(r["pump_on"])
    points = [
        {
            "t": datetime.fromtimestamp(b["t"], tz=timezone.utc).isoformat(),
            "level_pct": round(b["sum"] / b["n"], 1),
            "pump_on": b["pump"],
        }
        for _, b in sorted(buckets.items())
    ]
    return {"hours": hours, "points": points}


@app.get("/api/devices/{device_id}/analytics")
def get_analytics(
    device_id: str,
    days: int = Query(default=7, ge=1, le=30),
    tz_offset_minutes: int = Query(default=0, ge=-840, le=840),
    user_id: str = Depends(current_user),
):
    """Daily totals in percent of tank capacity. The website converts them to litres."""
    require_member(device_id, user_id)
    offset = timedelta(minutes=tz_offset_minutes)
    local_now = utcnow() + offset
    first_day = (local_now - timedelta(days=days - 1)).date()
    since = datetime(first_day.year, first_day.month, first_day.day, tzinfo=timezone.utc) - offset

    rows = fetch_readings(device_id, since, "created_at,level_pct,pump_on")

    per_day = {}
    for i in range(days):
        d = (first_day + timedelta(days=i)).isoformat()
        per_day[d] = {"date": d, "filled_pct": 0.0, "consumed_pct": 0.0, "pump_minutes": 0.0}

    ref: Optional[float] = None
    prev_ts: Optional[datetime] = None
    prev_pump = False
    levels = []
    for r in rows:
        ts = parse_ts(r["created_at"])
        if ts is None:
            continue
        lvl = float(r["level_pct"])
        levels.append(lvl)
        day = (ts + offset).date().isoformat()
        bucket = per_day.get(day)
        if bucket is None:
            continue
        if ref is None:
            ref = lvl
        else:
            diff = lvl - ref
            if abs(diff) >= DEADBAND_PCT:
                if diff > 0:
                    bucket["filled_pct"] += diff
                else:
                    bucket["consumed_pct"] += -diff
                ref = lvl
        if prev_ts is not None and prev_pump and r["pump_on"]:
            bucket["pump_minutes"] += min((ts - prev_ts).total_seconds(), 120) / 60
        prev_ts = ts
        prev_pump = bool(r["pump_on"])

    days_out = [
        {
            "date": d["date"],
            "filled_pct": round(d["filled_pct"], 1),
            "consumed_pct": round(d["consumed_pct"], 1),
            "pump_minutes": round(d["pump_minutes"], 1),
        }
        for d in per_day.values()
    ]
    summary = {
        "readings": len(levels),
        "min_pct": round(min(levels), 1) if levels else None,
        "max_pct": round(max(levels), 1) if levels else None,
        "avg_pct": round(sum(levels) / len(levels), 1) if levels else None,
    }
    return {"days": days_out, "summary": summary}


@app.get("/api/devices/{device_id}/events")
def get_events(
    device_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    around: Optional[str] = None,
    minutes: int = Query(default=30, ge=1, le=1440),
    user_id: str = Depends(current_user),
):
    require_member(device_id, user_id)
    query = db().table("events").select("id,created_at,kind,detail,level_pct").eq("device_id", device_id)
    if around:
        center = parse_ts(around)
        if center is None:
            raise HTTPException(status_code=422, detail="The time you entered is not valid.")
        start = (center - timedelta(minutes=minutes)).isoformat()
        end = (center + timedelta(minutes=minutes)).isoformat()
        query = query.gte("created_at", start).lte("created_at", end)
    res = query.order("created_at", desc=True).limit(limit).execute()
    return {"events": res.data or []}
