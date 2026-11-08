/**
 * index.js
 * Main Entry Point: Delta Exchange India Stop-Loss Monitor & Telegram Bot
 */
require('dotenv').config();
const { DeltaExchangeClient } = require('./deltaClient');
const { TelegramService } = require('./telegram');
const { SLMonitor } = require('./slMonitor');

async function main() {
  console.log('Starting Delta Exchange India Stop-Loss & Telegram System...');

  // 1. Initialize Delta Exchange India Client
  const deltaClient = new DeltaExchangeClient({
    apiKey: process.env.DELTA_API_KEY,
    apiSecret: process.env.DELTA_API_SECRET,
    baseUrl: process.env.DELTA_BASE_URL,
    isDryRun: process.env.DRY_RUN
  });

  // 2. Initialize Telegram Bot Service
  const telegram = new TelegramService({
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    enabled: process.env.TELEGRAM_ENABLED
  });

  // 3. Initialize Stop-Loss Alert Monitor (1-min Delta checking + 5 alerts at 10-min interval)
  const monitor = new SLMonitor(deltaClient, telegram, {
    defaultSlAmount: process.env.DEFAULT_SL_AMOUNT,
    slAlertIntervalMinutes: process.env.SL_ALERT_INTERVAL_MINUTES,
    maxAlerts: process.env.SL_MAX_ALERTS,
    pollIntervalMs: process.env.POLL_INTERVAL_MS
  });

  // Link monitor and telegram
  telegram.setMonitor(monitor);

  // 4. Start Telegram Listener & 1-Minute Delta Portfolio Checker
  await telegram.startPolling();
  await monitor.start();

  // 5. Handle Graceful Shutdown (Ctrl+C)
  process.on('SIGINT', () => {
    console.log('\n[Process] Shutting down Stop-Loss monitor and Telegram listener...');
    monitor.stop();
    telegram.stopPolling();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[Fatal Error]:', err);
  process.exit(1);
});
