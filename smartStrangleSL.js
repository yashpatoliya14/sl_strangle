/**
 * smartStrangleSL.js
 * Smart Combined Virtual Stop-Loss & Target Profit Monitor for Delta Exchange India
 * (Trailing SL completely removed)
 */

class SmartStrangleSL {
  /**
   * @param {object} exchangeClient - Instance of DeltaExchangeClient
   * @param {object} telegram - Instance of TelegramService
   * @param {object} options - Configuration options
   */
  constructor(exchangeClient, telegram = null, options = {}) {
    this.exchange = exchangeClient;
    this.telegram = telegram;

    // Dynamic SL Configuration
    // If true: SL is dynamically derived from the running position's Max Profit
    this.autoCalculateSL = (options.autoCalculateSL ?? process.env.AUTO_CALCULATE_SL ?? 'true') === 'true';
    this.slMultiplier = Number(options.slMultiplier ?? process.env.SL_RATIO_OF_MAX_PROFIT ?? 1.0);

    // Fallback/Manual Combined Stop Loss in $ (used if autoCalculateSL = false)
    this.manualSlAmount = Number(options.combinedSlAmount ?? process.env.COMBINED_SL_AMOUNT ?? 10);
    this.slAmount = this.manualSlAmount;
    this.virtualSL = -Math.abs(this.slAmount); // e.g. -$10.00

    // Target Profit threshold in $ (optional, e.g. +$10)
    this.targetProfit = Number(options.targetProfit ?? process.env.COMBINED_TARGET_PROFIT ?? 10);
    this.autoCalculateTP = (options.autoCalculateTP ?? process.env.AUTO_CALCULATE_TP ?? 'true') === 'true';

    // Monitoring state
    this.pollIntervalMs = Number(options.pollIntervalMs ?? process.env.POLL_INTERVAL_MS ?? 1000);
    this.isRunning = false;
    this.intervalId = null;

    // Position state
    this.callLeg = null;
    this.putLeg = null;
    this.maxProfit = 0; // Total credit received
    this.lastCombinedPnL = 0;
  }

  /**
   * Initialize and start the monitoring loop
   */
  async start() {
    console.log('\n============================================================');
    console.log('    🚀 DELTA INDIA STRANGLE VIRTUAL SL ENGINE STARTED       ');
    console.log('============================================================');

    try {
      // 1. Fetch existing Strangle positions from Delta Exchange India
      const positions = await this.exchange.fetchStranglePositions();
      this.callLeg = positions.callLeg;
      this.putLeg = positions.putLeg;
      this.maxProfit = positions.maxProfit;

      // 2. Dynamically calculate Combined Stop-Loss from the running Strangle's Max Profit
      if (this.autoCalculateSL) {
        this.slAmount = this.maxProfit * this.slMultiplier;
        this.virtualSL = -Math.abs(this.slAmount);
      }

      // If Auto TP is enabled, target profit matches total collected premium
      if (this.autoCalculateTP) {
        this.targetProfit = this.maxProfit;
      }

      console.log(`\n[UP & RUNNING STRANGLE IDENTIFIED ON DELTA INDIA]`);
      console.log(` ▸ Call Leg  : ${this.callLeg.symbol} | Sold @ $${this.callLeg.entryPrice.toFixed(2)} | Qty: ${this.callLeg.quantity}`);
      console.log(` ▸ Put Leg   : ${this.putLeg.symbol}  | Sold @ $${this.putLeg.entryPrice.toFixed(2)} | Qty: ${this.putLeg.quantity}`);
      console.log(` ▸ Max Profit (Credit Received) : $${this.maxProfit.toFixed(2)}`);
      
      if (this.autoCalculateSL) {
        console.log(` ▸ Dynamic Virtual Combined SL  : -$${this.slAmount.toFixed(2)} [Auto-calculated from Max Profit @ ${(this.slMultiplier * 100).toFixed(0)}%]`);
      } else {
        console.log(` ▸ Manual Virtual Combined SL   : -$${this.slAmount.toFixed(2)}`);
      }

      if (this.targetProfit > 0) {
        console.log(` ▸ Target Profit (Take Profit)  : +$${this.targetProfit.toFixed(2)}`);
      }
      console.log('------------------------------------------------------------\n');

      // Send initial Telegram notification
      if (this.telegram && this.telegram.enabled) {
        await this.telegram.sendMessage(
          `🚀 *Strangle Monitoring Active on Delta India*\n\n` +
          `• *Call Leg:* \`${this.callLeg.symbol}\` (Sold @ $${this.callLeg.entryPrice.toFixed(2)})\n` +
          `• *Put Leg:* \`${this.putLeg.symbol}\` (Sold @ $${this.putLeg.entryPrice.toFixed(2)})\n` +
          `• *Max Profit:* \`+$${this.maxProfit.toFixed(2)}\`\n` +
          `• *Virtual Combined SL:* \`-$${this.slAmount.toFixed(2)}\`\n` +
          `• *Target Profit:* \`+$${this.targetProfit.toFixed(2)}\`\n\n` +
          `_Use the buttons below to monitor or manage this strangle._`
        );
      }

      this.isRunning = true;
      this.intervalId = setInterval(() => this._tick(), this.pollIntervalMs);
    } catch (error) {
      console.error('[Engine] Failed to initialize Strangle monitor:', error.message);
      this.stop();
    }
  }

