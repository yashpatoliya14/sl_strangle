/**
 * slMonitor.js
 * Dedicated Stop-Loss Alerting Engine
 * Tracks Stop-Loss, triggers 5 alerts at 10-minute intervals,
 * and handles dynamic SL updates via Telegram ('sl_set').
 */

class SLMonitor {
  /**
   * @param {object} telegram - Instance of TelegramService
   * @param {object} options - Options from environment
   */
  constructor(telegram = null, options = {}) {
    this.telegram = telegram;

    // Stop-Loss limit in $ (e.g. 10 => Virtual SL is -$10.00)
    this.slAmount = Number(options.defaultSlAmount ?? process.env.DEFAULT_SL_AMOUNT ?? 10);
    this.virtualSL = -Math.abs(this.slAmount);

    // Alert Sequence Settings: 5 alerts at 10-minute intervals
    this.slAlertIntervalMinutes = Number(options.slAlertIntervalMinutes ?? process.env.SL_ALERT_INTERVAL_MINUTES ?? 10);
    this.maxAlerts = Number(options.maxAlerts ?? process.env.SL_MAX_ALERTS ?? 5);

    // Live State
    this.currentPnL = 0;
    this.isSlBreached = false;
    this.alertsSent = 0;
    this.lastAlertTimestamp = 0;
    this.alertsSilenced = false;
    this.maxAlertsNoticeSent = false;

    // Periodic timer for the 10-minute follow-up alerts
    this.intervalTimer = null;
  }

  /**
   * Start the internal check timer (runs every 5 seconds to check 10-min intervals)
   */
  start() {
    console.log('\n============================================================');
    console.log('       🚀 TELEGRAM STOP-LOSS ALERT ENGINE ACTIVE            ');
    console.log('============================================================');
    console.log(` ▸ Current Virtual SL : -$${this.slAmount.toFixed(2)}`);
    console.log(` ▸ Alert Interval    : Every ${this.slAlertIntervalMinutes} minutes`);
    console.log(` ▸ Max Alerts Limit  : ${this.maxAlerts} alerts`);
    console.log('============================================================\n');

    this.intervalTimer = setInterval(() => this._checkFollowUpAlerts(), 5000);
  }

  /**
   * Stop the internal check timer
   */
  stop() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  /**
   * Set reference to Telegram service
   */
  setTelegram(telegram) {
    this.telegram = telegram;
  }

  /**
   * Update the Stop-Loss amount (Called via Telegram 'sl_set')
   */
  updateVirtualSL(newAmount) {
    const numeric = Math.abs(Number(newAmount));
    if (isNaN(numeric) || numeric <= 0) {
      throw new Error('Invalid Stop-Loss amount.');
    }

    this.slAmount = numeric;
    this.virtualSL = -numeric;

    // Reset alert tracking for the new SL level
    this.isSlBreached = false;
    this.alertsSent = 0;
    this.lastAlertTimestamp = 0;
    this.alertsSilenced = false;
    this.maxAlertsNoticeSent = false;

    console.log(`[SL Engine] Stop-Loss updated to: -$${this.slAmount.toFixed(2)}`);
    return this.virtualSL;
  }

  /**
   * Update the live PnL (from Telegram chat command, webhook, or live feed)
   */
  async updatePnL(newPnL) {
    const numeric = Number(newPnL);
    if (isNaN(numeric)) {
      throw new Error('Invalid PnL value.');
    }

    this.currentPnL = numeric;
    const time = new Date().toLocaleTimeString();
    const sign = this.currentPnL >= 0 ? '+' : '';
    console.log(`[${time}] PnL Update: ${sign}$${this.currentPnL.toFixed(2)} | Virtual SL: -$${this.slAmount.toFixed(2)}`);

    // Check if Stop-Loss is reached / breached
    if (this.currentPnL <= this.virtualSL) {
      if (!this.isSlBreached) {
        this.isSlBreached = true;
        this.alertsSent = 0;
        this.alertsSilenced = false;
        this.maxAlertsNoticeSent = false;
      }

      // Fire immediate Alert #1
      if (this.alertsSent === 0 && !this.alertsSilenced) {
        await this._dispatchAlert();
      }
    } else {
      // PnL recovered above Stop-Loss
      if (this.isSlBreached) {
        console.log(`🟢 [RECOVERY] PnL recovered above SL: $${this.currentPnL.toFixed(2)} > -$${this.slAmount.toFixed(2)}`);
        if (this.telegram && this.telegram.enabled && this.alertsSent > 0) {
          await this.telegram.sendMessage(
            `🟢 *Portfolio Recovered Above SL*\n\n` +
            `• Current PnL: \`${sign}$${this.currentPnL.toFixed(2)}\`\n` +
            `• Stop-Loss: \`-$${this.slAmount.toFixed(2)}\`\n\n` +
            `Alert sequence has been reset.`
          );
        }
        this.isSlBreached = false;
        this.alertsSent = 0;
        this.alertsSilenced = false;
        this.maxAlertsNoticeSent = false;
      }
    }

    return this.currentPnL;
  }

