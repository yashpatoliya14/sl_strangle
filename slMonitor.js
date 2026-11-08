/**
 * slMonitor.js
 * Stop-Loss Monitor for Delta Exchange India + Telegram
 * 
 * - Strictly monitors UNREALIZED PnL on Delta Exchange India (1-minute interval).
 * - Realized / booked profits or losses are completely excluded.
 * - Supports arbitrary custom Stop-Loss values set live via Telegram ('sl_set' or direct chat).
 * - Sends 5 alerts at 10-minute intervals upon Stop-Loss breach.
 */

class SLMonitor {
  /**
   * @param {object} deltaClient - Instance of DeltaExchangeClient
   * @param {object} telegram - Instance of TelegramService
   * @param {object} options - Configuration options
   */
  constructor(deltaClient, telegram = null, options = {}) {
    this.delta = deltaClient;
    this.telegram = telegram;

    // Custom Stop-Loss amount (e.g. 10 means -$10.00 loss threshold, 12.5 means -$12.50)
    this.slAmount = Number(options.defaultSlAmount ?? process.env.DEFAULT_SL_AMOUNT ?? 10);
    this.virtualSL = -Math.abs(this.slAmount);

    // Alert Sequence Settings
    this.slAlertIntervalMinutes = Number(options.slAlertIntervalMinutes ?? process.env.SL_ALERT_INTERVAL_MINUTES ?? 10);
    this.maxAlerts = Number(options.maxAlerts ?? process.env.SL_MAX_ALERTS ?? 5);

    // Delta Polling Interval (default: 60000ms = 1 minute)
    this.pollIntervalMs = Number(options.pollIntervalMs ?? process.env.POLL_INTERVAL_MS ?? 60000);

    // Live State
    this.currentUnrealizedPnL = 0;
    this.currentPnL = 0; // alias
    this.positionsCount = 0;
    this.positionsDetails = [];
    this.isSlBreached = false;
    this.alertsSent = 0;
    this.lastAlertTimestamp = 0;
    this.alertsSilenced = false;
    this.maxAlertsNoticeSent = false;

    this.pollTimer = null;
    this.isRunning = false;
  }

  /**
   * Start polling Delta Exchange India on 1-minute interval
   */
  async start() {
    console.log('\n============================================================');
    console.log('   🚀 DELTA INDIA STOP-LOSS MONITOR & TELEGRAM BOT ACTIVE   ');
    console.log('============================================================');
    console.log(` ▸ Check Frequency   : Every ${(this.pollIntervalMs / 1000).toFixed(0)}s (1 min)`);
    console.log(` ▸ Monitored Value   : UNREALIZED PnL ONLY (Booked PnL Ignored)`);
    console.log(` ▸ Custom Stop-Loss  : -$${this.slAmount.toFixed(2)} (Customizable live via Telegram)`);
    console.log(` ▸ Alert Interval    : Every ${this.slAlertIntervalMinutes} minutes`);
    console.log(` ▸ Max Alerts Limit  : ${this.maxAlerts} alerts`);
    console.log('============================================================\n');

    this.isRunning = true;

    // Run first check immediately
    await this._checkPortfolio();

    // Schedule 1-minute recurring poll
    this.pollTimer = setInterval(() => this._checkPortfolio(), this.pollIntervalMs);
  }

