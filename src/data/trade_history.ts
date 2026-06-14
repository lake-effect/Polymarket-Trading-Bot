import { ClobClient, Chain, ApiError } from '@polymarket/clob-client-v2';
import { logger } from '../reporting/logs';

export interface PricePoint {
  price: number;
  timestamp: number;
}

/**
 * Fetches real price history from the Polymarket CLOB API.
 * Uses the official @polymarket/clob-client-v2 SDK.
 */
interface RawPricePoint {
  price?: number | string;
  p?: number | string;
  timestamp?: number | string;
  t?: number | string;
}

export class TradeHistory {
  private readonly client: ClobClient;

  constructor(clobApi = 'https://clob.polymarket.com') {
    this.client = new ClobClient({
      host: clobApi,
      chain: Chain.POLYGON,
      throwOnError: false,
    });
  }

  /**
   * Fetch recent price history for a market.
   * @param clobTokenId – the CLOB token ID (not the market's numeric ID)
   * @param interval – timeframe: '1d','1w','1m','all'  (default '1d')
   * @param fidelity – seconds between data points (default 60)
   */
  async fetchPriceHistory(
    clobTokenId: string,
    interval = '1d',
    fidelity = 60,
  ): Promise<PricePoint[]> {
    try {
      const history = await this.client.getPricesHistory({
        market: clobTokenId,
        interval: interval as any, // SDK type is stricter than needed
        fidelity,
      });

      // SDK returns error object on failure
      if (Array.isArray(history) && history.length > 0 && 'error' in history[0]) {
        logger.warn({ error: (history[0] as any).error, clobTokenId }, 'CLOB getPricesHistory failed');
        return [];
      }

      if (!Array.isArray(history)) {
        logger.warn({ response: history, clobTokenId }, 'CLOB getPricesHistory returned non-array');
        return [];
      }

      return (history as RawPricePoint[]).map((h) => ({
        price: Number(h.price ?? h.p ?? 0),
        timestamp: Number(h.timestamp ?? h.t ?? 0),
      }));
    } catch (error) {
      if (error instanceof ApiError) {
        logger.warn({ status: error.status, error: error.message, clobTokenId }, 'CLOB getPricesHistory API error');
      } else {
        logger.error({ error, clobTokenId }, 'Failed to fetch price history');
      }
      return [];
    }
  }

  /**
   * Legacy compatibility wrapper – returns simple {price, size} tuples
   * by sampling from real price history.
   */
  async fetchRecentTrades(clobTokenId: string): Promise<Array<{ price: number; size: number }>> {
    const history = await this.fetchPriceHistory(clobTokenId, '1d', 300);
    if (history.length === 0) return [];
    // Take the last 20 price points and approximate size from the interval
    return history.slice(-20).map((h) => ({ price: h.price, size: 10 }));
  }

  /**
   * Get the ClobClient instance for advanced operations.
   */
  getClient(): ClobClient {
    return this.client;
  }
}
