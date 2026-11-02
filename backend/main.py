"""AquaSense API.

Website users sign in with Supabase Auth and send their access token as
"Authorization: Bearer <token>". Only users with a confirmed email are served.
ESP32 devices send "X-Device-Id" and "X-Device-Key" headers.

Pump commands never go straight to the hardware. The website stores a command,
the ESP32 picks it up in the answer to its next reading, runs it only if its own
safety checks allow it, and reports the result. The website shows success only
after that report arrives.
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
from typing import Literal, Optional

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

# Pump commands.
COMMAND_PENDING_TTL_S = 30    # the device must pick a command up within this time
COMMAND_SENT_TTL_S = 30       # and confirm it within this time
COMMAND_MAX_SILENCE_S = 30    # device must have reported this recently to accept a command
MANUAL_MAX_SECONDS = 120      # longest manual run the device is asked to do
FULL_BLOCK_PCT = 97.0         # no manual start above this level
INVITE_TTL_HOURS = 24

ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0, O, 1, I

app = FastAPI(title="AquaSense API", version="3.0.0")

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
    confirmed = getattr(user, "email_confirmed_at", None) or getattr(user, "confirmed_at", None)
    if not confirmed:
        raise HTTPException(status_code=403, detail="Confirm your email address before using AquaSense.")
    return str(user.id)


def member_role(device_id: str, user_id: str) -> Optional[str]:
    res = (
        db()
        .table("device_members")
        .select("role")
        .eq("device_id", device_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return res.data[0]["role"] if res.data else None


def require_member(device_id: str, user_id: str) -> str:
    role = member_role(device_id, user_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Device not found.")
    return role


def require_owner(device_id: str, user_id: str) -> None:
    if require_member(device_id, user_id) != "owner":
        raise HTTPException(status_code=403, detail="Only the owner of this device can do that.")


def get_device_row(device_id: str) -> dict:
    res = db().table("devices").select("*").eq("device_id", device_id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Device not found.")
    return res.data[0]


def get_settings_row(device_id: str) -> dict:
    defaults = {"device_id": device_id, "capacity_litres": 600, "low_alert_pct": 20, "offline_after_s": 120,
                "start_pct": 25, "stop_pct": 100}
    res = db().table("device_settings").select("*").eq("device_id", device_id).limit(1).execute()
    if res.data:
        return {**defaults, **{k: v for k, v in res.data[0].items() if v is not None}}
    return defaults


def device_view(device: dict, settings: dict, role: Optional[str] = None) -> dict:
    seen = parse_ts(device.get("last_seen"))
    offline_after = settings.get("offline_after_s") or 120
    online = bool(seen and (utcnow() - seen).total_seconds() <= offline_after)
    return {
        "device_id": device["device_id"],
        "name": device["name"],
        "role": role,
        "online": online,
        "last_seen": device.get("last_seen"),
        "latest": {
            "level_pct": device.get("last_level_pct"),
            "distance_cm": device.get("last_distance_cm"),
            "water_cm": device.get("last_water_cm"),
            "volume_ml": device.get("last_volume_ml"),
            "pump_on": device.get("last_pump_on"),
            "locked": device.get("last_locked"),
            "sensor_ok": device.get("last_sensor_ok"),
        },
        "settings": {
            "capacity_litres": settings.get("capacity_litres", 600),
            "low_alert_pct": settings.get("low_alert_pct", 20),
            "offline_after_s": settings.get("offline_after_s", 120),
            "start_pct": settings.get("start_pct", 25),
            "stop_pct": settings.get("stop_pct", 100),
        },
    }


def random_code(parts: int) -> str:
    chunk = lambda: "".join(secrets.choice(ID_ALPHABET) for _ in range(4))  # noqa: E731
    return "-".join(chunk() for _ in range(parts))


def new_device_id() -> str:
    return "AQ-" + random_code(2)


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


def expire_stale_commands(device_id: str, now: datetime) -> None:
    client = db()
    pending_cut = (now - timedelta(seconds=COMMAND_PENDING_TTL_S)).isoformat()
    sent_cut = (now - timedelta(seconds=COMMAND_SENT_TTL_S)).isoformat()
    client.table("commands").update(
        {"status": "expired", "finished_at": now.isoformat(), "note": "The device did not pick up the command in time."}
    ).eq("device_id", device_id).eq("status", "pending").lt("created_at", pending_cut).execute()
    client.table("commands").update(
        {"status": "failed", "finished_at": now.isoformat(), "note": "No confirmation arrived from the device."}
    ).eq("device_id", device_id).eq("status", "sent").lt("sent_at", sent_cut).execute()


def command_view(row: dict, user_id: str) -> dict:
    return {
        "id": row["id"],
        "action": row["action"],
        "status": row["status"],
        "note": row.get("note"),
        "created_at": row["created_at"],
        "finished_at": row.get("finished_at"),
        "mine": row.get("requested_by") == user_id,
    }


# ---------------------------------------------------------------- models

class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class RedeemIn(BaseModel):
    code: str = Field(min_length=4, max_length=40)


class SettingsIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    capacity_litres: float = Field(gt=0, le=100000)
    low_alert_pct: float = Field(ge=0, le=100)
    offline_after_s: int = Field(ge=30, le=86400)
    start_pct: float = Field(ge=5, le=90)
    stop_pct: float = Field(ge=20, le=100)


class CommandIn(BaseModel):
    action: Literal["pump_on", "pump_off"]


class ReadingIn(BaseModel):
    distance_cm: Optional[float] = None
    water_cm: Optional[float] = None
    volume_ml: Optional[float] = None
    # None means the sensor gave no valid reading. The message is then a heartbeat only.
    level_pct: Optional[float] = Field(default=None, ge=0, le=100)
    pump_on: bool = False
    locked: bool = False
    cmd_id: Optional[int] = None
    cmd_status: Optional[str] = Field(default=None, max_length=10)
    cmd_note: Optional[str] = Field(default=None, max_length=200)


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

def pump_run_text(device_id: str, now: datetime) -> str:
    res = (
        db()
        .table("events")
        .select("created_at")
        .eq("device_id", device_id)
        .eq("kind", "pump_started")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not res.data:
        return ""
    start = parse_ts(res.data[0]["created_at"])
    if start is None:
        return ""
    secs = int((now - start).total_seconds())
    if secs < 0:
        return ""
    return f" after {secs} s" if secs < 90 else f" after {round(secs / 60)} min"


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
    level = reading.level_pct
    sensor_ok = level is not None

    prev_level = device.get("last_level_pct")
    prev_pump = device.get("last_pump_on")
    prev_locked = bool(device.get("last_locked"))
    prev_sensor_ok = device.get("last_sensor_ok") is not False
    last_seen = parse_ts(device.get("last_seen"))
    last_stored = parse_ts(device.get("last_stored_at"))
    gap = (now - last_seen).total_seconds() if last_seen else None

    events = []

    def add_event(kind: str, detail: str) -> None:
        events.append(
            {
                "device_id": device_id,
                "kind": kind,
                "detail": detail,
                "level_pct": round(level, 1) if level is not None else None,
            }
        )

    expire_stale_commands(device_id, now)

    if reading.cmd_id is not None and reading.cmd_status in ("done", "failed"):
        cmd_res = (
            client.table("commands")
            .select("*")
            .eq("id", reading.cmd_id)
            .eq("device_id", device_id)
            .eq("status", "sent")
            .limit(1)
            .execute()
        )
        if cmd_res.data:
            cmd = cmd_res.data[0]
            note = (reading.cmd_note or "").strip()[:120]
            client.table("commands").update(
                {"status": reading.cmd_status, "finished_at": now.isoformat(), "note": note}
            ).eq("id", cmd["id"]).execute()
            verb = "start" if cmd["action"] == "pump_on" else "stop"
            if reading.cmd_status == "done":
                add_event("command_done", f"Pump {verb} command from the app was confirmed by the device.")
            else:
                add_event("command_failed", f"Pump {verb} command from the app failed: {note or 'no reason given'}.")

    if last_seen is None:
        add_event("device_online", "First data received from this device.")
    elif gap is not None and gap > settings["offline_after_s"]:
        add_event("device_online", "Device is back online.")

    at_level = f" at {level:.0f}% level" if level is not None else ""
    if prev_pump is not None and prev_pump != reading.pump_on:
        if reading.pump_on:
            add_event("pump_started", f"Pump started{at_level}.")
        else:
            add_event("pump_stopped", f"Pump stopped{at_level}{pump_run_text(device_id, now)}.")

    if reading.locked and not prev_locked:
        add_event("pump_locked", "Safety timer stopped the pump. Check the water source and the pump.")

    if prev_sensor_ok and not sensor_ok:
        add_event("sensor_error", "The level sensor gave no valid reading. The pump is kept off until it recovers.")

    if level is not None:
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

    should_store = level is not None and (
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
        "last_pump_on": reading.pump_on,
        "last_locked": reading.locked,
        "last_sensor_ok": sensor_ok,
    }
    if level is not None:
        update.update(
            {
                "last_level_pct": level,
                "last_distance_cm": reading.distance_cm,
                "last_water_cm": reading.water_cm,
                "last_volume_ml": reading.volume_ml,
            }
        )
    if should_store:
        update["last_stored_at"] = now.isoformat()
    client.table("devices").update(update).eq("device_id", device_id).execute()

    # Hand the oldest waiting command to the device.
    command = None
    waiting = (
        client.table("commands")
        .select("id,action")
        .eq("device_id", device_id)
        .eq("status", "pending")
        .order("created_at")
        .limit(1)
        .execute()
        .data
        or []
    )
    if waiting:
        claimed = (
            client.table("commands")
            .update({"status": "sent", "sent_at": now.isoformat()})
            .eq("id", waiting[0]["id"])
            .eq("status", "pending")
            .execute()
            .data
        )
        if claimed:
            command = {"id": waiting[0]["id"], "action": waiting[0]["action"], "max_seconds": MANUAL_MAX_SECONDS}

    return {
        "ok": True,
        "stored": should_store,
        "command": command,
        "config": {
            "start_pct": float(settings.get("start_pct", 25)),
            "stop_pct": float(settings.get("stop_pct", 100)),
        },
    }


# ---------------------------------------------------------------- devices (account side)

@app.get("/api/devices")
def list_devices(user_id: str = Depends(current_user)):
    client = db()
    members = client.table("device_members").select("device_id,role").eq("user_id", user_id).execute().data or []
    roles = {m["device_id"]: m["role"] for m in members}
    if not roles:
        return {"devices": []}
    ids = list(roles.keys())
    devices = client.table("devices").select("*").in_("device_id", ids).order("created_at").execute().data or []
    settings = client.table("device_settings").select("*").in_("device_id", ids).execute().data or []
    by_id = {s["device_id"]: s for s in settings}
    return {"devices": [device_view(d, by_id.get(d["device_id"], {}), roles.get(d["device_id"])) for d in devices]}


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

    client.table("devices").insert(
        {"device_id": device_id, "key_hash": hash_key(key), "name": body.name.strip(), "created_by": user_id}
    ).execute()
    try:
        client.table("device_members").insert({"device_id": device_id, "user_id": user_id, "role": "owner"}).execute()
        client.table("device_settings").insert({"device_id": device_id}).execute()
    except Exception:
        client.table("devices").delete().eq("device_id", device_id).execute()
        raise

    view = device_view(get_device_row(device_id), get_settings_row(device_id), "owner")
    # The key is returned only once. Only its hash is stored.
    return {"device": view, "device_key": key}


@app.delete("/api/devices/{device_id}")
def remove_device(device_id: str, user_id: str = Depends(current_user)):
    """Removes this device from the signed-in account. If nobody else uses it, it is deleted.
    If the owner leaves while others remain, the longest-standing member becomes the owner."""
    client = db()
    role = require_member(device_id, user_id)
    client.table("device_members").delete().eq("device_id", device_id).eq("user_id", user_id).execute()
    left = (
        client.table("device_members")
        .select("user_id,role,created_at")
        .eq("device_id", device_id)
        .order("created_at")
        .execute()
        .data
        or []
    )
    if not left:
        client.table("devices").delete().eq("device_id", device_id).execute()
    elif role == "owner" and not any(m["role"] == "owner" for m in left):
        client.table("device_members").update({"role": "owner"}).eq("device_id", device_id).eq(
            "user_id", left[0]["user_id"]
        ).execute()
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
    role = require_member(device_id, user_id)
    return {"device": device_view(get_device_row(device_id), get_settings_row(device_id), role)}


@app.put("/api/devices/{device_id}/settings")
def update_settings(device_id: str, body: SettingsIn, user_id: str = Depends(current_user)):
    client = db()
    require_owner(device_id, user_id)
    if body.start_pct + 10 > body.stop_pct:
        raise HTTPException(status_code=422, detail="The start level must be at least 10% lower than the stop level.")
    client.table("devices").update({"name": body.name.strip()}).eq("device_id", device_id).execute()
    client.table("device_settings").upsert(
        {
            "device_id": device_id,
            "capacity_litres": body.capacity_litres,
            "low_alert_pct": body.low_alert_pct,
            "offline_after_s": body.offline_after_s,
            "start_pct": body.start_pct,
            "stop_pct": body.stop_pct,
        },
        on_conflict="device_id",
    ).execute()
    return {"device": device_view(get_device_row(device_id), get_settings_row(device_id), "owner")}


# ---------------------------------------------------------------- sharing

@app.post("/api/devices/{device_id}/invites", status_code=201)
def create_invite(device_id: str, user_id: str = Depends(current_user)):
    """One-time code that lets another account join this device. Shown once, valid for 24 hours."""
    client = db()
    require_owner(device_id, user_id)
    code = random_code(2)
    expires = utcnow() + timedelta(hours=INVITE_TTL_HOURS)
    client.table("device_invites").insert(
        {
            "code_hash": hash_key(code),
            "device_id": device_id,
            "created_by": user_id,
            "expires_at": expires.isoformat(),
        }
    ).execute()
    return {"code": code, "expires_at": expires.isoformat()}


@app.post("/api/invites/redeem")
def redeem_invite(body: RedeemIn, user_id: str = Depends(current_user)):
    client = db()
    code = body.code.strip().upper()
    code_hash = hash_key(code)
    res = (
        client.table("device_invites")
        .select("*")
        .eq("code_hash", code_hash)
        .is_("used_at", "null")
        .gt("expires_at", utcnow().isoformat())
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="That code is not valid or has expired.")
    device_id = res.data[0]["device_id"]

    existing = member_role(device_id, user_id)
    if existing is not None:
        # Already on this device. Keep the role and keep the code unused.
        return {"device": device_view(get_device_row(device_id), get_settings_row(device_id), existing)}

    claimed = (
        client.table("device_invites")
        .update({"used_at": utcnow().isoformat(), "used_by": user_id})
        .eq("code_hash", code_hash)
        .is_("used_at", "null")
        .execute()
        .data
    )
    if not claimed:
        raise HTTPException(status_code=404, detail="That code is not valid or has expired.")

    client.table("device_members").insert({"device_id": device_id, "user_id": user_id, "role": "member"}).execute()
    return {"device": device_view(get_device_row(device_id), get_settings_row(device_id), "member")}


def email_of(user_id: str) -> str:
    try:
        res = db().auth.admin.get_user_by_id(user_id)
        return (res.user.email or "") if res and res.user else ""
    except Exception:
        return ""


@app.get("/api/devices/{device_id}/members")
def list_members(device_id: str, user_id: str = Depends(current_user)):
    require_member(device_id, user_id)
    rows = (
        db()
        .table("device_members")
        .select("user_id,role,created_at")
        .eq("device_id", device_id)
        .order("created_at")
        .execute()
        .data
        or []
    )
    return {
        "members": [
            {
                "user_id": r["user_id"],
                "email": email_of(r["user_id"]),
                "role": r["role"],
                "is_me": r["user_id"] == user_id,
            }
            for r in rows
        ]
    }


@app.delete("/api/devices/{device_id}/members/{member_id}")
def remove_member(device_id: str, member_id: str, user_id: str = Depends(current_user)):
    require_owner(device_id, user_id)
    if member_id == user_id:
        raise HTTPException(status_code=400, detail="Use Remove on your device list to leave a device.")
    role = member_role(device_id, member_id)
    if role is None:
        raise HTTPException(status_code=404, detail="That person is not on this device.")
    if role == "owner":
        raise HTTPException(status_code=400, detail="An owner cannot be removed.")
    db().table("device_members").delete().eq("device_id", device_id).eq("user_id", member_id).execute()
    return {"ok": True}


# ---------------------------------------------------------------- pump commands

@app.post("/api/devices/{device_id}/commands", status_code=201)
def send_command(device_id: str, body: CommandIn, user_id: str = Depends(current_user)):
    client = db()
    require_member(device_id, user_id)
    device = get_device_row(device_id)
    now = utcnow()
    expire_stale_commands(device_id, now)

    seen = parse_ts(device.get("last_seen"))
    if seen is None or (now - seen).total_seconds() > COMMAND_MAX_SILENCE_S:
        raise HTTPException(status_code=409, detail="The device is offline, so the command was not sent.")

    busy = (
        client.table("commands")
        .select("id")
        .eq("device_id", device_id)
        .in_("status", ["pending", "sent"])
        .limit(1)
        .execute()
    )
    if busy.data:
        raise HTTPException(status_code=409, detail="Another command is still waiting for the device. Try again in a moment.")

    pump_on = bool(device.get("last_pump_on"))
    locked = bool(device.get("last_locked"))
    level = device.get("last_level_pct")

    if body.action == "pump_on":
        if device.get("last_sensor_ok") is False:
            raise HTTPException(status_code=409, detail="The level sensor has an error, so the pump cannot be started from the app.")
        if locked:
            raise HTTPException(status_code=409, detail="The safety timer stopped the pump. Check the water source, then press Stop to clear the lock.")
        if pump_on:
            raise HTTPException(status_code=409, detail="The pump is already running.")
        if level is not None and level >= FULL_BLOCK_PCT:
            raise HTTPException(status_code=409, detail="The tank is already full.")
    else:
        if not pump_on and not locked:
            raise HTTPException(status_code=409, detail="The pump is already off.")

    row = (
        client.table("commands")
        .insert({"device_id": device_id, "action": body.action, "requested_by": user_id})
        .execute()
        .data[0]
    )
    return {"command": command_view(row, user_id)}


@app.get("/api/devices/{device_id}/commands")
def list_commands(
    device_id: str,
    limit: int = Query(default=10, ge=1, le=50),
    user_id: str = Depends(current_user),
):
    require_member(device_id, user_id)
    expire_stale_commands(device_id, utcnow())
    rows = (
        db()
        .table("commands")
        .select("id,action,status,note,created_at,finished_at,requested_by")
        .eq("device_id", device_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )
    return {"commands": [command_view(r, user_id) for r in rows]}


# ---------------------------------------------------------------- history and analytics

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


def latest_event_time(device_id: str, kind: str) -> Optional[str]:
    res = (
        db()
        .table("events")
        .select("created_at")
        .eq("device_id", device_id)
        .eq("kind", kind)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0]["created_at"] if res.data else None


@app.get("/api/devices/{device_id}/summary")
def get_summary(
    device_id: str,
    tz_offset_minutes: int = Query(default=0, ge=-840, le=840),
    user_id: str = Depends(current_user),
):
    require_member(device_id, user_id)
    today = get_analytics(device_id, days=1, tz_offset_minutes=tz_offset_minutes, user_id=user_id)
    return {
        "last_fill_started": latest_event_time(device_id, "pump_started"),
        "last_fill_ended": latest_event_time(device_id, "pump_stopped"),
        "last_low_level": latest_event_time(device_id, "low_level"),
        "pump_minutes_today": today["days"][0]["pump_minutes"] if today["days"] else 0,
    }


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
