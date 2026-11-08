/**
 * check-delta.js
 * CLI Diagnostic tool to test Delta Exchange India API credentials,
 * inspect raw position responses, and verify live Unrealized PnL calculation.
 * 
 * Usage: node check-delta.js
 */

require('dotenv').config();
const { DeltaExchangeClient } = require('./deltaClient');
const { DeltaAuth } = require('./deltaAuth');

async function runDiagnostics() {
  console.log('============================================================');
  console.log('   🔍 DELTA EXCHANGE INDIA LIVE DIAGNOSTIC TOOL            ');
  console.log('============================================================\n');

  const apiKey = process.env.DELTA_API_KEY;
  const apiSecret = process.env.DELTA_API_SECRET;
  const baseUrl = process.env.DELTA_BASE_URL || 'https://api.india.delta.exchange';
  const isDryRun = process.env.DRY_RUN === 'true';

  console.log(`[Config Check]`);
  console.log(` ▸ Base URL       : ${baseUrl}`);
  console.log(` ▸ API Key        : ${apiKey ? apiKey.substring(0, 6) + '...' + apiKey.slice(-4) : '❌ MISSING'}`);
  console.log(` ▸ API Secret     : ${apiSecret ? '••••••••' + apiSecret.slice(-4) : '❌ MISSING'}`);
  console.log(` ▸ DRY_RUN Mode   : ${isDryRun ? 'true (SIMULATION)' : 'false (LIVE TRADING)'}`);
  console.log(` ▸ Telegram Token : ${process.env.TELEGRAM_BOT_TOKEN ? 'CONFIGURED' : 'MISSING'}`);
  console.log(` ▸ Telegram Chat  : ${process.env.TELEGRAM_CHAT_ID ? process.env.TELEGRAM_CHAT_ID : 'MISSING'}`);
  console.log('------------------------------------------------------------\n');

  if (isDryRun) {
    console.log('⚠️ NOTE: DRY_RUN=true is enabled in .env.');
    console.log('   To test real live positions from Delta India, set DRY_RUN=false in .env.\n');
  }

  const client = new DeltaExchangeClient({
    apiKey,
    apiSecret,
    baseUrl,
    isDryRun: false // Force real API test in diagnostic script
  });

  // Step 1: Test connection & time sync
  console.log('[Step 1/3] Testing public connectivity and server time sync...');
  try {
    const tickers = await client.getTickers();
    console.log(` ✅ Public API Connected! Received ${tickers.length} market tickers.`);
    console.log(`    Server Time Offset: ${DeltaAuth.getServerTimeOffset()} ms\n`);
  } catch (err) {
    console.error(` ❌ Public API connection failed:`, err.message);
  }

  // Step 2: Test authenticated private positions
  console.log('[Step 2/3] Querying authenticated positions from Delta India...');
  if (!apiKey || !apiSecret) {
    console.log(' ❌ Skipping Step 2: DELTA_API_KEY or DELTA_API_SECRET not set in .env.');
    return;
  }

  try {
    const rawPositions = await client.getOpenPositions();
    console.log(` ✅ Private API Authenticated!`);
    console.log(`    Raw Positions returned: ${rawPositions.length}`);
    if (rawPositions.length > 0) {
      console.log('    Raw Sample Position:', JSON.stringify(rawPositions[0], null, 2));
    } else {
      console.log('    ℹ️ No open positions found on Delta India account.');
    }
    console.log();
  } catch (err) {
    console.error(` ❌ Private API Authentication failed:`, err.message);
    if (err.message.includes('401')) {
      console.log('    👉 Hint: Check that DELTA_API_KEY and DELTA_API_SECRET are correct.');
    }
    console.log();
  }

  // Step 3: Test overall portfolio Unrealized PnL calculation
  console.log('[Step 3/3] Calculating Live Overall Unrealized PnL...');
  try {
    const portfolio = await client.getOverallPortfolioPnL();
    console.log(` ✅ Overall Unrealized PnL Calculation Complete:`);
    console.log(`    Total Unrealized PnL : $${portfolio.totalUnrealizedPnL.toFixed(2)}`);
    console.log(`    Active Positions     : ${portfolio.positionsCount}`);
    if (portfolio.details.length > 0) {
      console.log('    Position Details:');
      portfolio.details.forEach(p => {
        const sign = p.unrealizedPnL >= 0 ? '+' : '';
        console.log(`    • ${p.symbol} (${p.side} ${p.size}) | Entry: $${p.entryPrice} | Mark: $${p.markPrice} | Unrealized: ${sign}$${p.unrealizedPnL.toFixed(2)}`);
      });
    }
  } catch (err) {
    console.error(` ❌ Portfolio calculation error:`, err.message);
  }

  console.log('\n============================================================');
  console.log('   DIAGNOSTICS FINISHED                                     ');
  console.log('============================================================');
}

runDiagnostics().catch(console.error);
