/**
 * broker.js
 * Broker Integration Layer
 * 
 * Handles fetching open strangle positions, fetching real-time market prices,
 * and executing square-off / exit orders.
 * 
 * Supports both DRY_RUN mode (simulation) and LIVE mode (REST API).
 */

class BrokerAdapter {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || process.env.BROKER_BASE_URL;
    this.apiKey = config.apiKey || process.env.BROKER_API_KEY;
    this.accessToken = config.accessToken || process.env.BROKER_ACCESS_TOKEN;
    this.isDryRun = config.isDryRun ?? (process.env.DRY_RUN === 'true');

    // Mock data for simulation when DRY_RUN = true
    this.mockState = {
      call: {
        symbol: process.env.CALL_SYMBOL || 'BTC-28000-C',
        side: 'SELL',
        quantity: 1,
        entryPrice: 6.00, // Sold at $6
        currentLtp: 6.00
      },
      put: {
        symbol: process.env.PUT_SYMBOL || 'BTC-26000-P',
        side: 'SELL',
        quantity: 1,
        entryPrice: 4.00, // Sold at $4
        currentLtp: 4.00
      },
      iteration: 0
    };
  }

  /**
   * Fetch active Strangle positions (Call Leg + Put Leg)
   * @returns {Promise<{callLeg: object, putLeg: object, maxProfit: number}>}
   */
  async fetchStranglePositions() {
    if (this.isDryRun) {
      return this._getMockStrangle();
    }

    try {
      /**
       * REAL BROKER API CALL:
       * Replace with your broker's open positions endpoint.
       * e.g., Kite Connect: GET /portfolio/positions
       * e.g., Deribit: GET /private/get_positions
       */
      const response = await fetch(`${this.baseUrl}/positions`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch positions: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Find Strangle legs from response
      const callLeg = this._findLeg(data.positions, 'CE', process.env.CALL_SYMBOL);
      const putLeg = this._findLeg(data.positions, 'PE', process.env.PUT_SYMBOL);

      if (!callLeg || !putLeg) {
        throw new Error('Could not identify both Call and Put legs for the Strangle.');
      }

      // Max Profit in a short strangle is the initial premium collected across both legs
      const callCredit = callLeg.entryPrice * callLeg.quantity;
      const putCredit = putLeg.entryPrice * putLeg.quantity;
      const maxProfit = callCredit + putCredit;

      return { callLeg, putLeg, maxProfit };
    } catch (error) {
      console.error('[Broker] Error fetching strangle positions:', error.message);
      throw error;
    }
  }

  /**
   * Fetch latest market prices (LTP) for strangle legs
   * @param {string[]} symbols 
   * @returns {Promise<Map<string, number>>} Map of symbol => LTP
   */
  async fetchCurrentPrices(symbols) {
    if (this.isDryRun) {
      return this._simulateMockTicks();
    }

    try {
      /**
       * REAL BROKER API:
       * Query market quote endpoint or subscribe to WebSocket ticker.
       */
      const queryParams = new URLSearchParams({ symbols: symbols.join(',') });
      const response = await fetch(`${this.baseUrl}/market/quotes?${queryParams.toString()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'X-API-KEY': this.apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch quotes: ${response.statusText}`);
      }

      const quotes = await response.json();
      const priceMap = new Map();

      // Normalize into Map<symbol, ltp>
      for (const quote of quotes.data) {
        priceMap.set(quote.symbol, Number(quote.ltp || quote.last_price));
      }

      return priceMap;
    } catch (error) {
      console.error('[Broker] Error fetching current prices:', error.message);
      throw error;
    }
  }

  /**
   * Close a single leg position (Market square-off)
   * @param {object} leg 
   * @returns {Promise<object>}
   */
  async closePosition(leg) {
    const exitSide = leg.side === 'SELL' ? 'BUY' : 'SELL';

    if (this.isDryRun) {
      console.log(`[DRY-RUN] Executed market ${exitSide} for ${leg.symbol} (Qty: ${leg.quantity}) at ~$${leg.currentLtp}`);
      return { status: 'FILLED', orderId: `MOCK-${Date.now()}`, leg: leg.symbol };
    }

    try {
      /**
       * REAL BROKER ORDER PLACEMENT:
       * POST /orders with MARKET order type
       */
      const orderPayload = {
        symbol: leg.symbol,
        action: exitSide,
        orderType: 'MARKET',
        quantity: leg.quantity,
        product: leg.product || 'MIS' // Intra-day or Normal
      };

      const response = await fetch(`${this.baseUrl}/orders`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(orderPayload)
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(`Order placement failed for ${leg.symbol}: ${JSON.stringify(result)}`);
      }

      console.log(`[LIVE ORDER] Successfully placed exit order for ${leg.symbol}:`, result);
      return result;
    } catch (error) {
      console.error(`[Broker] Failed to close leg ${leg.symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Close both legs of the Strangle simultaneously
   * @param {object} callLeg 
   * @param {object} putLeg 
   * @returns {Promise<object[]>}
   */
  async closeStrangle(callLeg, putLeg) {
    console.log(`[Broker] Closing both Strangle legs (${callLeg.symbol} & ${putLeg.symbol})...`);
    
    // Execute both exit orders concurrently for minimum slippage
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

    if (failures.length > 0) {
      console.error('[CRITICAL] Some legs failed to close:', failures);
    }

    return { successes, failures };
  }

  // ==========================================
  // Mock Simulation Helpers
  // ==========================================
  _getMockStrangle() {
    const callCredit = this.mockState.call.entryPrice * this.mockState.call.quantity;
    const putCredit = this.mockState.put.entryPrice * this.mockState.put.quantity;
    const maxProfit = callCredit + putCredit; // $6 + $4 = $10

    return {
      callLeg: { ...this.mockState.call },
      putLeg: { ...this.mockState.put },
      maxProfit
    };
  }

  _simulateMockTicks() {
    this.mockState.iteration += 1;
    const iter = this.mockState.iteration;
    const priceMap = new Map();

    // Simulation scenario:
    // First 4 ticks: Strangle is profitable (decay happening)
    // Ticks 5+: Sudden adverse move causing Call price to spike until -$10 combined SL is hit
    if (iter === 1) {
      this.mockState.call.currentLtp = 5.50; // +$0.50 PnL
      this.mockState.put.currentLtp = 3.50;  // +$0.50 PnL
    } else if (iter === 2) {
      this.mockState.call.currentLtp = 5.00; // +$1.00 PnL
      this.mockState.put.currentLtp = 3.00;  // +$1.00 PnL (Total +$2.00)
    } else if (iter === 3) {
      this.mockState.call.currentLtp = 4.00; // +$2.00 PnL
      this.mockState.put.currentLtp = 2.50;  // +$1.50 PnL (Total +$3.50)
    } else if (iter === 4) {
      // Market turns against call
      this.mockState.call.currentLtp = 7.00; // -$1.00 PnL
      this.mockState.put.currentLtp = 2.00;  // +$2.00 PnL (Total +$1.00)
    } else if (iter === 5) {
      // Big spike in call
      this.mockState.call.currentLtp = 11.00; // -$5.00 PnL
      this.mockState.put.currentLtp = 1.00;  // +$3.00 PnL (Total -$2.00)
    } else if (iter === 6) {
      // Massive spike in call: $17.50
      // Call PnL: (6 - 17.50) = -$11.50
      // Put PnL:  (4 - 0.50)  = +$3.50
      // Combined PnL = -$8.00
      this.mockState.call.currentLtp = 17.50;
      this.mockState.put.currentLtp = 0.50;
    } else {
      // Tick 7+: Breaches the $10 combined SL!
      // Call LTP: $20.00 -> PnL: 6 - 20 = -$14.00
      // Put LTP:  $0.20  -> PnL: 4 - 0.20 = +$3.80
      // Combined PnL = -$10.20 (<= -$10.00 SL Trigger!)
      this.mockState.call.currentLtp = 20.00;
      this.mockState.put.currentLtp = 0.20;
    }

    priceMap.set(this.mockState.call.symbol, this.mockState.call.currentLtp);
    priceMap.set(this.mockState.put.symbol, this.mockState.put.currentLtp);
    return priceMap;
  }

  _findLeg(positions, type, configuredSymbol) {
    if (configuredSymbol) {
      return positions.find(p => p.symbol === configuredSymbol);
    }
    // Auto-detect by option type if no symbol specified
    return positions.find(p => p.optionType === type || p.symbol.endsWith(type));
  }
}

module.exports = { BrokerAdapter };

