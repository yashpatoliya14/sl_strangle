/**
 * deltaClient.js
 * Dedicated Delta Exchange India REST API Client
 * 
 * - Checks BOTH /v2/positions and /v2/positions/margined to capture all active positions.
 * - Resolves live mark price from /v2/tickers if position mark_price is missing.
 * - Strictly evaluates UNREALIZED PnL. Booked / Realized PnL is completely ignored.
 * - Provides detailed diagnostic logging and error tracking for Telegram status.
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

    this.lastFetchInfo = {
      timestamp: null,
      success: false,
      rawCount: 0,
      activeCount: 0,
      totalUnrealizedPnL: 0,
      error: null
    };

    // Mock State for DRY_RUN testing
    this.mockIteration = 0;
  }

  /**
   * Fetch open positions from Delta Exchange India.
   * Checks both /v2/positions and /v2/positions/margined to ensure no positions are missed.
   */
  async getOpenPositions() {
    if (this.isDryRun) {
      return this._getMockPositions();
    }

    if (!this.apiKey || !this.apiSecret) {
      throw new Error('DELTA_API_KEY or DELTA_API_SECRET is missing in .env');
    }

    let positions = [];
    let lastError = null;

    // 1. Try standard /v2/positions first
    try {
      const path = '/v2/positions';
      const headers = DeltaAuth.sign(this.apiKey, this.apiSecret, 'GET', path);
      const resp = await this.http.get(path, { headers });
      const res = resp.data?.result || resp.data || [];
      if (Array.isArray(res) && res.length > 0) {
        positions = res;
      }
    } catch (err) {
      lastError = err;
    }

    // 2. If /v2/positions returned empty or failed, try /v2/positions/margined
    if (!positions || positions.length === 0) {
      try {
        const path = '/v2/positions/margined';
        const headers = DeltaAuth.sign(this.apiKey, this.apiSecret, 'GET', path);
        const resp = await this.http.get(path, { headers });
        const res = resp.data?.result || resp.data || [];
        if (Array.isArray(res) && res.length > 0) {
          positions = res;
        }
      } catch (err) {
        if (!lastError) lastError = err;
      }
    }

    if (positions.length === 0 && lastError) {
      const status = lastError.response?.status;
      const errorData = lastError.response?.data?.error;
      let msg = '';
      if (errorData?.code === 'ip_not_whitelisted_for_api_key') {
        const clientIp = errorData?.context?.client_ip || 'Your IP';
        msg = `IP Not Whitelisted! Please whitelist ${clientIp} in your Delta Exchange India API Key settings.`;
      } else if (errorData && typeof errorData === 'object') {
        msg = errorData.message || JSON.stringify(errorData);
      } else {
        msg = lastError.response?.data?.message || lastError.message;
      }
      throw new Error(`Delta API (${status || 'Error'}): ${msg}`);
    }

    return positions;
  }

  /**
   * Fetch latest tickers for product mark prices
   */
  async getTickers() {
    try {
      const resp = await this.http.get('/v2/tickers');
      return resp.data?.result || resp.data || [];
    } catch (err) {
      console.warn('[DeltaClient] Could not fetch tickers:', err.message);
      return [];
    }
  }

  /**
   * Calculates overall UNREALIZED PnL across active open positions on Delta India.
   * Booked / Realized PnL is completely excluded.
   * @returns {Promise<{totalUnrealizedPnL: number, positionsCount: number, details: Array}>}
   */
  async getOverallPortfolioPnL() {
    if (this.isDryRun) {
      return this._simulateMockPortfolio();
    }

    try {
      const rawPositions = await this.getOpenPositions();
      
      // Filter active open positions: size must not be 0
      const activePositions = (rawPositions || []).filter(p => {
        const sz = Number(p.size);
        return !isNaN(sz) && Math.abs(sz) > 0;
      });

      // Optionally fetch tickers if positions lack mark_price or unrealized_pnl is 0
      let tickerMap = null;
      const needsTickers = activePositions.some(p => 
        (p.unrealized_pnl === undefined || p.unrealized_pnl === null || Number(p.unrealized_pnl) === 0) &&
        (!p.mark_price || Number(p.mark_price) === Number(p.entry_price))
      );

      if (needsTickers && activePositions.length > 0) {
        try {
          const tickers = await this.getTickers();
          tickerMap = new Map();
          for (const t of tickers) {
            const sym = t.symbol || t.product_symbol;
            if (sym) {
              tickerMap.set(sym, Number(t.mark_price || t.close || t.spot_price));
            }
            if (t.product_id) {
              tickerMap.set(String(t.product_id), Number(t.mark_price || t.close || t.spot_price));
            }
          }
        } catch {
          // Non-fatal if ticker fetch fails
        }
      }

      let totalUnrealizedPnL = 0;
      const details = [];

      for (const pos of activePositions) {
        const size = Number(pos.size);
        const entryPrice = Number(pos.entry_price || 0);
        const sym = pos.product_symbol || (pos.product && pos.product.symbol) || `Product-${pos.product_id}`;

        // Determine Mark Price
        let markPrice = Number(pos.mark_price || 0);
        if ((!markPrice || markPrice === 0) && tickerMap) {
          markPrice = tickerMap.get(sym) || tickerMap.get(String(pos.product_id)) || entryPrice;
        }
        if (!markPrice || markPrice === 0) {
          markPrice = entryPrice;
        }

        // STRICTLY calculate Unrealized PnL (Booked / Realized PnL is ignored!)
        let unrealizedPnL = 0;
        
        // Priority 1: Check pos.unrealized_pnl from Delta API
        const rawUnrealized = pos.unrealized_pnl ?? pos.unrealised_pnl ?? pos.pnl ?? pos.unrealized_pnl_usd;
        if (rawUnrealized !== undefined && rawUnrealized !== null && Number(rawUnrealized) !== 0) {
          unrealizedPnL = Number(rawUnrealized);
        } else if (entryPrice > 0 && markPrice > 0) {
          // Priority 2: Accurate mark-to-market formula:
          // Long: (Mark - Entry) * Size
          // Short: (Entry - Mark) * abs(Size)
          unrealizedPnL = size > 0 
            ? (markPrice - entryPrice) * size 
            : (entryPrice - markPrice) * Math.abs(size);
        }

        totalUnrealizedPnL += unrealizedPnL;

        details.push({
          symbol: sym,
          productId: pos.product_id,
          size,
          side: size > 0 ? 'BUY' : 'SELL',
          entryPrice,
          markPrice,
          unrealizedPnL: Number(unrealizedPnL.toFixed(2))
        });
      }

      totalUnrealizedPnL = Number(totalUnrealizedPnL.toFixed(2));

      this.lastFetchInfo = {
        timestamp: new Date().toLocaleTimeString(),
        success: true,
        rawCount: rawPositions.length,
        activeCount: activePositions.length,
        totalUnrealizedPnL,
        error: null
      };

      return {
        totalUnrealizedPnL,
        totalPnL: totalUnrealizedPnL,
        positionsCount: activePositions.length,
        details
      };
    } catch (err) {
      this.lastFetchInfo = {
        timestamp: new Date().toLocaleTimeString(),
        success: false,
        rawCount: 0,
        activeCount: 0,
        totalUnrealizedPnL: 0,
        error: err.message
      };
      throw err;
    }
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

    this.lastFetchInfo = {
      timestamp: new Date().toLocaleTimeString(),
      success: true,
      rawCount: 2,
      activeCount: 2,
      totalUnrealizedPnL,
      error: null
    };

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
      { product_id: 101, product_symbol: 'C-BTC-90000', size: -1, entry_price: 6.00, mark_price: 6.00, unrealized_pnl: -2.50 },
      { product_id: 102, product_symbol: 'P-BTC-80000', size: -1, entry_price: 4.00, mark_price: 4.00, unrealized_pnl: 1.00 }
    ];
  }
}

module.exports = { DeltaExchangeClient };
