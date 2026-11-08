/**
 * deltaAuth.js
 * Delta Exchange India Authentication & Request Signing
 * Implements HMAC-SHA256 signature with automatic server time synchronization.
 */

const crypto = require('crypto');

class DeltaAuth {
  static serverTimeOffsetMs = 0;

  static setServerTimeOffset(offsetMs) {
    DeltaAuth.serverTimeOffsetMs = offsetMs;
  }

  static getServerTimeOffset() {
    return DeltaAuth.serverTimeOffsetMs;
  }

  static getTimestamp() {
    return Math.floor((Date.now() + DeltaAuth.serverTimeOffsetMs) / 1000).toString();
  }

  /**
   * Generates headers required for authenticated private REST requests to Delta Exchange India.
   * Signature payload: METHOD + TIMESTAMP + PATH + (QUERY_OR_BODY)
   */
  static sign(apiKey, apiSecret, method, path, body = undefined, queryString = '') {
    const timestamp = DeltaAuth.getTimestamp();
    const queryPart = queryString ? (queryString.startsWith('?') ? queryString : `?${queryString}`) : '';
    const fullPath = `${path}${queryPart}`;
    const payloadStr = body && Object.keys(body).length > 0 ? JSON.stringify(body) : '';

    const message = `${method.toUpperCase()}${timestamp}${fullPath}${payloadStr}`;

    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(message)
      .digest('hex');

    return {
      'api-key': apiKey,
      'timestamp': timestamp,
      'signature': signature,
      'Content-Type': 'application/json',
      'User-Agent': 'DeltaStrangleAlgo/1.0'
    };
  }
}

module.exports = { DeltaAuth };

