"""UPI Soundbox Simulator - backend.

In-memory only (no database): a simulator doesn't need persistence.

Flow:
  Simulator page  --WebSocket /ws/{device_id}-->  backend
  Customer: scan QR -> POST /api/pay/initiate -> enter PIN -> POST /api/pay/confirm
  confirm (success) --push {payment + ad}--> every socket of that device -> soundbox speaks
"""
import random
import re
import time
import uuid
from typing import Optional

from fastapi import FastAPI, HTTPException, Path, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DEVICE_PATTERN = r"^[A-Za-z0-9-]{4,64}$"
PIN_PATTERN = r"^\d{4,6}$"
MAX_AMOUNT = 100_000
MAX_PIN_ATTEMPTS = 3
WRONG_PIN = "0000"  # demo: this PIN simulates "incorrect UPI PIN"; any other 4-6 digits succeeds

MERCHANT_NAME = "Soundbox Store"
DEMO_BANK = "Demo Bank ••4321"

# Advertisements the soundbox speaks right after the payment announcement.
ADS = [
    {
        "id": "vim",
        "en": "This store also sells Vim bar at 10 rupees.",
        "hi": "इस दुकान पर विम बार भी मिलता है, सिर्फ़ 10 रुपये में।",
    },
    {
        "id": "pepsi",
        "en": "Pepsi Black is available here.",
        "hi": "पेप्सी ब्लैक यहाँ उपलब्ध है।",
    },
    {
        "id": "kitkat",
        "en": "Did you have a Kit Kat today?",
        "hi": "क्या आपने आज किटकैट खाया?",
    },
    {
        "id": "yummiez",
        "en": "Try Yummiez green peas.",
        "hi": "यम्मीज़ ग्रीन पीज़ ज़रूर आज़माएँ।",
    },
    {
        "id": "amul",
        "en": "Amul kulfi is available here.",
        "hi": "अमूल कुल्फी यहाँ उपलब्ध है।",
    },
]

app = FastAPI(title="Soundbox Simulator API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # simulator only; restrict this if you deploy for real
    allow_methods=["*"],
    allow_headers=["*"],
)

# device_id -> open WebSocket connections (a set, so reloads / extra tabs still work)
devices: dict[str, set[WebSocket]] = {}
# token -> {"device_id": str, "amount": float}   (dynamic QRs only)
dynamic_qrs: dict[str, dict] = {}
# payment_id -> payment record (dummy payment session)
payments: dict[str, dict] = {}
# device_id -> id of the last ad played, so the same ad isn't repeated back to back
last_ad: dict[str, str] = {}


# ---------- models ----------
class DynamicQrIn(BaseModel):
    device_id: str = Field(pattern=DEVICE_PATTERN)
    amount: float = Field(gt=0, le=MAX_AMOUNT)


class InitiateIn(BaseModel):
    token: str
    amount: Optional[float] = Field(default=None, gt=0, le=MAX_AMOUNT)
    lang: Optional[str] = "en"


class ConfirmIn(BaseModel):
    payment_id: str
    pin: str
    lang: Optional[str] = None


# ---------- helpers ----------
def resolve(token: str) -> Optional[dict]:
    """Static tokens are 's_<device_id>' so they survive backend restarts."""
    if token.startswith("s_"):
        device_id = token[2:]
        if re.match(DEVICE_PATTERN, device_id):
            return {"device_id": device_id, "amount": None, "kind": "static"}
        return None
    qr = dynamic_qrs.get(token)
    return {**qr, "kind": "dynamic"} if qr else None


def pick_ad(device_id: str) -> dict:
    choices = [a for a in ADS if a["id"] != last_ad.get(device_id)] or ADS
    ad = random.choice(choices)
    last_ad[device_id] = ad["id"]
    return ad


async def broadcast(device_id: str, message: dict) -> int:
    """Send to every socket of a device; drop dead ones. Returns delivered count."""
    delivered = 0
    for ws in list(devices.get(device_id, ())):
        try:
            await ws.send_json(message)
            delivered += 1
        except Exception:
            devices[device_id].discard(ws)
    return delivered


# ---------- routes ----------
@app.get("/api/health")
def health():
    return {"ok": True, "devices_online": sum(1 for s in devices.values() if s)}


