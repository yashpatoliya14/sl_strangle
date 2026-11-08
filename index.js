/**
 * index.js
 * Main entry point for Delta Exchange India Smart Strangle Virtual SL Engine
 * with Interactive Telegram Bot
 */
require('dotenv').config();
const { DeltaExchangeClient } = require('./deltaClient');
const { TelegramService } = require('./telegram');
const { SmartStrangleSL } = require('./smartStrangleSL');

async function main() {
  console.log('Initializing Delta Exchange India Strangle Engine...');

  // 1. Initialize Delta Exchange India Client
  const deltaClient = new DeltaExchangeClient({
    apiKey: process.env.DELTA_API_KEY,
    apiSecret: process.env.DELTA_API_SECRET,
    baseUrl: process.env.DELTA_BASE_URL,
    isDryRun: process.env.DRY_RUN
  });

  // 2. Initialize Telegram Notification & Command Service
  const telegram = new TelegramService({
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    enabled: process.env.TELEGRAM_ENABLED
  });

  // 3. Initialize Smart Virtual SL Monitor (Trailing SL removed)
  const monitor = new SmartStrangleSL(deltaClient, telegram, {
    autoCalculateSL: process.env.AUTO_CALCULATE_SL,
    slMultiplier: process.env.SL_RATIO_OF_MAX_PROFIT,
    autoCalculateTP: process.env.AUTO_CALCULATE_TP,
    combinedSlAmount: process.env.COMBINED_SL_AMOUNT,
    targetProfit: process.env.COMBINED_TARGET_PROFIT,
    pollIntervalMs: process.env.POLL_INTERVAL_MS
  });

  // Link monitor to telegram so telegram buttons can trigger status / emergency exit
  telegram.setMonitor(monitor);

  // 4. Start Telegram Bot Interactive Listener
  await telegram.startPolling();

  // 5. Handle graceful shutdown (Ctrl+C)
  process.on('SIGINT', () => {
    console.log('\n[Process] Interrupted by user. Shutting down monitor and telegram...');
    monitor.stop();
    telegram.stopPolling();
    process.exit(0);
  });

  // 6. Start Strangle Monitoring
  await monitor.start();
}

main().catch(err => {
  console.error('[Fatal Error]:', err);
  process.exit(1);
});
