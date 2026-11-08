# Smart Strangle Virtual SL Engine — Delta Exchange India & Telegram Bot

A Node.js / JavaScript engine tailored for **Delta Exchange India** that detects your active options **Strangle** (Short Call + Short Put), calculates the total collected credit / **Max Profit ($10)**, and dynamically sets and manages a **Virtual Combined Stop-Loss (-$10)** across both legs.

Includes real-time **Telegram Bot notifications** and **1-tap interactive buttons** (referenced from the `funding` bot architecture).

---

## 🎯 Key Features

1. **Delta Exchange India Native**:
   - Uses Delta Exchange India API (`https://api.india.delta.exchange`).
   - Authenticates via HMAC-SHA256 with automatic server clock drift synchronization.
   - Concurrently executes market close for both legs upon trigger to prevent slippage.

2. **Dynamic Combined Stop-Loss & Telegram `sl_set` Button**:
   - Automatically initializes Virtual Combined SL from the running Strangle (e.g. $10 Max Profit => -$10 SL).
   - **`⚙️ sl_set` Button**: Tap anytime on Telegram to change your Stop-Loss on the fly (via quick presets `-$5`, `-$10`, `-$15`, `-$20`, or typing any custom amount).

3. **5-Alert Sequence at 10-Minute Intervals**:
   - When overall strangle loss reaches your SL threshold:
     - **Alert 1 of 5**: Sent immediately upon breach.
     - **Alerts 2 to 5**: Sent every 10 minutes (configurable via `SL_ALERT_INTERVAL_MINUTES=10`).
   - Each alert includes:
     - Current Net PnL and breached SL level.
     - Individual Call & Put prices.
     - **`🚨 Emergency Square Off`**: 1-tap exit on Delta Exchange India.
     - **`🔕 Silence Alerts`**: Mutes remaining alerts for the current breach.
   - If PnL recovers above the SL, alerts pause and the bot sends a recovery notification.

4. **Trailing SL Removed**:
   - Trailing SL logic has been completely removed to keep execution clean and strictly bound to the user-defined Stop-Loss.

---

## 📁 Project Structure

```
.
├── .env                  # Active credentials and settings
├── .env.example          # Environment template
├── deltaAuth.js          # Delta India HMAC-SHA256 signer & time offset sync
├── deltaClient.js        # Delta Exchange India REST API client (Positions, Tickers, Close)
├── telegram.js           # Telegram Bot notification & interactive button commander
├── smartStrangleSL.js    # Core Virtual SL monitoring engine
├── index.js              # Application entry point
├── package.json          # Dependencies (axios, dotenv)
└── README.md             # Documentation
```

---

## ⚙️ Configuration (`.env.example`)

```env
# ============================================================================
#  SMART STRANGLE SL ENGINE - DELTA EXCHANGE INDIA + TELEGRAM BOT
# ============================================================================

# --- 1. Delta Exchange India API Credentials ---
DELTA_API_KEY=your_delta_india_api_key_here
DELTA_API_SECRET=your_delta_india_api_secret_here
DELTA_BASE_URL=https://api.india.delta.exchange

# --- 2. Dynamic SL & TP (Calculated from Up & Running Strangle) ---
AUTO_CALCULATE_SL=true
SL_RATIO_OF_MAX_PROFIT=1.0    # 1.0 = 100% of Max Profit ($10 Max Profit -> $10 Stop Loss)
AUTO_CALCULATE_TP=true        # Target profit matches collected credit (+$10)

# Fallback values if AUTO_CALCULATE_SL=false
COMBINED_SL_AMOUNT=10
COMBINED_TARGET_PROFIT=10

# --- 3. Telegram Bot Notifications & Interactive Buttons ---
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_from_botfather
TELEGRAM_CHAT_ID=your_telegram_chat_id
TELEGRAM_ENABLED=true

# --- 4. Monitor & Execution Mode ---
POLL_INTERVAL_MS=1000
DRY_RUN=false                 # Set false for live trading on Delta India

# Strangle Option Symbols (Optional - auto-detects short CE & PE if omitted)
CALL_SYMBOL=C-BTC-90000-280226
PUT_SYMBOL=P-BTC-80000-280226
```

---

## 🚀 Deployment & Continuous Integration (VPS)

Referenced directly from the `funding` bot deployment architecture.

### 1. GitHub Actions Secrets (Repo Settings)
Go to your GitHub repository **Settings -> Secrets and variables -> Actions** and add:

| Secret Name | Description | Example |
|---|---|---|
| `VM_HOST` | Public IP or domain of your remote Linux VPS | `159.65.123.45` |
| `VM_USER` | SSH Username on the VPS | `root` or `ubuntu` |
| `VM_PORT` | SSH Port | `22` |
| `VM_SSH_KEY` | Private SSH key (id_rsa or id_ed25519) | `-----BEGIN OPENSSH PRIVATE KEY...` |

### 2. Automated GitHub Actions Deploy ([`.github/workflows/deploy.yml`](file:///c:/Users/yashp/Desktop/SL/.github/workflows/deploy.yml))
Whenever code is pushed to `main` or `master`:
1. Validates the required VM SSH credentials.
2. Connects to your VPS via SSH (`appleboy/ssh-action@v1`).
3. Executes [`deploy.sh`](file:///c:/Users/yashp/Desktop/SL/deploy.sh), which installs dependencies and restarts the `strangle-sl` systemd service.

### 3. Manual Server Commands
- **Run deployment manually**:
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
- **Restart or Stop**:
  ```bash
  systemctl restart strangle-sl
  systemctl stop strangle-sl
  ```