@app.get("/api/ads")
def list_ads():
    return ADS


@app.get("/api/qr/static/{device_id}")
def static_qr(device_id: str = Path(pattern=DEVICE_PATTERN)):
    return {"token": f"s_{device_id}"}


@app.post("/api/qr/dynamic")
def dynamic_qr(body: DynamicQrIn):
    token = "d_" + uuid.uuid4().hex[:10]
    dynamic_qrs[token] = {"device_id": body.device_id, "amount": round(body.amount, 2)}
    return {"token": token, "amount": dynamic_qrs[token]["amount"]}


@app.get("/api/qr/{token}")
def get_qr(token: str):
    qr = resolve(token)
    if not qr:
        raise HTTPException(404, "Invalid or expired QR")
    return {
        "kind": qr["kind"],
        "amount": qr["amount"],  # null for static -> customer types the amount
        "device_online": bool(devices.get(qr["device_id"])),
        "merchant": MERCHANT_NAME,
    }


@app.post("/api/pay/initiate")
def pay_initiate(body: InitiateIn):
    """Step 1 (dummy UPI): create a pending payment for a scanned QR."""
    qr = resolve(body.token)
    if not qr:
        raise HTTPException(404, "Invalid or expired QR")

    # dynamic QR: the amount is locked server-side, ignore whatever the client sent
    amount = qr["amount"] if qr["amount"] is not None else body.amount
    if amount is None:
        raise HTTPException(422, "Amount is required for a static QR")

    payment_id = "PAY" + uuid.uuid4().hex[:8].upper()
    payments[payment_id] = {
        "device_id": qr["device_id"],
        "amount": round(float(amount), 2),
        "status": "pending",
        "attempts": 0,
        "lang": body.lang if body.lang in ("hi", "en") else "en",
    }
    return {
        "payment_id": payment_id,
        "amount": payments[payment_id]["amount"],
        "merchant": MERCHANT_NAME,
        "bank": DEMO_BANK,
        "device_online": bool(devices.get(qr["device_id"])),
    }


@app.post("/api/pay/confirm")
async def pay_confirm(body: ConfirmIn):
    """Step 2 (dummy UPI): verify the PIN, then push the payment + an ad to the soundbox."""
    p = payments.get(body.payment_id)
    if not p:
        raise HTTPException(404, "Payment not found. Please scan again.")

    if p["status"] == "success":  # idempotent: a double-click must not announce twice
        return p["result"]
    if p["status"] == "failed":
        raise HTTPException(409, "Payment failed. Please scan the QR again.")

    if not re.match(PIN_PATTERN, body.pin):
        raise HTTPException(422, "UPI PIN must be 4 to 6 digits")

    if body.pin == WRONG_PIN:
        p["attempts"] += 1
        left = MAX_PIN_ATTEMPTS - p["attempts"]
        if left <= 0:
            p["status"] = "failed"
            raise HTTPException(402, "Too many wrong PIN attempts. Payment cancelled.")
        raise HTTPException(402, f"Incorrect UPI PIN. {left} attempt{'s' if left != 1 else ''} left.")

    lang = body.lang if body.lang in ("hi", "en") else p.get("lang", "en")
    ad = pick_ad(p["device_id"])
    payment = {
        "type": "payment",
        "txn_id": "TXN" + uuid.uuid4().hex[:8].upper(),
        "amount": p["amount"],
        "ts": int(time.time() * 1000),
        "ad": ad,
        "lang": lang,
    }
    delivered = await broadcast(p["device_id"], payment)
    p["status"] = "success"
    p["result"] = {"status": "success", "announced": delivered > 0, **payment}
    return p["result"]


@app.websocket("/ws/{device_id}")
async def ws_endpoint(ws: WebSocket, device_id: str):
    if not re.match(DEVICE_PATTERN, device_id):
        await ws.close(code=1008)
        return
    await ws.accept()
    devices.setdefault(device_id, set()).add(ws)
    await ws.send_json({"type": "connected"})
    try:
        while True:
            if await ws.receive_text() == "ping":  # client keep-alive
                await ws.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        devices.get(device_id, set()).discard(ws)
