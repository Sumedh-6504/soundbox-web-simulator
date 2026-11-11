# UPI Soundbox Simulator

Web simulator of a UPI soundbox.

- `/simulator` is the soundbox: Hindi/English toggle, Static QR, Front panel (Dynamic QR), Back keypad, Listen button.
- `/scan` is the customer's QR scanner. It shows the scanned URL, then goes to the Pay page.
- `/pay?token=…` is the dummy UPI payment: amount, UPI PIN keypad, processing, success screen with voice.
  After success the soundbox says "Received X rupees" and then a store advertisement.

```
Simulator ──WebSocket──┐
                       ▼
Scan → Pay page → POST /api/pay/initiate → enter PIN → POST /api/pay/confirm
                                              └→ push {payment + ad} → soundbox speaks both
```

## Payment flow (dummy UPI)

1. Customer scans a QR and lands on `/pay`. A static QR asks for the amount, a dynamic QR has it locked.
2. **Proceed** creates a pending payment, then the customer enters a UPI PIN (4–6 digits, on-screen keypad).
3. Any 4–6 digit PIN succeeds. **`0000` simulates a wrong PIN**: 3 wrong tries cancel the payment.
4. On success the customer's phone says *"Payment of 50 rupees successful"* (Hindi/English toggle on the Pay page).
5. The soundbox says *"Received 50 rupees"* and, once that finishes, an advertisement.
   Ads: Vim bar at ₹10, Pepsi Black, Kit Kat, Yummiez green peas, Amul kulfi. The same ad never plays twice in a row.
   Edit the `ADS` list in `backend/main.py` to change them. Use the **Ads** checkbox on the soundbox to switch them off.
6. **Listen** on the soundbox replays the last announcement and its ad.

## Run it

**Backend** (terminal 1)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend** (terminal 2)
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000/simulator and click **Start soundbox** (browsers need one click before sound).

## Test the full loop

**On one laptop**
1. Open `/simulator` in one tab and `/scan` in another.
2. In `/scan`, paste the link shown under the Static QR and press *Use this link*, then *Continue to pay*.
3. Enter an amount, then a PIN such as `1234`. The simulator tab announces the amount and the ad. Press **Listen** to replay.

**With a phone** (same Wi-Fi)
1. Find your laptop's LAN IP (e.g. `192.168.1.20`). Open `http://192.168.1.20:3000/simulator` on the laptop. This matters because the QR codes embed the address you opened.
2. Scan the QR with the phone's **normal camera app**. It opens the Pay page and works over plain HTTP.
3. The in-app `/scan` camera needs HTTPS on phones. Use the paste box, or deploy (below).

**Dynamic QR:** type an amount on the keypad, press **OK**, scan the front-panel QR. The amount is locked server-side.

## Notes

- Hindi speech needs a Hindi voice. Chrome on Android has one. On desktop, install a Hindi voice in the OS speech settings. A warning appears if none is found.
- State is in memory, so restarting the backend clears dynamic QRs. Static QRs survive restarts.
- API: `GET /api/qr/static/{device_id}`, `POST /api/qr/dynamic`, `GET /api/qr/{token}`, `POST /api/pay/initiate`, `POST /api/pay/confirm`, `GET /api/ads`, `WS /ws/{device_id}`, `GET /api/health`.
- The PIN is never stored. This is a simulator only: no real money, no real bank.

## Deploy (optional)

- Backend on Render: start command `uvicorn main:app --host 0.0.0.0 --port $PORT`.
- Frontend on Vercel: set `NEXT_PUBLIC_API_URL=https://<your-backend>`. HTTPS means the in-app camera works on phones, and the WebSocket automatically uses `wss://`.
- Restrict `allow_origins` in `backend/main.py` to your frontend URL.
