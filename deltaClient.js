/**
 * deltaClient.js
 * Dedicated Delta Exchange India REST API Client
 * 
 * Exclusively tracks UNREALIZED PnL across active open positions.
 * Booked / Realized PnL is completely excluded from Stop-Loss triggers.
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

    // Auto-sync local clock with Delta Exchange India server time
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
    this.mockIteration = 0;
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
   * Calculates overall UNREALIZED PnL across active open positions on Delta India.
   * NOTE: Realized / Booked PnL is strictly ignored.
   * @returns {Promise<{totalUnrealizedPnL: number, positionsCount: number, details: Array}>}
   */
  async getOverallPortfolioPnL() {
    if (this.isDryRun) {
      return this._simulateMockPortfolio();
    }

    const positions = await this.getOpenPositions();
    const activePositions = positions.filter(p => Number(p.size) !== 0);

    let totalUnrealizedPnL = 0;
    const details = [];

    for (const pos of activePositions) {
      const size = Number(pos.size);
      const entryPrice = Number(pos.entry_price || 0);
      const markPrice = Number(pos.mark_price || entryPrice);

      // STRICTLY Unrealized PnL (Booked / Realized PnL is ignored!)
      let unrealizedPnL = 0;
      if (pos.unrealized_pnl !== undefined && pos.unrealized_pnl !== null) {
        unrealizedPnL = Number(pos.unrealized_pnl);
      } else {
        // Fallback formula: (mark - entry) for long, (entry - mark) for short
        unrealizedPnL = size > 0 
          ? (markPrice - entryPrice) * size 
          : (entryPrice - markPrice) * Math.abs(size);
      }

      totalUnrealizedPnL += unrealizedPnL;

      details.push({
        symbol: pos.product_symbol || `Product-${pos.product_id}`,
        productId: pos.product_id,
        size,
        side: size > 0 ? 'BUY' : 'SELL',
        entryPrice,
        markPrice,
        unrealizedPnL: Number(unrealizedPnL.toFixed(2))
      });
    }

    return {
      totalUnrealizedPnL: Number(totalUnrealizedPnL.toFixed(2)),
      totalPnL: Number(totalUnrealizedPnL.toFixed(2)), // For backward compatibility
      positionsCount: activePositions.length,
      details
    };
  }

  /**
   * Emergency Flatten: Closes all active open positions on Delta India
   */
  async closeAllPositions() {
    console.log('[DeltaClient] Initiating Emergency Close for all open positions...');
    const positions = await this.getOpenPositions();
    const active = positions.filter(p => Number(p.size) !== 0);

    if (active.length === 0) {
      return { closed: 0, message: 'No open positions to close' };
    }

    const results = [];
    for (const pos of active) {
      try {
        if (this.isDryRun) {
          console.log(`[DRY-RUN] Closed ${pos.product_symbol || pos.product_id} (Size: ${pos.size})`);
          results.push({ symbol: pos.product_symbol, ok: true });
          continue;
        }

        // Native Delta close endpoint
        const path = '/v2/positions/close';
        const body = { product_id: pos.product_id };
        const headers = DeltaAuth.sign(this.apiKey, this.apiSecret, 'POST', path, body);
        const resp = await this.http.post(path, body, { headers });
        results.push({ symbol: pos.product_symbol, data: resp.data });
      } catch (err) {
        console.error(`[DeltaClient] Failed to close position ${pos.product_id}:`, err.message);
        results.push({ symbol: pos.product_symbol, error: err.message });
      }
    }

    return { closed: results.length, results };
  }

  // ==========================================
  // Mock Simulation Helpers (DRY_RUN)
  // Simulates floating UNREALIZED PnL
  // ==========================================
  _simulateMockPortfolio() {
    this.mockIteration += 1;
    const iter = this.mockIteration;

    let callUnrealized = 0;
    let putUnrealized = 0;

    if (iter === 1) {
      callUnrealized = +0.50; putUnrealized = +0.50; // Total: +$1.00
    } else if (iter === 2) {
      callUnrealized = +1.00; putUnrealized = +1.00; // Total: +$2.00
    } else if (iter === 3) {
      callUnrealized = -2.00; putUnrealized = +1.00; // Total: -$1.00
    } else if (iter === 4) {
      callUnrealized = -6.00; putUnrealized = +1.00; // Total: -$5.00
    } else if (iter === 5) {
      callUnrealized = -10.50; putUnrealized = +3.50; // Total: -$7.00
    } else {
      // Reaches -$10.20 Unrealized Loss
      callUnrealized = -14.00; putUnrealized = +3.80; // Total: -$10.20
    }

    const totalUnrealizedPnL = Number((callUnrealized + putUnrealized).toFixed(2));

    return {
      totalUnrealizedPnL,
      totalPnL: totalUnrealizedPnL,
      positionsCount: 2,
      details: [
        { symbol: 'C-BTC-90000', size: -1, entryPrice: 6.00, markPrice: 6.00 - callUnrealized, unrealizedPnL: callUnrealized },
        { symbol: 'P-BTC-80000', size: -1, entryPrice: 4.00, markPrice: 4.00 - putUnrealized, unrealizedPnL: putUnrealized }
      ]
    };
  }

  _getMockPositions() {
    return [
      { product_id: 101, product_symbol: 'C-BTC-90000', size: -1, entry_price: 6.00, mark_price: 6.00, unrealized_pnl: 0, realized_pnl: 25.00 },
      { product_id: 102, product_symbol: 'P-BTC-80000', size: -1, entry_price: 4.00, mark_price: 4.00, unrealized_pnl: 0, realized_pnl: 10.00 }
    ];
  }
}

module.exports = { DeltaExchangeClient };
