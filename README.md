# Smart Strangle Virtual SL Engine — Delta Exchange India & Telegram Bot

A Node.js / JavaScript engine tailored for **Delta Exchange India** that detects your active options **Strangle** (Short Call + Short Put), calculates the total collected credit / **Max Profit ($10)**, and dynamically sets and manages a **Virtual Combined Stop-Loss (-$10)** across both legs.

Includes real-time **Telegram Bot notifications** and **1-tap interactive buttons** (referenced from the `funding` bot architecture).

---

## 🎯 Key Features

1. **Delta Exchange India Native**:
   - Uses Delta Exchange India API (`https://api.india.delta.exchange`).
   - Authenticates via HMAC-SHA256 with automatic server clock drift synchronization.
   - Concurrently executes market close for both legs upon trigger to prevent slippage.

2. **Dynamic Combined Stop-Loss**:
   - Calculates max profit from the up-and-running Strangle ($6 CE + $4 PE = $10 Max Profit).
   - Automatically sets Virtual Combined SL to **-$10.00** (1:1 Risk/Reward ratio).
   - Monitors aggregate Mark-to-Market P&L across both legs.

3. **Trailing SL Removed**:
   - Trailing SL logic has been completely removed to keep execution clean and strictly bound to the initial risk-to-reward ratio.

4. **Telegram Bot with Interactive Buttons**:
   - **`🚨 Emergency Square Off`**: 1-tap button to immediately close both legs on Delta India.
   - **`📊 Live Status`**: Shows Call LTP, Put LTP, current Combined PnL, and distance to SL.
   - **`💰 Current PnL`**: Displays current profit/loss summary.
   - Sends instant alerts when Virtual SL is breached or Target Profit is achieved.

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

## 🚀 How to Run

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run the engine**:
   ```bash
   node index.js
   ```

3. **Telegram Commands & Buttons**:
   - `🚨 Emergency Square Off` / `/flatten` : Instantly closes both legs.
   - `📊 Live Status` / `/status` : Displays current prices, PnL, and SL buffer.
   - `💰 Current PnL` / `/pnl` : Shows current PnL.
