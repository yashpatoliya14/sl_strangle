/**
 * index.js
 * Standalone Stop-Loss Telegram Alert Bot for Live Execution
 */
require('dotenv').config();
const http = require('http');
const { TelegramService } = require('./telegram');
const { SLMonitor } = require('./slMonitor');

async function main() {
  console.log('Starting Stop-Loss Telegram Alert System...');

  // 1. Initialize Telegram Bot Service
  const telegram = new TelegramService({
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    enabled: process.env.TELEGRAM_ENABLED
  });

  // 2. Initialize Stop-Loss Alert Monitor
  const monitor = new SLMonitor(telegram, {
    defaultSlAmount: process.env.DEFAULT_SL_AMOUNT,
    slAlertIntervalMinutes: process.env.SL_ALERT_INTERVAL_MINUTES,
    maxAlerts: process.env.SL_MAX_ALERTS
  });

  // Link monitor and telegram
  telegram.setMonitor(monitor);
  monitor.setTelegram(telegram);

  // 3. Start Telegram Listener & Alert Timer
  await telegram.startPolling();
  monitor.start();

  // 4. Lightweight HTTP Server for Live Execution Bots (Optional)
  // Your trading script can POST /pnl to automatically push live PnL
  const port = process.env.PORT || 3000;
  const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'POST' && req.url === '/pnl') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const pnl = Number(data.pnl ?? data.profit);
          if (isNaN(pnl)) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: 'Missing numeric pnl field' }));
          }

          await monitor.updatePnL(pnl);
          res.statusCode = 200;
          return res.end(JSON.stringify({
            ok: true,
            currentPnL: monitor.currentPnL,
            virtualSL: monitor.virtualSL,
            isSlBreached: monitor.isSlBreached
          }));
        } catch {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/status') {
      res.statusCode = 200;
      return res.end(JSON.stringify({
        ok: true,
        currentPnL: monitor.currentPnL,
        virtualSL: monitor.virtualSL,
        isSlBreached: monitor.isSlBreached,
        alertsSent: monitor.alertsSent,
        maxAlerts: monitor.maxAlerts
      }));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, () => {
    console.log(`[HTTP Server] Listening on port ${port} (POST /pnl to push live PnL)`);
  });

  // 5. Handle Graceful Shutdown (Ctrl+C)
  process.on('SIGINT', () => {
    console.log('\n[Process] Shutting down Stop-Loss Telegram system...');
    monitor.stop();
    telegram.stopPolling();
    server.close(() => {
      process.exit(0);
    });
  });
}

main().catch(err => {
  console.error('[Fatal Error]:', err);
  process.exit(1);
});
