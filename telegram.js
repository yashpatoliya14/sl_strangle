/**
 * telegram.js
 * Standalone Telegram Bot Service for Stop-Loss Management & Live Alerts
 * Features 'sl_set' button and 5-alert sequence at 10-minute intervals.
 */

const axios = require('axios');

class TelegramService {
  constructor(options = {}) {
    this.botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;
    this.enabled = (options.enabled ?? process.env.TELEGRAM_ENABLED) === 'true' && Boolean(this.botToken) && Boolean(this.chatId);

    this.isPolling = false;
    this.lastUpdateId = 0;
    this.monitor = null; // Reference to SLMonitor
    this.awaitingInput = null; // 'SL' or 'PNL'
  }

  setMonitor(monitor) {
    this.monitor = monitor;
  }

  /**
   * Send a Telegram message with Markdown formatting & keyboard
   */
  async sendMessage(text, replyMarkup = undefined) {
    if (!this.enabled) return { ok: false };

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const payload = {
      chat_id: this.chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup || this.getDefaultReplyKeyboard()
    };

    try {
      const resp = await axios.post(url, payload, { timeout: 10000 });
      return { ok: true, messageId: resp.data?.result?.message_id };
    } catch (err) {
      console.warn('[Telegram] Failed to send message:', err.response?.data?.description || err.message);
      return { ok: false };
    }
  }

