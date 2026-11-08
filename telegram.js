/**
 * telegram.js
 * Telegram Bot Service with Interactive Buttons & Custom SL Handling
 * 
 * - Supports setting ANY custom Stop-Loss value (e.g. 7.5, 12.35, 20, 50, etc.).
 * - Dispatches 5 alerts at 10-minute intervals on Unrealized SL breach.
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
    this.awaitingSlInput = false;
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
   * Send SL Breach Alert with 1-tap Square-off, Mute, and Custom SL change buttons
   */
  async sendSlBreachAlert({ alertNumber, maxAlerts, currentUnrealizedPnL, slAmount, positionsCount, details, nextIntervalMins }) {
    const nextAlertNote = alertNumber < maxAlerts
      ? `⏱️ _Next alert in ${nextIntervalMins} minutes (${alertNumber}/${maxAlerts} alerts)_`
      : `⚠️ _Final alert (${alertNumber}/${maxAlerts}). Automated alerts completed._`;

    let posText = '';
    if (details && details.length > 0) {
      posText = '\n*Active Open Positions (Unrealized):*\n' + details.map(p => {
        const pSign = p.unrealizedPnL >= 0 ? '+' : '';
        return `• \`${p.symbol}\` (${p.side} ${Math.abs(p.size)}): ${pSign}$${p.unrealizedPnL.toFixed(2)}`;
      }).join('\n') + '\n';
    }

    const text =
      `🚨 *[UNREALIZED STOP-LOSS ALERT ${alertNumber} of ${maxAlerts}]* 🚨\n\n` +
      `Your Delta Exchange India active positions reached your custom Stop-Loss!\n\n` +
      `• *Total Unrealized PnL:* \`$${currentUnrealizedPnL.toFixed(2)}\`\n` +
      `• *Custom Stop-Loss:* \`-$${slAmount.toFixed(2)}\`\n` +
      `• *Over SL by:* \`-$${Math.abs(currentUnrealizedPnL - (-slAmount)).toFixed(2)}\`\n` +
      `_(Note: Booked / realized PnL is completely excluded)_\n` +
      posText + `\n` +
      `${nextAlertNote}\n\n` +
      `_Choose an action below:_`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '🚨 Emergency Square Off', callback_data: 'FLATTEN' },
          { text: '🔕 Silence Alerts', callback_data: 'SILENCE_ALERTS' }
        ],
        [
          { text: '⚙️ Change SL (Custom)', callback_data: 'OPEN_SL_SET' },
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
        [{ text: '⚙️ sl_set' }, { text: '🚨 Emergency Square Off' }],
        [{ text: '📊 Live Status' }, { text: '🔄 Reset Alerts' }]
      ],
      resize_keyboard: true,
      is_persistent: true
    };
  }

  /**
   * Preset Inline Keyboard for Stop-Loss
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
      console.log('[Telegram] Telegram disabled or credentials missing. Running in local console mode.');
      return;
    }

    this.isPolling = true;
    console.log('[Telegram] Interactive Telegram bot listener started.');

    // Startup announcement
    await this.sendMessage(
      '🤖 *Delta India Unrealized SL Monitor Active*\n\n' +
      `• Checking Unrealized PnL: \`Every 1 minute\` (Booked PnL ignored)\n` +
      `• Active Stop-Loss: \`-$${this.monitor?.slAmount.toFixed(2) || '10.00'}\`\n` +
      `• Alert Schedule: \`5 alerts every 10 mins on SL breach\`\n\n` +
      `💡 _You can send any custom SL value in chat anytime (e.g. \`/sl 12.5\` or \`15.3\`) or tap *⚙️ sl_set*!_`,
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

    // 1. Direct command to set custom SL: e.g. "/sl 12.5" or "sl 7.25" or "/set_sl 15"
    if (lower.startsWith('/sl ') || lower.startsWith('sl ') || lower.startsWith('/set_sl ') || lower.startsWith('set_sl ')) {
      const parts = raw.split(/\s+/);
      if (parts.length > 1) {
        const customVal = parseFloat(parts[1]);
        if (!isNaN(customVal) && customVal !== 0 && this.monitor) {
          const newSL = this.monitor.updateVirtualSL(customVal);
          await this.sendMessage(
            `✅ *Custom Stop-Loss set to -$${Math.abs(customVal).toFixed(2)}!*\n\n` +
            `• Trigger Condition: Total Unrealized Loss $\\le$ \`-$${Math.abs(customVal).toFixed(2)}\`\n` +
            `• Booked PnL is completely ignored.\n` +
            `• Check interval: Every 1 min | 5 alerts every 10 mins.`,
            this.getDefaultReplyKeyboard()
          );
          return;
        }
      }
    }

    // 2. "sl_set" Button clicked / Command
    if (lower === 'sl_set' || lower === '⚙️ sl_set' || lower === '/set_sl' || lower === '/sl' || raw === 'OPEN_SL_SET') {
      this.awaitingSlInput = true;
      const currentSL = this.monitor ? this.monitor.slAmount.toFixed(2) : '10.00';
      const currentPnL = this.monitor ? this.monitor.currentUnrealizedPnL.toFixed(2) : '0.00';

      const promptText =
        `⚙️ *Set Custom Stop-Loss (Delta India)*\n\n` +
        `• Current Stop-Loss: \`-$${currentSL}\`\n` +
        `• Current Unrealized PnL: \`$${currentPnL}\` _(Booked PnL ignored)_\n\n` +
        `👉 *Type ANY custom dollar value in chat* (e.g. \`7.5\`, \`12.35\`, \`18\`, \`25.5\`), or select a preset below:`;

      await this.sendMessage(promptText, this.getSlPresetInlineKeyboard());
      return;
    }

    // 3. Preset SL Button Selected (e.g. SET_SL:15)
    if (raw.startsWith('SET_SL:')) {
      const amount = parseFloat(raw.replace('SET_SL:', ''));
      if (!isNaN(amount) && amount > 0 && this.monitor) {
        this.monitor.updateVirtualSL(amount);
        this.awaitingSlInput = false;
        await this.sendMessage(
          `✅ *Stop-Loss updated to -$${amount.toFixed(2)}!*\n\n` +
          `Delta India is checked every 1 min. If Unrealized loss hits -$${amount.toFixed(2)}, you will receive 5 alerts at 10-minute intervals.`,
          this.getDefaultReplyKeyboard()
        );
      }
      return;
    }

    // 4. Emergency Square Off
    if (lower.includes('emergency') || lower.includes('square off') || lower.includes('flatten') || raw === 'FLATTEN') {
      if (!this.monitor) return;
      await this.sendMessage('🚨 *EMERGENCY EXIT TRIGGERED!* Closing all active positions on Delta Exchange India...');
      const result = await this.monitor.emergencySquareOff();
      await this.sendMessage(`✅ *Emergency square-off completed:* ${JSON.stringify(result)}`, this.getDefaultReplyKeyboard());
      return;
    }

    // 5. Cancel Input
    if (raw === 'CANCEL_INPUT') {
      this.awaitingSlInput = false;
      await this.sendMessage('❌ Cancelled.', this.getDefaultReplyKeyboard());
      return;
    }

    // 6. Silence Alerts
    if (raw === 'SILENCE_ALERTS') {
      if (this.monitor) {
        this.monitor.silenceAlerts();
        await this.sendMessage('🔕 *Stop-Loss alerts silenced for this breach cycle.*', this.getDefaultReplyKeyboard());
      }
      return;
    }

    // 7. Reset Alerts
    if (lower.includes('reset') || raw === 'RESET_ALERTS') {
      if (this.monitor) {
        this.monitor.reset();
        await this.sendMessage('🔄 *Stop-Loss alert sequence has been reset.*', this.getDefaultReplyKeyboard());
      }
      return;
    }

    // 8. Status Check
    if (lower.includes('status') || lower.includes('live')) {
      if (this.monitor) {
        const statusMsg = this.monitor.getStatusSummary();
        await this.sendMessage(statusMsg, this.getDefaultReplyKeyboard());
      }
      return;
    }

    // 9. Handle arbitrary custom numeric input typed in chat (e.g. "12.35" or "-12.35" or "7.5")
    if (!isNaN(parseFloat(raw))) {
      const customAmount = Math.abs(parseFloat(raw));
      if (customAmount > 0 && this.monitor) {
        this.monitor.updateVirtualSL(customAmount);
        this.awaitingSlInput = false;
        await this.sendMessage(
          `✅ *Custom Stop-Loss set to -$${customAmount.toFixed(2)}!*\n\n` +
          `• Trigger Condition: Total Unrealized Loss $\\le$ \`-$${customAmount.toFixed(2)}\`\n` +
          `• Booked PnL is completely ignored.\n` +
          `• You will receive 5 alerts at 10-minute intervals if this limit is reached.`,
          this.getDefaultReplyKeyboard()
        );
        return;
      }
    }
  }
}

module.exports = { TelegramService };
