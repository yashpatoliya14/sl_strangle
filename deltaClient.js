/**
 * deltaClient.js
 * Dedicated Delta Exchange India REST API Client
 */

const axios = require('axios');
const { DeltaAuth } = require('./deltaAuth');

class DeltaExchangeClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.DELTA_API_KEY || '';
    this.apiSecret = config.apiSecret || process.env.DELTA_API_SECRET || '';
    this.baseUrl = (config.baseUrl || process.env.DELTA_BASE_URL || 'https://api.india.delta.exchange').replace(/\/+$/, '');
    this.isDryRun = (config.isDryRun ?? process.env.DRY_RUN) === 'true';

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'User-Agent': 'DeltaStrangleAlgo/1.0',
        'Content-Type': 'application/json'
      }
    });

    // Auto-sync server time with Delta Exchange India
    this.http.interceptors.response.use(
      (response) => {
        if (response.headers['date']) {
          const serverTimeMs = new Date(response.headers['date']).getTime();
          DeltaAuth.setServerTimeOffset(serverTimeMs - Date.now());
        }
        return response;
      },
      (error) => {
        if (error.response?.headers?.['date']) {
          const serverTimeMs = new Date(error.response.headers['date']).getTime();
          DeltaAuth.setServerTimeOffset(serverTimeMs - Date.now());
        }
        return Promise.reject(error);
      }
    );

    // Mock State for DRY_RUN testing
    this.mockState = {
      call: {
        productId: 101,
        symbol: process.env.CALL_SYMBOL || 'C-BTC-90000-280226',
        side: 'SELL',
        size: -1,
        entryPrice: 6.00, // Sold at $6.00
        currentLtp: 6.00
      },
      put: {
        productId: 102,
        symbol: process.env.PUT_SYMBOL || 'P-BTC-80000-280226',
        side: 'SELL',
        size: -1,
        entryPrice: 4.00, // Sold at $4.00
        currentLtp: 4.00
      },
      iteration: 0
    };
  }

  /**
   * Fetch open margined positions from Delta Exchange India
   */
  async getOpenPositions() {
    if (this.isDryRun) {
      return this._getMockPositions();
    }

    const path = '/v2/positions/margined';
    const headers = DeltaAuth.sign(this.apiKey, this.apiSecret, 'GET', path);

    try {
      const resp = await this.http.get(path, { headers });
      return resp.data?.result || [];
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      console.error('[DeltaClient] Failed to fetch open positions:', msg);
      throw new Error(`Delta Exchange getOpenPositions error: ${msg}`);
    }
  }

  /**
   * Fetch live tickers for product prices (LTP / Mark Price)
   */
  async getTickers() {
    if (this.isDryRun) {
      return this._simulateMockTickers();
    }

    try {
      const resp = await this.http.get('/v2/tickers');
      return resp.data?.result || [];
    } catch (err) {
      console.error('[DeltaClient] Failed to fetch tickers:', err.message);
      throw err;
    }
  }

  /**
   * Identifies the active Strangle (Short Call & Short Put) from open positions
   */
  async fetchStranglePositions() {
    if (this.isDryRun) {
      const callCredit = this.mockState.call.entryPrice * Math.abs(this.mockState.call.size);
      const putCredit = this.mockState.put.entryPrice * Math.abs(this.mockState.put.size);
      const maxProfit = callCredit + putCredit; // $6 + $4 = $10

      return {
        callLeg: {
          productId: this.mockState.call.productId,
          symbol: this.mockState.call.symbol,
          side: 'SELL',
          quantity: Math.abs(this.mockState.call.size),
          entryPrice: this.mockState.call.entryPrice,
          currentLtp: this.mockState.call.currentLtp
        },
        putLeg: {
          productId: this.mockState.put.productId,
          symbol: this.mockState.put.symbol,
          side: 'SELL',
          quantity: Math.abs(this.mockState.put.size),
          entryPrice: this.mockState.put.entryPrice,
          currentLtp: this.mockState.put.currentLtp
        },
        maxProfit
      };
    }

    const positions = await this.getOpenPositions();
    
    // Filter open short option positions (size < 0)
    const shortPositions = positions.filter(p => Number(p.size) < 0);
    
    const callSymbol = process.env.CALL_SYMBOL;
    const putSymbol = process.env.PUT_SYMBOL;

    let callPos = null;
    let putPos = null;

    if (callSymbol && putSymbol) {
      callPos = shortPositions.find(p => p.product_symbol === callSymbol);
      putPos = shortPositions.find(p => p.product_symbol === putSymbol);
    } else {
      // Auto-detect Call (starts with C- or ends with -C) and Put (starts with P- or ends with -P)
      callPos = shortPositions.find(p => p.product_symbol?.startsWith('C-') || p.product_symbol?.endsWith('-C'));
      putPos = shortPositions.find(p => p.product_symbol?.startsWith('P-') || p.product_symbol?.endsWith('-P'));
    }

    if (!callPos || !putPos) {
      throw new Error(
        `Could not identify both Call and Put legs of Strangle on Delta Exchange India. ` +
        `Found ${shortPositions.length} short option positions.`
      );
    }

    const callQty = Math.abs(Number(callPos.size));
    const putQty = Math.abs(Number(putPos.size));
    const callEntry = Number(callPos.entry_price);
    const putEntry = Number(putPos.entry_price);

    // Max profit is total initial credit collected
    const maxProfit = (callEntry * callQty) + (putEntry * putQty);

    return {
      callLeg: {
        productId: callPos.product_id,
        symbol: callPos.product_symbol,
        side: 'SELL',
        quantity: callQty,
        entryPrice: callEntry,
        currentLtp: Number(callPos.mark_price || callEntry)
      },
      putLeg: {
        productId: putPos.product_id,
        symbol: putPos.product_symbol,
        side: 'SELL',
        quantity: putQty,
        entryPrice: putEntry,
        currentLtp: Number(putPos.mark_price || putEntry)
      },
      maxProfit
    };
  }

  /**
   * Fetch latest price for specific symbols
   * @param {string[]} symbols 
   */
  async fetchCurrentPrices(symbols) {
    if (this.isDryRun) {
      const priceMap = new Map();
      const mockPrices = this._simulateMockTickers();
      for (const p of mockPrices) {
        priceMap.set(p.symbol, p.mark_price);
      }
      return priceMap;
    }

    const tickers = await this.getTickers();
    const priceMap = new Map();

    for (const sym of symbols) {
      const ticker = tickers.find(t => t.symbol === sym || t.product_symbol === sym);
      if (ticker) {
        priceMap.set(sym, Number(ticker.mark_price || ticker.close || ticker.spot_price));
      }
    }

    return priceMap;
  }

  /**
   * Close a position on Delta Exchange India
   */
  async closePosition(leg) {
    if (this.isDryRun) {
      console.log(`[DRY-RUN] Delta India: Executed market close for ${leg.symbol} (Qty: ${leg.quantity}) at ~$${leg.currentLtp}`);
      return { ok: true, orderId: `MOCK-${Date.now()}`, symbol: leg.symbol };
    }

    // 1. Try native position close endpoint: POST /v2/positions/close
    try {
      const path = '/v2/positions/close';
      const body = { product_id: leg.productId };
      const headers = DeltaAuth.sign(this.apiKey, this.apiSecret, 'POST', path, body);

      const resp = await this.http.post(path, body, { headers });
      console.log(`[Delta India] Position close triggered for ${leg.symbol}:`, resp.data?.result || resp.data);
      return resp.data?.result;
    } catch (err) {
      console.warn(`[Delta India] /positions/close failed for ${leg.symbol}, falling back to MARKET BUY order:`, err.message);

      // 2. Fallback: Place opposing MARKET BUY order
      const path = '/v2/orders';
      const order = {
        product_id: leg.productId,
        size: leg.quantity,
        side: 'buy', // buying to cover short
        order_type: 'market_order'
      };

      const headers = DeltaAuth.sign(this.apiKey, this.apiSecret, 'POST', path, order);
      const resp = await this.http.post(path, order, { headers });
      return resp.data?.result;
    }
  }

  /**
   * Close both legs of the Strangle concurrently
   */
  async closeStrangle(callLeg, putLeg) {
    console.log(`[DeltaClient] Closing both legs (${callLeg.symbol} & ${putLeg.symbol}) on Delta Exchange India...`);
    
    const results = await Promise.allSettled([
      this.closePosition(callLeg),
      this.closePosition(putLeg)
    ]);

    const successes = [];
    const failures = [];

    results.forEach((res, index) => {
      const leg = index === 0 ? callLeg : putLeg;
      if (res.status === 'fulfilled') {
        successes.push({ leg: leg.symbol, data: res.value });
      } else {
        failures.push({ leg: leg.symbol, reason: res.reason });
      }
    });

    return { successes, failures };
  }

  // ==========================================
  // Mock Simulation Helpers (DRY_RUN)
  // ==========================================
  _getMockPositions() {
    return [
      {
        product_id: 101,
        product_symbol: this.mockState.call.symbol,
        size: -1,
        entry_price: this.mockState.call.entryPrice,
        mark_price: this.mockState.call.currentLtp
      },
      {
        product_id: 102,
        product_symbol: this.mockState.put.symbol,
        size: -1,
        entry_price: this.mockState.put.entryPrice,
        mark_price: this.mockState.put.currentLtp
      }
    ];
  }

  _simulateMockTickers() {
    this.mockState.iteration += 1;
    const iter = this.mockState.iteration;

    if (iter === 1) {
      this.mockState.call.currentLtp = 5.50; // +$0.50 PnL
      this.mockState.put.currentLtp = 3.50;  // +$0.50 PnL (Total: +$1.00)
    } else if (iter === 2) {
      this.mockState.call.currentLtp = 5.00; // +$1.00 PnL
      this.mockState.put.currentLtp = 3.00;  // +$1.00 PnL (Total: +$2.00)
    } else if (iter === 3) {
      this.mockState.call.currentLtp = 7.00; // -$1.00 PnL
      this.mockState.put.currentLtp = 2.00;  // +$2.00 PnL (Total: +$1.00)
    } else if (iter === 4) {
      this.mockState.call.currentLtp = 12.00; // -$6.00 PnL
      this.mockState.put.currentLtp = 1.00;   // +$3.00 PnL (Total: -$3.00)
    } else if (iter === 5) {
      this.mockState.call.currentLtp = 16.50; // -$10.50 PnL
      this.mockState.put.currentLtp = 0.50;   // +$3.50 PnL (Total: -$7.00)
    } else {
      // Breaches $10 combined SL!
      this.mockState.call.currentLtp = 20.00; // -$14.00 PnL
      this.mockState.put.currentLtp = 0.20;   // +$3.80 PnL (Total: -$10.20 <= -$10.00)
    }

    return [
      { symbol: this.mockState.call.symbol, mark_price: this.mockState.call.currentLtp },
      { symbol: this.mockState.put.symbol, mark_price: this.mockState.put.currentLtp }
    ];
  }
}

module.exports = { DeltaExchangeClient };