  /**
   * Internal check for subsequent alerts (Alerts 2 to 5 every 10 minutes)
   */
  async _checkFollowUpAlerts() {
    if (!this.isSlBreached || this.alertsSilenced) return;

    if (this.alertsSent >= this.maxAlerts) {
      if (!this.maxAlertsNoticeSent) {
        this.maxAlertsNoticeSent = true;
        console.log(`[SL Engine] Maximum ${this.maxAlerts} alerts reached. Halting alerts.`);
        if (this.telegram && this.telegram.enabled) {
          await this.telegram.sendMessage(
            `⚠️ *SL Alert Limit Reached*\n\n` +
            `Sent all ${this.maxAlerts} alerts. Current PnL remains in breach at \`$${this.currentPnL.toFixed(2)}\` (SL: -$${this.slAmount.toFixed(2)}).`
          );
        }
      }
      return;
    }

    const now = Date.now();
    const intervalMs = this.slAlertIntervalMinutes * 60 * 1000;

    if (now - this.lastAlertTimestamp >= intervalMs) {
      await this._dispatchAlert();
    }
  }

  /**
   * Sends alert to Telegram and console
   */
  async _dispatchAlert() {
    this.alertsSent++;
    this.lastAlertTimestamp = Date.now();

    console.log('\n🚨 ============================================================');
    console.log(`🚨 [ALERT ${this.alertsSent}/${this.maxAlerts}] STOP-LOSS BREACHED!`);
    console.log(`   Current PnL: $${this.currentPnL.toFixed(2)} <= Stop-Loss: -$${this.slAmount.toFixed(2)}`);
    if (this.alertsSent < this.maxAlerts) {
      console.log(`   Next alert in ${this.slAlertIntervalMinutes} minutes.`);
    }
    console.log('🚨 ============================================================');

    if (this.telegram && this.telegram.enabled) {
      await this.telegram.sendSlBreachAlert({
        alertNumber: this.alertsSent,
        maxAlerts: this.maxAlerts,
        currentPnL: this.currentPnL,
        slAmount: this.slAmount,
        nextIntervalMins: this.slAlertIntervalMinutes
      });
    }
  }

  /**
   * Silence remaining alerts
   */
  silenceAlerts() {
    this.alertsSilenced = true;
    console.log('[SL Engine] Alerts silenced by user.');
    return true;
  }

  /**
   * Reset the alert sequence
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
   * Live Status string for Telegram
   */
  getStatusSummary() {
    const sign = this.currentPnL >= 0 ? '+' : '';
    const distanceToSL = Math.abs(this.currentPnL - this.virtualSL);
    const statusText = this.isSlBreached ? '🚨 BREACHED' : '🟢 NORMAL';

    return (
      `📊 *Live Stop-Loss Status*\n\n` +
      `• *Status:* ${statusText}\n` +
      `• *Current PnL:* \`${sign}$${this.currentPnL.toFixed(2)}\`\n` +
      `• *Stop-Loss Limit:* \`-$${this.slAmount.toFixed(2)}\`\n` +
      `• *Distance to SL:* \`$${distanceToSL.toFixed(2)}\`\n\n` +
      `• *Alert Sequence:* \`${this.alertsSent}/${this.maxAlerts} sent\`\n` +
      `• *Alert Interval:* \`Every ${this.slAlertIntervalMinutes} mins\``
    );
  }
}

module.exports = { SLMonitor };
