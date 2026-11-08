# Delta Exchange India Stop-Loss Monitor & Telegram Bot

A Node.js service that monitors your **Delta Exchange India** account on a **1-minute interval**, calculates your **overall portfolio P&L** across open positions, and sends **5 repeated Telegram alerts at 10-minute intervals** whenever your portfolio loss reaches your Stop-Loss threshold.

Includes live **`⚙️ sl_set` button** handling on Telegram to adjust your Stop-Loss on the fly.

---

## 🎯 How It Works

1. **1-Minute Portfolio Checks (Delta Exchange India)**:
   - Queries `GET /v2/positions/margined` every 60 seconds (`POLL_INTERVAL_MS=60000`).
   - Sums the unrealized P&L across all active open positions to determine your **overall portfolio loss/gain**.

2. **Telegram Stop-Loss (`⚙️ sl_set` Button)**:
   - Initial Stop-Loss is loaded from `.env` (`DEFAULT_SL_AMOUNT=10` => **-$10.00**).
   - Tapping **`⚙️ sl_set`** in Telegram allows you to change your Stop-Loss anytime via presets (`-$5`, `-$10`, `-$15`, `-$20`, `-$25`, `-$30`) or by replying with any custom number.

3. **5-Alert Sequence (10-Minute Intervals)**:
   - When overall portfolio loss reaches your Stop-Loss (e.g. portfolio running at **-$10.00**):
     - **Alert 1 of 5**: Dispatched **immediately** to Telegram.
     - **Alerts 2 to 5**: Dispatched **every 10 minutes** (`SL_ALERT_INTERVAL_MINUTES=10`) as long as the portfolio remains in breach.
     - **Stops at 5 Alerts**: Prevents continuous chat spam (`SL_MAX_ALERTS=5`).
   - If the portfolio recovers back above the Stop-Loss, the alert sequence pauses and a recovery notification is sent.

4. **Action Buttons Inside Each Alert**:
   - **`🚨 Emergency Square Off`**: 1-tap exit to close open positions on Delta India.
   - **`🔕 Silence Alerts`**: Mutes remaining alerts for the current breach.
   - **`⚙️ Change SL (sl_set)`**: Modify or widen your Stop-Loss directly from the alert.
   - **`🔄 Reset Alerts`**: Clears the alert counter.

---

## 📁 Project Structure

```
.
├── .env                  # Delta India credentials & alert settings
├── .env.example          # Environment template
├── deltaAuth.js          # Delta India HMAC-SHA256 request signing & clock drift sync
├── deltaClient.js        # Delta India REST client (Portfolio PnL & Emergency Close)
├── slMonitor.js          # 1-minute checker & 5-alert sequence manager
├── telegram.js           # Telegram bot (buttons, long-polling & alerts)
├── index.js              # Application entry point
├── deploy.sh             # VPS deployment script (systemd setup)
├── strangle-sl.service   # Linux systemd unit file
└── .github/workflows/
    └── deploy.yml        # CI/CD deployment via GitHub Actions (appleboy/ssh-action)
```

---

## ⚙️ Configuration (`.env.example`)

```env
# ============================================================================
#  DELTA EXCHANGE INDIA STOP-LOSS MONITOR & TELEGRAM BOT (LIVE EXECUTION)
# ============================================================================

# --- 1. Delta Exchange India API Credentials ---
DELTA_API_KEY=your_delta_india_api_key_here
DELTA_API_SECRET=your_delta_india_api_secret_here
DELTA_BASE_URL=https://api.india.delta.exchange

# --- 2. Portfolio Check & Stop-Loss Settings ---
# Checks Delta India portfolio every 1 minute (60000 ms)
POLL_INTERVAL_MS=60000

# Default Stop-Loss in $ (e.g. 10 = -$10.00 loss threshold). Can be changed live via 'sl_set' button!
DEFAULT_SL_AMOUNT=10

# Minutes between repeated alerts when Stop-Loss is reached
SL_ALERT_INTERVAL_MINUTES=10

# Total alerts to send (5 alerts = Alert 1 immediate, then every 10m up to 5 alerts)
SL_MAX_ALERTS=5

# Execution Mode:
# true  = Simulation mode with mock prices (safe to test)
# false = Live portfolio tracking with real Delta Exchange India API
DRY_RUN=true

# --- 3. Telegram Bot Settings ---
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_from_botfather
TELEGRAM_CHAT_ID=your_telegram_chat_id
TELEGRAM_ENABLED=true
```

---

## 🚀 How to Run

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the engine**:
   ```bash
   node index.js
   ```

3. **Telegram Commands & Buttons**:
   - `⚙️ sl_set` : Open quick presets to update Stop-Loss.
   - `🚨 Emergency Square Off` : Close all active positions on Delta India.
   - `📊 Live Status` : View current portfolio PnL, positions, SL level, and alert sequence status.
   - `🔄 Reset Alerts` : Reset alert sequence counter.

---

## 🚀 VPS Deployment & GitHub Actions (CI/CD)

Referenced directly from the `funding` bot deployment architecture.

### 1. GitHub Actions Secrets (Repo Settings)
Go to your GitHub repository **Settings -> Secrets and variables -> Actions** and add:

| Secret Name | Description | Example |
|---|---|---|
| `VM_HOST` | Public IP or domain of your remote Linux VPS | `159.65.123.45` |
| `VM_USER` | SSH Username on the VPS | `root` or `ubuntu` |
| `VM_PORT` | SSH Port | `22` |
| `VM_SSH_KEY` | Private SSH key (`id_rsa` or `id_ed25519`) | `-----BEGIN OPENSSH PRIVATE KEY...` |

### 2. Automated GitHub Actions Deploy ([`.github/workflows/deploy.yml`](file:///c:/Users/yashp/Desktop/SL/.github/workflows/deploy.yml))
Whenever code is pushed to `main` or `master`:
1. Validates the required VM SSH credentials.
2. Connects to your VPS via SSH (`appleboy/ssh-action@v1`).
3. Executes [`deploy.sh`](file:///c:/Users/yashp/Desktop/SL/deploy.sh), installs dependencies, and restarts the `strangle-sl` systemd service.

### 3. Server Systemd Management
- **Manual deploy**:
  ```bash
  chmod +x deploy.sh
  ./deploy.sh
  ```
- **Check service status**:
  ```bash
  systemctl status strangle-sl
  ```
- **Stream live logs**:
  ```bash
  journalctl -u strangle-sl -f
  ```
- **Restart service**:
  ```bash
  systemctl restart strangle-sl
  ```