  /**
   * Send SL Breach Alert with 1-tap Silence & Edit buttons
   */
  async sendSlBreachAlert({ alertNumber, maxAlerts, currentPnL, slAmount, nextIntervalMins }) {
    const nextAlertNote = alertNumber < maxAlerts
      ? `⏱️ _Next alert in ${nextIntervalMins} minutes (${alertNumber}/${maxAlerts} alerts)_`
      : `⚠️ _Final alert (${alertNumber}/${maxAlerts}). Automated alerts completed._`;

    const text =
      `🚨 *[STOP-LOSS ALERT ${alertNumber} of ${maxAlerts}]* 🚨\n\n` +
      `Your portfolio has reached or breached your Stop-Loss!\n\n` +
      `• *Current Net PnL:* \`$${currentPnL.toFixed(2)}\`\n` +
      `• *Stop-Loss Limit:* \`-$${slAmount.toFixed(2)}\`\n` +
      `• *Breach Amount:* \`-$${Math.abs(currentPnL - (-slAmount)).toFixed(2)}\`\n\n` +
      `${nextAlertNote}\n\n` +
      `_Choose an action below:_`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '🔕 Silence Alerts', callback_data: 'SILENCE_ALERTS' },
          { text: '⚙️ sl_set (Change SL)', callback_data: 'OPEN_SL_SET' }
        ],
        [
          { text: '🔄 Reset Alerts', callback_data: 'RESET_ALERTS' }
        ]
      ]
    };

    return this.sendMessage(text, replyMarkup);
  }

  /**
   * Persistent 1-Tap Reply Keyboard
   */
  getDefaultReplyKeyboard() {
    return {
      keyboard: [
        [{ text: '⚙️ sl_set' }, { text: '💰 Update PnL' }],
        [{ text: '📊 Live Status' }, { text: '🔄 Reset Alerts' }]
      ],
      resize_keyboard: true,
      is_persistent: true
    };
  }

  /**
   * Quick Preset Inline Keyboard for Stop-Loss
   */
  getSlPresetInlineKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '-$5', callback_data: 'SET_SL:5' },
          { text: '-$10', callback_data: 'SET_SL:10' },
          { text: '-$15', callback_data: 'SET_SL:15' }
        ],
        [
          { text: '-$20', callback_data: 'SET_SL:20' },
          { text: '-$25', callback_data: 'SET_SL:25' },
          { text: '-$30', callback_data: 'SET_SL:30' }
        ],
        [
          { text: '❌ Cancel', callback_data: 'CANCEL_INPUT' }
        ]
      ]
    };
  }

  /**
   * Acknowledge Telegram callback queries
   */
  async answerCallbackQuery(callbackQueryId, text = '') {
    if (!this.enabled) return;
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`;
      await axios.post(url, { callback_query_id: callbackQueryId, text });
    } catch {
      // Non-fatal
    }
  }

  /**
   * Start Telegram Long-Polling Listener
   */
  async startPolling() {
    if (!this.enabled) {
      console.log('[Telegram] Telegram disabled or credentials missing. Running in local mode.');
      return;
    }

    this.isPolling = true;
    console.log('[Telegram] Interactive Telegram bot listener started.');

    // Startup announcement
    await this.sendMessage(
      '🤖 *Live Execution Stop-Loss Bot Active*\n\n' +
      `• Stop-Loss Limit: \`-$${this.monitor?.slAmount.toFixed(2) || '10.00'}\`\n` +
      `• Alert Schedule: \`5 alerts every 10 mins on SL breach\`\n\n` +
      `Tap *⚙️ sl_set* to customize your SL, or *💰 Update PnL* to update your balance!`,
      this.getDefaultReplyKeyboard()
    );

    // Polling loop
    (async () => {
      while (this.isPolling) {
        try {
          const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=15`;
          const resp = await axios.get(url, { timeout: 20000 });

          if (resp.status === 200 && resp.data?.ok && Array.isArray(resp.data?.result)) {
            for (const update of resp.data.result) {
              this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);

              // Inline Button Clicks
              if (update.callback_query) {
                const cb = update.callback_query;
                const senderChatId = String(cb.message?.chat?.id || cb.from?.id || '');
                if (senderChatId === String(this.chatId)) {
                  await this.answerCallbackQuery(cb.id);
                  await this._handleAction(cb.data);
                }
                continue;
              }

              // Text Commands & Keyboard Buttons
              if (update.message?.text) {
                const senderChatId = String(update.message.chat?.id || '');
                if (senderChatId === String(this.chatId)) {
                  await this._handleAction(update.message.text.trim());
                }
              }
            }
          }
        } catch {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    })();
  }

  stopPolling() {
    this.isPolling = false;
  }

  /**
   * Action Router for Button Clicks & Text Messages
   */
  async _handleAction(input) {
    const raw = (input || '').trim();
    const lower = raw.toLowerCase();

    // 1. "sl_set" Button / Command
    if (lower === 'sl_set' || lower === '⚙️ sl_set' || lower === '/set_sl' || raw === 'OPEN_SL_SET') {
      this.awaitingInput = 'SL';
      const currentSL = this.monitor ? this.monitor.slAmount.toFixed(2) : '10.00';
      const currentPnL = this.monitor ? this.monitor.currentPnL.toFixed(2) : '0.00';

      const promptText =
        `⚙️ *Set Stop-Loss Limit*\n\n` +
        `• Current Stop-Loss: \`-$${currentSL}\`\n` +
        `• Current Live PnL: \`$${currentPnL}\`\n\n` +
        `👉 *Select a quick preset below, or reply with any number* (e.g. \`10\` or \`15.5\`):`;

      await this.sendMessage(promptText, this.getSlPresetInlineKeyboard());
      return;
    }

    // 2. Preset SL Button Selected (e.g. SET_SL:15)
    if (raw.startsWith('SET_SL:')) {
      const amount = parseFloat(raw.replace('SET_SL:', ''));
      if (!isNaN(amount) && amount > 0 && this.monitor) {
        this.monitor.updateVirtualSL(amount);
        this.awaitingInput = null;
        await this.sendMessage(
          `✅ *Stop-Loss updated to -$${amount.toFixed(2)}!*\n\n` +
          `You will receive 5 alerts at 10-minute intervals if your loss hits -$${amount.toFixed(2)}.`,
          this.getDefaultReplyKeyboard()
        );
      }
      return;
    }

    // 3. "Update PnL" Button / Command
    if (lower === 'update pnl' || lower === '💰 update pnl' || lower.startsWith('/pnl') || lower.startsWith('pnl ')) {
      // Check if command included the value: e.g. /pnl -10.5 or pnl -12
      const parts = raw.split(/\s+/);
      if (parts.length > 1 && !isNaN(parseFloat(parts[1]))) {
        const pnl = parseFloat(parts[1]);
        await this.monitor.updatePnL(pnl);
        const sign = pnl >= 0 ? '+' : '';
        await this.sendMessage(`💰 *Live PnL Updated to ${sign}$${pnl.toFixed(2)}*`, this.getDefaultReplyKeyboard());
        return;
      }

      this.awaitingInput = 'PNL';
      await this.sendMessage(
        `💰 *Update Live Execution PnL*\n\n` +
        `Reply with your current portfolio PnL value (e.g. \`3.5\` or \`-10.2\`):`,
        this.getDefaultReplyKeyboard()
      );
      return;
    }

    // 4. Cancel Input
    if (raw === 'CANCEL_INPUT') {
      this.awaitingInput = null;
      await this.sendMessage('❌ Cancelled.', this.getDefaultReplyKeyboard());
      return;
    }

    // 5. Silence Alerts
    if (raw === 'SILENCE_ALERTS') {
      if (this.monitor) {
        this.monitor.silenceAlerts();
        await this.sendMessage('🔕 *Stop-Loss alerts silenced for this breach cycle.*', this.getDefaultReplyKeyboard());
      }
      return;
    }

    // 6. Reset Alerts
    if (lower.includes('reset') || raw === 'RESET_ALERTS') {
      if (this.monitor) {
        this.monitor.reset();
        await this.sendMessage('🔄 *Stop-Loss alert sequence has been reset.*', this.getDefaultReplyKeyboard());
      }
      return;
    }

    // 7. Status Check
    if (lower.includes('status') || lower.includes('live')) {
      if (this.monitor) {
        const statusMsg = this.monitor.getStatusSummary();
        await this.sendMessage(statusMsg, this.getDefaultReplyKeyboard());
      }
      return;
    }

    // 8. Handle numerical input when awaiting SL or PnL
    if (!isNaN(parseFloat(raw))) {
      const val = parseFloat(raw);

      if (this.awaitingInput === 'SL') {
        const amount = Math.abs(val);
        this.monitor.updateVirtualSL(amount);
        this.awaitingInput = null;
        await this.sendMessage(
          `✅ *Stop-Loss updated to -$${amount.toFixed(2)}!*\n\n` +
          `Alerts will trigger 5 times at 10-min intervals if loss hits -$${amount.toFixed(2)}.`,
          this.getDefaultReplyKeyboard()
        );
        return;
      }

      if (this.awaitingInput === 'PNL') {
        await this.monitor.updatePnL(val);
        this.awaitingInput = null;
        const sign = val >= 0 ? '+' : '';
        await this.sendMessage(`💰 *Live PnL Updated to ${sign}$${val.toFixed(2)}*`, this.getDefaultReplyKeyboard());
        return;
      }
    }
  }
}

module.exports = { TelegramService };
