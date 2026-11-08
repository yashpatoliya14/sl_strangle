/**
 * telegram.js
 * Telegram Bot Service with Interactive Buttons & Command Handling
 * Referenced from Desktop/funding architecture
 */

const axios = require('axios');

class TelegramService {
  constructor(options = {}) {
    this.botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;
    this.enabled = (options.enabled ?? process.env.TELEGRAM_ENABLED) === 'true' && Boolean(this.botToken) && Boolean(this.chatId);

    this.isPolling = false;
    this.lastUpdateId = 0;
    this.monitor = null; // Reference to SmartStrangleSL monitor
  }

  /**
   * Set reference to SmartStrangleSL monitor to interact with it
   */
  setMonitor(monitor) {
    this.monitor = monitor;
  }

  /**
   * Send a Telegram message with optional interactive buttons
   */
  async sendMessage(text, replyMarkup = undefined) {
    if (!this.enabled) {
      return { ok: false };
    }

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
   * Send high-priority alert
   */
  async sendAlert(title, message, isEmergency = false) {
    const icon = isEmergency ? '🚨' : '🔔';
    const text = `${icon} *${title}*\n\n${message}\n\n🕒 _${new Date().toLocaleString()}_`;
    return this.sendMessage(text);
  }

  /**
   * Persistent Reply Keyboard with 1-Tap Action Buttons
   */
  getDefaultReplyKeyboard() {
    return {
      keyboard: [
        [{ text: '🚨 Emergency Square Off' }],
        [{ text: '📊 Live Status' }, { text: '💰 Current PnL' }]
      ],
      resize_keyboard: true,
      is_persistent: true
    };
  }

  /**
   * Inline Keyboard for trade alerts
   */
  getInlineActionKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '📊 Check Status', callback_data: 'STATUS' },
          { text: '🚨 Exit Now', callback_data: 'FLATTEN' }
        ]
      ]
    };
  }

  /**
   * Answer callback queries to acknowledge button clicks
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
   * Start Telegram Command & Button Polling Loop
   */
  async startPolling() {
    if (!this.enabled) {
      console.log('[Telegram] Telegram disabled or credentials missing. Skipping bot polling.');
      return;
    }

    this.isPolling = true;
    console.log('[Telegram] Interactive button & command listener started.');

    // Announce startup with keyboard
    await this.sendMessage(
      '🤖 *Delta India Strangle Virtual SL Engine Active*\n\n' +
      'Use the buttons below to monitor or manage your running strangle:',
      this.getDefaultReplyKeyboard()
    );

    // Run background polling loop
    (async () => {
      while (this.isPolling) {
        try {
          const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=15`;
          const resp = await axios.get(url, { timeout: 20000 });

          if (resp.status === 200 && resp.data?.ok && Array.isArray(resp.data?.result)) {
            for (const update of resp.data.result) {
              this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);

              // Handle Inline Button Clicks
              if (update.callback_query) {
                const cb = update.callback_query;
                const senderChatId = String(cb.message?.chat?.id || cb.from?.id || '');
                if (senderChatId === String(this.chatId)) {
                  await this.answerCallbackQuery(cb.id);
                  await this._handleAction(cb.data);
                }
                continue;
              }

              // Handle Reply Keyboard & Text Commands
              if (update.message?.text) {
                const senderChatId = String(update.message.chat?.id || '');
                if (senderChatId === String(this.chatId)) {
                  await this._handleAction(update.message.text.trim());
                }
              }
            }
          }
        } catch (err) {
          // Delay before next polling attempt on error
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    })();
  }

  /**
   * Stop polling
   */
  stopPolling() {
    this.isPolling = false;
  }

  /**
   * Action Router for Commands & Buttons
   */
  async _handleAction(commandText) {
    const lower = (commandText || '').toLowerCase();

    // 1. Emergency Square Off
    if (lower.includes('emergency') || lower.includes('square off') || lower.includes('flatten') || lower === 'exit') {
      if (!this.monitor || !this.monitor.isRunning) {
        await this.sendMessage('⚠️ Strangle is not currently running or already closed.');
        return;
      }
      await this.sendMessage('🚨 *EMERGENCY EXIT INITIATED VIA TELEGRAM BUTTON!* Squaring off both legs...');
      await this.monitor.triggerManualExit('TELEGRAM_USER_EMERGENCY');
      return;
    }

    // 2. Status / Live Status
    if (lower.includes('status') || lower.includes('live')) {
      if (!this.monitor || !this.monitor.callLeg) {
        await this.sendMessage('ℹ️ No active strangle position identified.');
        return;
      }

      const statusMsg = this.monitor.getStatusSummary();
      await this.sendMessage(statusMsg, this.getDefaultReplyKeyboard());
      return;
    }

    // 3. PnL Check
    if (lower.includes('pnl') || lower.includes('profit') || lower.includes('loss')) {
      if (!this.monitor || !this.monitor.callLeg) {
        await this.sendMessage('ℹ️ No position data available.');
        return;
      }
      const pnlMsg = this.monitor.getPnLSummary();
      await this.sendMessage(pnlMsg, this.getDefaultReplyKeyboard());
      return;
    }
  }
}

module.exports = { TelegramService };
