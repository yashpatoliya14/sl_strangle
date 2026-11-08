# Smart Strangle Combined Stop-Loss (SL) Engine

A Node.js / JavaScript engine that monitors an active options **Strangle** (Short Call + Short Put), tracks total net Mark-to-Market (MTM) P&L in real time, and executes a **Virtual Combined Stop-Loss (SL)** or **Target Profit (TP)** across both legs.

---

## 🎯 Why a "Virtual Combined SL"?

When trading a Short Strangle (selling both an OTM Call and an OTM Put):
- **Traditional Individual Leg SLs** often get stopped out prematurely: If the underlying market moves up, the Call leg spikes and hits its individual SL, while the Put leg decays to almost zero. In many cases, the combined position is still profitable or at minimal loss!
- **Virtual Combined SL** monitors the **aggregate net P&L** across both legs:
  $$\text{Net PnL} = (\text{Call PnL}) + (\text{Put PnL})$$
- When the net loss reaches your threshold (e.g., **-\$10.00**), the engine automatically fires market square-off orders to close **both legs simultaneously**, protecting your capital without getting whipsawed.

---

## 📁 Project Structure

```
.
├── .env                  # Active environment variables
├── .env.example          # Template for configuration
├── broker.js             # Broker adapter (Mock simulation & Real API integration)
├── smartStrangleSL.js    # Core monitoring & Virtual SL / Trailing SL engine
├── index.js              # Application entry point
├── package.json          # Dependencies & scripts
└── README.md             # Documentation
```

---

## ⚙️ Configuration (`.env.example`)

```env
# ==========================================
# SMART STRANGLE SL ENGINE CONFIGURATION
# ==========================================

# 1. Dynamic SL & TP Calculation (Calculated from Up & Running Strangle)
# When true: Automatically fetches the running strangle's max profit (credit collected)
# and dynamically sets the Stop-Loss to match (e.g. $10 Max Profit => $10 Max Loss)
AUTO_CALCULATE_SL=true

# Stop-Loss Ratio of Max Profit:
# 1.0 = 100% of Max Profit ($10 Max Profit -> $10 Stop Loss, 1:1 risk/reward)
# 1.5 = 150% of Max Profit ($10 Max Profit -> $15 Stop Loss)
# 2.0 = 200% of Max Profit ($10 Max Profit -> $20 Stop Loss)
SL_RATIO_OF_MAX_PROFIT=1.0

# Automatically set target profit equal to max profit collected (100% decay)
AUTO_CALCULATE_TP=true

# 2. Manual / Fallback Stop-Loss Settings (Used if AUTO_CALCULATE_SL=false)
# Combined Stop-Loss in $ (Triggers exit when net loss reaches -$10 across both legs)
COMBINED_SL_AMOUNT=10

# Max Target Profit in $ (Triggers exit when net profit hits +$10)
# Set to 0 to disable
COMBINED_TARGET_PROFIT=10

# Smart Trailing Stop-Loss Settings
TRAILING_SL_ENABLED=false
TRAILING_SL_TRIGGER=5        # Activate trailing when profit reaches +$5
TRAILING_SL_DISTANCE=5       # Keep SL $5 below peak profit

# Engine Monitor Settings
POLL_INTERVAL_MS=1000        # Refresh rate (1000ms = 1 second)

# Execution Mode:
# true  = Paper trading / simulated prices & mock execution
# false = Live trading with actual broker orders
DRY_RUN=true

# ==========================================
# BROKER API CONFIGURATION
# ==========================================
BROKER_BASE_URL=https://api.yourbroker.com/v1
BROKER_API_KEY=your_api_key_here
BROKER_API_SECRET=your_api_secret_here
BROKER_ACCESS_TOKEN=your_access_token_here

# Specific Option Symbols (Optional if querying positions dynamically)
STRANGLE_UNDERLYING=BTC
CALL_SYMBOL=BTC-28000-C
PUT_SYMBOL=BTC-26000-P
```

---

## 🚀 Quick Start (Testing in Simulation Mode)

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run the script**:
   ```bash
   npm start
   # or
   node index.js
   ```

3. **Sample Console Output**:
   ```text
   ============================================================
          🚀 SMART STRANGLE VIRTUAL SL ENGINE STARTED          
   ============================================================

   [STRANGLE IDENTIFIED]
    ▸ Call Leg : BTC-28000-C | Sold @ $6.00 | Qty: 1
    ▸ Put Leg  : BTC-26000-P  | Sold @ $4.00 | Qty: 1
    ▸ Total Initial Premium Received (Max Profit): $10.00
    ▸ Base Virtual Combined SL : -$10.00
    ▸ Target Profit             : +$10.00
   ------------------------------------------------------------

   [7:16:50 PM] Call: $5.50 (+$0.50) | Put: $3.50 (+$0.50) | Combined PnL: +$1.00  | Virtual SL: $-10.00
   [7:16:51 PM] Call: $5.00 (+$1.00) | Put: $3.00 (+$1.00) | Combined PnL: +$2.00  | Virtual SL: $-10.00
   [7:16:52 PM] Call: $4.00 (+$2.00) | Put: $2.50 (+$1.50) | Combined PnL: +$3.50  | Virtual SL: $-10.00
   [7:16:53 PM] Call: $7.00 ($-1.00) | Put: $2.00 (+$2.00) | Combined PnL: +$1.00  | Virtual SL: $-10.00
   [7:16:54 PM] Call: $11.00 ($-5.00) | Put: $1.00 (+$3.00) | Combined PnL: $-2.00  | Virtual SL: $-10.00
   [7:16:55 PM] Call: $17.50 ($-11.50) | Put: $0.50 (+$3.50) | Combined PnL: $-8.00  | Virtual SL: $-10.00
   [7:16:56 PM] Call: $20.00 ($-14.00) | Put: $0.20 (+$3.80) | Combined PnL: $-10.20 | Virtual SL: $-10.00

   🚨 ============================================================
   🚨 [ALERT] VIRTUAL STOP-LOSS TRIGGERED!
      Combined PnL: $-10.20 reached/breached Virtual SL: $-10.00
   🚨 ============================================================
   [Exit Engine] Initiating market square-off for Strangle due to [STOP_LOSS]...
   [Broker] Closing both Strangle legs (BTC-28000-C & BTC-26000-P)...
   [DRY-RUN] Executed market BUY for BTC-28000-C (Qty: 1) at ~$20
   [DRY-RUN] Executed market BUY for BTC-26000-P (Qty: 1) at ~$0.2

   ================== FINAL STRANGLE SUMMARY ==================
    Status       : CLOSED (STOP_LOSS)
    Final PnL    : $-10.20
    Exits Filled : 2 leg(s)
   ============================================================
   ```

---

## 🔌 Connecting to Your Real Broker

In `broker.js`, modify the following methods to match your broker's REST API or SDK:

1. **`fetchStranglePositions()`**:
   - Calls your broker's positions endpoint (e.g. `GET /positions`).
   - Retrieves the two open legs for your strangle, their entry prices, and quantities.
   - Calculates total collected credit (Max Profit).

2. **`fetchCurrentPrices(symbols)`**:
   - Calls market quotes API (e.g. `GET /quotes?symbols=...`) or hooks into a WebSocket stream (e.g., Kite Ticker, Deribit WS, Binance WS).
   - Returns a `Map<symbol, ltp>` with latest prices.

3. **`closePosition(leg)`**:
   - Places a **MARKET BUY** order (to cover a short option position).
   - `closeStrangle()` uses `Promise.allSettled()` to fire exit orders for both legs concurrently, minimizing slippage.