  /**
   * Stop polling
   */
  stop() {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * 1-Minute Check: Fetches UNREALIZED portfolio PnL from Delta Exchange India
   */
  async _checkPortfolio() {
    if (!this.isRunning) return;

    try {
      // 1. Fetch live UNREALIZED portfolio PnL
      const result = await this.delta.getOverallPortfolioPnL();
      this.currentUnrealizedPnL = result.totalUnrealizedPnL;
      this.currentPnL = this.currentUnrealizedPnL;
      this.positionsCount = result.positionsCount;
      this.positionsDetails = result.details;

      const time = new Date().toLocaleTimeString();
      const sign = this.currentUnrealizedPnL >= 0 ? '+' : '';
      console.log(
        `[${time}] Delta India Unrealized PnL: ${sign}$${this.currentUnrealizedPnL.toFixed(2)} | ` +
        `Custom SL: -$${this.slAmount.toFixed(2)} | Open Positions: ${this.positionsCount}` +
        (this.isSlBreached ? ` [ALERTS: ${this.alertsSent}/${this.maxAlerts}]` : '')
      );

      // 2. Check if UNREALIZED loss reaches or breaches the Stop-Loss
      if (this.currentUnrealizedPnL <= this.virtualSL) {
        const now = Date.now();
        const alertIntervalMs = this.slAlertIntervalMinutes * 60 * 1000;

        if (!this.isSlBreached) {
          this.isSlBreached = true;
          this.alertsSent = 0;
          this.alertsSilenced = false;
          this.maxAlertsNoticeSent = false;
        }

        const isFirstAlert = this.alertsSent === 0;
        const isFollowUpDue =
          this.alertsSent < this.maxAlerts &&
          now - this.lastAlertTimestamp >= alertIntervalMs;

        if (!this.alertsSilenced && (isFirstAlert || isFollowUpDue)) {
          this.alertsSent++;
          this.lastAlertTimestamp = now;

          console.log('\n🚨 ============================================================');
          console.log(`🚨 [ALERT ${this.alertsSent}/${this.maxAlerts}] UNREALIZED STOP-LOSS BREACHED!`);
          console.log(`   Unrealized PnL: $${this.currentUnrealizedPnL.toFixed(2)} <= Custom SL: -$${this.slAmount.toFixed(2)}`);
          if (this.alertsSent < this.maxAlerts) {
            console.log(`   Next alert in ${this.slAlertIntervalMinutes} minutes.`);
          }
          console.log('🚨 ============================================================');

          // Send Telegram Alert
          if (this.telegram && this.telegram.enabled) {
            await this.telegram.sendSlBreachAlert({
              alertNumber: this.alertsSent,
              maxAlerts: this.maxAlerts,
              currentUnrealizedPnL: this.currentUnrealizedPnL,
              slAmount: this.slAmount,
              positionsCount: this.positionsCount,
              details: this.positionsDetails,
              nextIntervalMins: this.slAlertIntervalMinutes
            });
          }
        } else if (this.alertsSent >= this.maxAlerts && !this.maxAlertsNoticeSent) {
          this.maxAlertsNoticeSent = true;
          console.log(`[SL Engine] Maximum ${this.maxAlerts} alerts reached for this breach cycle.`);
          if (this.telegram && this.telegram.enabled) {
            await this.telegram.sendMessage(
              `⚠️ *SL Alert Limit Reached (${this.maxAlerts}/${this.maxAlerts})*\n\n` +
              `Unrealized loss is still in breach at \`$${this.currentUnrealizedPnL.toFixed(2)}\` (SL: -$${this.slAmount.toFixed(2)}).\n` +
              `No further automated alerts will be sent unless reset or SL is updated.`
            );
          }
        }
      } else {
        // Unrealized PnL recovered above Stop-Loss
        if (this.isSlBreached) {
          console.log(`\n🟢 [RECOVERY] Unrealized PnL recovered above SL: $${this.currentUnrealizedPnL.toFixed(2)} > -$${this.slAmount.toFixed(2)}`);
          if (this.telegram && this.telegram.enabled && this.alertsSent > 0) {
            const sign = this.currentUnrealizedPnL >= 0 ? '+' : '';
            await this.telegram.sendMessage(
              `🟢 *Unrealized PnL Recovered Above SL*\n\n` +
              `• Current Unrealized PnL: \`${sign}$${this.currentUnrealizedPnL.toFixed(2)}\`\n` +
              `• Active Stop-Loss: \`-$${this.slAmount.toFixed(2)}\`\n\n` +
              `Alert sequence has been paused and reset.`
            );
          }
          this.isSlBreached = false;
          this.alertsSent = 0;
          this.alertsSilenced = false;
          this.maxAlertsNoticeSent = false;
        }
      }
    } catch (err) {
      console.error('[SL Monitor] Error checking Delta India unrealized PnL:', err.message);
    }
  }

  /**
   * Sets ANY custom Stop-Loss value (e.g. 10, 12.5, 25, 0.75, etc.)
   * @param {number|string} newAmount - Custom dollar amount
   */
  updateVirtualSL(newAmount) {
    const numeric = Math.abs(parseFloat(newAmount));
    if (isNaN(numeric) || numeric <= 0) {
      throw new Error(`Invalid custom Stop-Loss value: "${newAmount}". Please provide a positive number.`);
    }

    this.slAmount = Number(numeric.toFixed(2));
    this.virtualSL = -this.slAmount;

    // Reset alert tracking for the new custom SL level
    this.isSlBreached = false;
    this.alertsSent = 0;
    this.lastAlertTimestamp = 0;
    this.alertsSilenced = false;
    this.maxAlertsNoticeSent = false;

    console.log(`[SL Engine] Custom Stop-Loss updated to: -$${this.slAmount.toFixed(2)}`);
    return this.virtualSL;
  }

  /**
   * Silence remaining alerts for current breach
   */
  silenceAlerts() {
    this.alertsSilenced = true;
    console.log('[SL Engine] Alerts silenced by user.');
    return true;
  }

  /**
   * Reset alert counter and breach state
   */
  reset() {
    this.isSlBreached = false;
    this.alertsSent = 0;
    this.lastAlertTimestamp = 0;
    this.alertsSilenced = false;
    this.maxAlertsNoticeSent = false;
    console.log('[SL Engine] Alert sequence reset.');
    return true;
  }

  /**
   * Emergency Square-off of all open positions on Delta India
   */
  async emergencySquareOff() {
    console.log('[SL Engine] Executing emergency square-off on Delta India...');
    const result = await this.delta.closeAllPositions();
    this.reset();
    return result;
  }

  /**
   * Format Live Status for Telegram
   */
  getStatusSummary() {
    const sign = this.currentUnrealizedPnL >= 0 ? '+' : '';
    const distanceToSL = Math.abs(this.currentUnrealizedPnL - this.virtualSL);
    const statusText = this.isSlBreached ? '🚨 SL BREACHED' : '🟢 NORMAL';

    let detailsStr = '';
    if (this.positionsDetails && this.positionsDetails.length > 0) {
      detailsStr = '\n\n*Open Positions (Unrealized):*\n' + this.positionsDetails.map(p => {
        const pSign = p.unrealizedPnL >= 0 ? '+' : '';
        return `• \`${p.symbol}\` (${p.side} ${Math.abs(p.size)}): ${pSign}$${p.unrealizedPnL.toFixed(2)}`;
      }).join('\n');
    }

    return (
      `📊 *Delta India Unrealized PnL Status*\n\n` +
      `• *Status:* ${statusText}\n` +
      `• *Unrealized PnL:* \`${sign}$${this.currentUnrealizedPnL.toFixed(2)}\` _(Booked PnL ignored)_\n` +
      `• *Custom Stop-Loss:* \`-$${this.slAmount.toFixed(2)}\`\n` +
      `• *Buffer to SL:* \`$${distanceToSL.toFixed(2)}\`\n` +
      `• *Alerts Sent:* \`${this.alertsSent}/${this.maxAlerts}\` (Interval: ${this.slAlertIntervalMinutes}m)\n` +
      `• *Check Interval:* \`1 minute\`` +
      detailsStr
    );
  }
}

module.exports = { SLMonitor };
