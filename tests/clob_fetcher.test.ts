import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClobFetcher } from '../src/data/clob_fetcher';
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

describe('ClobFetcher — SDK integration', () => {
  let mockClient: any;
  let fetcher: ClobFetcher;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      getOrderBook: vi.fn(),
      getOrderBooks: vi.fn(),
      getFeeRateBps: vi.fn(),
      getFeeExponent: vi.fn(),
    };

    vi.mocked(ClobClient).mockImplementation(() => mockClient);

    fetcher = new ClobFetcher('https://clob.polymarket.com');
  });

  describe('fetchOrderBook', () => {
    it('returns orderbook with sorted bids and asks', async () => {
      mockClient.getOrderBook.mockResolvedValue({
        bids: [
          { price: '0.55', size: '100' },
          { price: '0.50', size: '200' },
          { price: '0.60', size: '50' },
        ],
        asks: [
          { price: '0.60', size: '80' },
          { price: '0.65', size: '120' },
          { price: '0.58', size: '60' },
        ],
      });

      const book = await fetcher.fetchOrderBook('token_123');

      expect(mockClient.getOrderBook).toHaveBeenCalledWith('token_123');
      expect(book).not.toBeNull();
      expect(book!.bids[0].price).toBe(0.6);
      expect(book!.asks[0].price).toBe(0.58);
    });

    it('handles SDK error response', async () => {
      mockClient.getOrderBook.mockResolvedValue({ error: 'Token not found', status: 404 });
      const book = await fetcher.fetchOrderBook('invalid_token');
      expect(book).toBeNull();
    });

    it('handles SDK ApiError exception', async () => {
      const apiError = new (require('@polymarket/clob-client-v2').ApiError)('Rate limited', 429);
      mockClient.getOrderBook.mockRejectedValue(apiError);
      const book = await fetcher.fetchOrderBook('token_123');
      expect(book).toBeNull();
    });

    it('handles generic exception', async () => {
      mockClient.getOrderBook.mockRejectedValue(new Error('Network error'));
      const book = await fetcher.fetchOrderBook('token_123');
      expect(book).toBeNull();
    });
  });

  describe('fetchOrderBooks', () => {
    it('fetches multiple orderbooks in batch', async () => {
      mockClient.getOrderBooks.mockResolvedValue([
        { token_id: 'token_1', bids: [{ price: '0.50', size: '100' }], asks: [{ price: '0.60', size: '80' }] },
        { token_id: 'token_2', bids: [{ price: '0.45', size: '150' }], asks: [{ price: '0.55', size: '90' }] },
      ]);

      const results = await fetcher.fetchOrderBooks(['token_1', 'token_2']);
      expect(mockClient.getOrderBooks).toHaveBeenCalledWith([{ tokenID: 'token_1' }, { tokenID: 'token_2' }]);
      expect(results['token_1']).not.toBeNull();
      expect(results['token_2']).not.toBeNull();
    });

    it('handles partial failures in batch', async () => {
      mockClient.getOrderBooks.mockResolvedValue([
        { token_id: 'token_1', bids: [], asks: [] },
        { token_id: 'token_2', error: 'Not found', status: 404 },
      ]);
      const results = await fetcher.fetchOrderBooks(['token_1', 'token_2']);
      expect(results['token_1']).not.toBeNull();
      expect(results['token_2']).toBeNull();
    });
  });

  describe('fetchFeeRate', () => {
    it('fetches and caches fee rate', async () => {
      mockClient.getFeeRateBps.mockResolvedValue(20);
      mockClient.getFeeExponent.mockResolvedValue(2);
      const fee1 = await fetcher.fetchFeeRate('token_123');
      const fee2 = await fetcher.fetchFeeRate('token_123');
      expect(fee1).toEqual({ rate: 0.002, exponent: 2 });
      expect(fee2).toEqual({ rate: 0.002, exponent: 2 });
      expect(mockClient.getFeeRateBps).toHaveBeenCalledTimes(1);
    });

    it('handles SDK error response', async () => {
      mockClient.getFeeRateBps.mockResolvedValue({ error: 'Not found', status: 404 });
      mockClient.getFeeExponent.mockResolvedValue(2);
      const fee = await fetcher.fetchFeeRate('token_123');
      expect(fee).toEqual({ rate: 0, exponent: 0 });
    });
  });

  describe('getClient', () => {
    it('returns the underlying ClobClient instance', () => {
      expect(fetcher.getClient()).toBe(mockClient);
    });
  });
});