  /**
   * Periodic check: fetches real-time prices, computes combined PnL,
   * and triggers exit if SL or TP conditions are met.
   */
  async _tick() {
    if (!this.isRunning) return;

    try {
      // Fetch latest market prices (LTP)
      const prices = await this.exchange.fetchCurrentPrices([
        this.callLeg.symbol,
        this.putLeg.symbol
      ]);

      const callLtp = prices.get(this.callLeg.symbol);
      const putLtp = prices.get(this.putLeg.symbol);

      if (callLtp === undefined || putLtp === undefined) {
        console.warn('[Tick] Missing market price update. Skipping tick...');
        return;
      }

      this.callLeg.currentLtp = callLtp;
      this.putLeg.currentLtp = putLtp;

      // Calculate Individual Leg PnL (for Short positions: entryPrice - currentLtp)
      const callPnL = (this.callLeg.entryPrice - callLtp) * this.callLeg.quantity;
      const putPnL = (this.putLeg.entryPrice - putLtp) * this.putLeg.quantity;

      // Combined Net PnL across both legs
      const combinedPnL = callPnL + putPnL;
      this.lastCombinedPnL = combinedPnL;

      // Print status log to console
      this._printStatus(callPnL, putPnL, combinedPnL);

      // Condition 1: Virtual Combined SL Triggered
      if (combinedPnL <= this.virtualSL) {
        console.log('\n🚨 ============================================================');
        console.log(`🚨 [ALERT] VIRTUAL STOP-LOSS TRIGGERED!`);
        console.log(`   Combined PnL: $${combinedPnL.toFixed(2)} reached/breached Virtual SL: $${this.virtualSL.toFixed(2)}`);
        console.log('🚨 ============================================================');
        
        await this._triggerExit('STOP_LOSS', combinedPnL);
        return;
      }

      // Condition 2: Target Profit Triggered
      if (this.targetProfit > 0 && combinedPnL >= this.targetProfit) {
        console.log('\n🎯 ============================================================');
        console.log(`🎯 [ALERT] TARGET PROFIT REACHED!`);
        console.log(`   Combined PnL: $${combinedPnL.toFixed(2)} reached Target: +$${this.targetProfit.toFixed(2)}`);
        console.log('🎯 ============================================================');
        
        await this._triggerExit('TARGET_PROFIT', combinedPnL);
        return;
      }

    } catch (error) {
      console.error('[Tick Error]:', error.message);
    }
  }

  /**
   * Execute exit for both legs and stop the engine
   * @param {string} reason 
   * @param {number} finalPnL 
   */
  async _triggerExit(reason, finalPnL) {
    this.stop();
    console.log(`[Exit Engine] Initiating market square-off on Delta Exchange India due to [${reason}]...`);
    
    const result = await this.exchange.closeStrangle(this.callLeg, this.putLeg);

    console.log('\n================== FINAL STRANGLE SUMMARY ==================');
    console.log(` Status       : CLOSED (${reason})`);
    console.log(` Final PnL    : $${finalPnL.toFixed(2)}`);
    console.log(` Exits Filled : ${result.successes.length} leg(s)`);
    if (result.failures.length > 0) {
      console.log(` Failed Exits : ${result.failures.length} leg(s) - MANUAL INTERVENTION REQUIRED!`);
    }
    console.log('============================================================\n');

    // Send Telegram alert
    if (this.telegram && this.telegram.enabled) {
      const isSL = reason === 'STOP_LOSS';
      const title = isSL ? '🚨 VIRTUAL STOP-LOSS TRIGGERED' : '🎯 TARGET PROFIT ACHIEVED';
      const message =
        `*Strangle Closed on Delta Exchange India*\n\n` +
        `• *Reason:* \`${reason}\`\n` +
        `• *Final Combined PnL:* \`$${finalPnL.toFixed(2)}\`\n` +
        `• *Call Exit:* \`${this.callLeg.symbol}\` @ ~$${this.callLeg.currentLtp.toFixed(2)}\n` +
        `• *Put Exit:* \`${this.putLeg.symbol}\` @ ~$${this.putLeg.currentLtp.toFixed(2)}\n` +
        `• *Exits Filled:* ${result.successes.length} / 2 leg(s)\n` +
        (result.failures.length > 0 ? `\n⚠️ *CRITICAL: ${result.failures.length} leg(s) failed to close! Check Delta India!*` : '');

      await this.telegram.sendAlert(title, message, isSL);
    }
  }

