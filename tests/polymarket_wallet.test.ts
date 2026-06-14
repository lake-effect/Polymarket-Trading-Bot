import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolymarketWallet } from '../src/wallets/polymarket_wallet';
import { ClobClient, Chain } from '@polymarket/clob-client-v2';
import { createWalletClient } from 'viem';

// Mock @polymarket/clob-client-v2
vi.mock('@polymarket/clob-client-v2', () => {
  const ClobClientMock = vi.fn();
  return {
    ClobClient: ClobClientMock,
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
  };
});

// Mock viem
vi.mock('viem', () => ({
  createWalletClient: vi.fn(),
  http: vi.fn(() => ({})),
}));
vi.mock('viem/chains', () => ({
  polygon: { id: 137, name: 'Polygon' },
}));

describe('PolymarketWallet', () => {
  let wallet: PolymarketWallet;
  let mockClient: any;
  let mockClientProvider: any;
  const walletConfig = {
    id: 'wallet_1',
    mode: 'LIVE' as const,
    privateKey: '0x1234567890123456789012345678901234567890',
    capital: 1000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('POLYMARKET_PRIVATE_KEY', '0x1234567890123456789012345678901234567890');

    mockClient = {
      createOrDeriveApiKey: vi.fn(),
      getClobMarketInfo: vi.fn(),
      createAndPostOrder: vi.fn(),
    };

    mockClientProvider = {
      getAuthenticatedClient: vi.fn().mockResolvedValue(mockClient),
    };

    // Default: ClobClient constructor returns mockClient
    vi.mocked(ClobClient).mockImplementation(() => mockClient);
    vi.mocked(createWalletClient).mockReturnValue({} as any);

    wallet = new PolymarketWallet(walletConfig, 'momentum', mockClientProvider);
  });

  describe('Order Placement', () => {
    const orderRequest = {
      marketId: 'market_123',
      outcome: 'YES',
      price: 0.5,
      size: 10,
      side: 'BUY' as any,
    };

    it('successfully places a LIVE order and updates state', async () => {
      mockClient.createOrDeriveApiKey.mockResolvedValue({});
      mockClient.getClobMarketInfo.mockResolvedValue({
        t: [{ o: 'YES', t: 'token_yes_123' }],
      });
      mockClient.createAndPostOrder.mockResolvedValue({ id: 'order_999' });

      await wallet.placeOrder(orderRequest);

      expect(mockClient.createAndPostOrder).toHaveBeenCalledWith({
        tokenID: 'token_yes_123',
        price: 0.5,
        size: 10,
        side: 'BUY',
      });

      const state = wallet.getState();
      expect(state.availableBalance).toBe(1000 - (0.5 * 10));
      expect(wallet.getTradeHistory()).toHaveLength(1);
      expect(wallet.getTradeHistory()[0].orderId).toBe('order_999');
    });

    it('throws error if outcome is not found in market info', async () => {
      mockClient.createOrDeriveApiKey.mockResolvedValue({});
      mockClient.getClobMarketInfo.mockResolvedValue({
        t: [{ o: 'NO', t: 'token_no_123' }],
      });

      await expect(wallet.placeOrder(orderRequest)).rejects.toThrow(
        'Outcome YES not found for market market_123'
      );
    });

    it('throws error and does not record trade if SDK fails to post order', async () => {
      mockClient.createOrDeriveApiKey.mockResolvedValue({});
      mockClient.getClobMarketInfo.mockResolvedValue({
        t: [{ o: 'YES', t: 'token_yes_123' }],
      });
      mockClient.createAndPostOrder.mockRejectedValue(new Error('Network error'));

      await expect(wallet.placeOrder(orderRequest)).rejects.toThrow('Network error');
      expect(wallet.getTradeHistory()).toHaveLength(0);
      expect(wallet.getState().availableBalance).toBe(1000);
    });
  });

  describe('State Management', () => {
    it('getState returns a shallow copy', () => {
      const state = wallet.getState();
      state.availableBalance = 99999;

      expect(wallet.getState().availableBalance).toBe(1000);
    });

    it('getTradeHistory returns a copy of the trades array', async () => {
      mockClient.createOrDeriveApiKey.mockResolvedValue({});
      mockClient.getClobMarketInfo.mockResolvedValue({
        t: [{ o: 'YES', t: 'token_yes_123' }],
      });
      mockClient.createAndPostOrder.mockResolvedValue({ id: 'order_1' });

      await wallet.placeOrder({
        marketId: 'm1', outcome: 'YES', price: 1, size: 1, side: 'BUY' as any,
      });

      const history = wallet.getTradeHistory();
      history.push({} as any);

      expect(wallet.getTradeHistory()).toHaveLength(1);
    });
  });
});
