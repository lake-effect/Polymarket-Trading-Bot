import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TradeHistory } from '../src/data/trade_history';
import { ClobClient } from '@polymarket/clob-client-v2';

vi.mock('@polymarket/clob-client-v2', () => ({
  ClobClient: vi.fn(),
  Chain: { POLYGON: 137 },
  ApiError: class ApiError extends Error {
    status: number;
    data: any;
    constructor(message: string, status: number, data?: any) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
}));

describe('TradeHistory — SDK integration', () => {
  let mockClient: any;
  let history: TradeHistory;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = { getPricesHistory: vi.fn() };
    vi.mocked(ClobClient).mockImplementation(() => mockClient);
    history = new TradeHistory('https://clob.polymarket.com');
  });

  describe('fetchPriceHistory', () => {
    it('fetches price history with correct params', async () => {
      const mockHistory = [{ price: 0.50, timestamp: 1704067200 }];
      mockClient.getPricesHistory.mockResolvedValue(mockHistory);
      const result = await history.fetchPriceHistory('token_123', '1d', 60);
      expect(mockClient.getPricesHistory).toHaveBeenCalledWith({
        market: 'token_123',
        interval: '1d',
        fidelity: 60,
      });
      expect(result).toEqual(mockHistory);
    });

    it('handles legacy response format with p/t fields', async () => {
      mockClient.getPricesHistory.mockResolvedValue([{ p: 0.50, t: 1704067200 }]);
      const result = await history.fetchPriceHistory('token_123');
      expect(result[0]).toEqual({ price: 0.5, timestamp: 1704067200 });
    });

    it('handles SDK error response', async () => {
      mockClient.getPricesHistory.mockResolvedValue([{ error: 'Not found', status: 404 }]);
      const result = await history.fetchPriceHistory('invalid_token');
      expect(result).toEqual([]);
    });

    it('handles ApiError exception', async () => {
      const apiError = new (require('@polymarket/clob-client-v2').ApiError)('Rate limited', 429);
      mockClient.getPricesHistory.mockRejectedValue(apiError);
      const result = await history.fetchPriceHistory('token_123');
      expect(result).toEqual([]);
    });
  });

  describe('fetchRecentTrades', () => {
    it('returns sampled trades from price history', async () => {
      mockClient.getPricesHistory.mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => ({ price: 0.5 + i * 0.01, timestamp: 1704067200 + i * 300 }))
      );
      const result = await history.fetchRecentTrades('token_123');
      expect(result).toHaveLength(20);
    });
  });

  describe('getClient', () => {
    it('returns the underlying ClobClient instance', () => {
      expect(history.getClient()).toBe(mockClient);
    });
  });
});