  /**
   * Trigger manual exit (e.g. from Telegram emergency button)
   */
  async triggerManualExit(reason = 'MANUAL_EMERGENCY') {
    if (!this.isRunning) return;
    await this._triggerExit(reason, this.lastCombinedPnL);
  }

  /**
   * Stop the monitor loop
   */
  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Generate Live Status Summary for Telegram button query
   */
  getStatusSummary() {
    if (!this.callLeg || !this.putLeg) return 'No active strangle loaded.';

    const callPnL = (this.callLeg.entryPrice - this.callLeg.currentLtp) * this.callLeg.quantity;
    const putPnL = (this.putLeg.entryPrice - this.putLeg.currentLtp) * this.putLeg.quantity;
    const combined = callPnL + putPnL;
    const distanceToSL = Math.abs(combined - this.virtualSL);

    return (
      `📊 *Delta India Strangle Status*\n\n` +
      `📞 *Call:* \`${this.callLeg.symbol}\`\n` +
      `   Entry: $${this.callLeg.entryPrice.toFixed(2)} | LTP: $${this.callLeg.currentLtp.toFixed(2)} | PnL: ${callPnL >= 0 ? '+' : ''}$${callPnL.toFixed(2)}\n\n` +
      `📉 *Put:* \`${this.putLeg.symbol}\`\n` +
      `   Entry: $${this.putLeg.entryPrice.toFixed(2)} | LTP: $${this.putLeg.currentLtp.toFixed(2)} | PnL: ${putPnL >= 0 ? '+' : ''}$${putPnL.toFixed(2)}\n\n` +
      `💰 *Combined Net PnL:* \`${combined >= 0 ? '+' : ''}$${combined.toFixed(2)}\`\n` +
      `🛑 *Virtual Combined SL:* \`$${this.virtualSL.toFixed(2)}\`\n` +
      `🛡️ *Buffer to SL:* \`$${distanceToSL.toFixed(2)}\``
    );
  }

  /**
   * Generate PnL Summary for Telegram button query
   */
  getPnLSummary() {
    if (!this.callLeg) return 'No position data.';
    const sign = this.lastCombinedPnL >= 0 ? '+' : '';
    return (
      `💰 *Current Strangle PnL: ${sign}$${this.lastCombinedPnL.toFixed(2)}*\n\n` +
      `• Max Profit Target: +$${this.maxProfit.toFixed(2)}\n` +
      `• Max Loss Limit (SL): -$${this.slAmount.toFixed(2)}`
    );
  }

  /**
   * Format console tick output
   */
  _printStatus(callPnL, putPnL, combinedPnL) {
    const time = new Date().toLocaleTimeString();
    const pnlSign = combinedPnL >= 0 ? '+' : '';
    const formattedCombined = `${pnlSign}$${combinedPnL.toFixed(2)}`;
    
    console.log(
      `[${time}] ` +
      `Call: $${this.callLeg.currentLtp.toFixed(2)} (${callPnL >= 0 ? '+' : ''}$${callPnL.toFixed(2)}) | ` +
      `Put: $${this.putLeg.currentLtp.toFixed(2)} (${putPnL >= 0 ? '+' : ''}$${putPnL.toFixed(2)}) | ` +
      `Combined PnL: ${formattedCombined.padEnd(7)} | ` +
      `Virtual SL: $${this.virtualSL.toFixed(2)}`
    );
  }
}

module.exports = { SmartStrangleSL };
