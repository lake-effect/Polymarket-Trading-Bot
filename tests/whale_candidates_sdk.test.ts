import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhaleCandidates } from '../src/whales/whale_candidates';
import { ClobClient } from '@polymarket/clob-client-v2';
import { logger } from '../src/reporting/logs';

vi.mock('@polymarket/clob-client-v2');
vi.mock('../src/reporting/logs', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockDb = {
  listWhales: vi.fn(),
  upsertCandidate: vi.fn(),
} as any;

const mockConfig = {
  candidateScanIntervalMs: 60000,
  candidateMinVolumeUsd24h: 1000,
  candidateMinTrades24h: 5,
  candidateAutoTrackTopK: 0,
} as any;

describe('WhaleCandidates SDK Migration', () => {
  let candidates: WhaleCandidates;
  let mockSdkClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSdkClient = {
      getTrades: vi.fn(),
    };

    candidates = new WhaleCandidates(
      mockDb,
      mockConfig,
      'https://clob.polymarket.com',
      mockSdkClient as any
    );
  });

  it('should use sdkClient.getTrades and map results correctly', async () => {
    const sdkTrades = [
      {
        id: 'trade-1',
        market: 'market-1',
        asset_id: 'asset-1',
        side: 'BUY',
        size: '10',
        price: '1.5',
        match_time: '2026-06-10T00:00:00Z',
        owner: '0xOwner',
        maker_address: '0xMaker',
      },
    ];
    mockSdkClient.getTrades.mockResolvedValue(sdkTrades);

    const results = await (candidates as any).fetchRecentTrades();

    expect(mockSdkClient.getTrades).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('trade-1');
    expect(results[0].owner).toBe('0xOwner');
  });

  it('should fall back to data-api when SDK fails', async () => {
    mockSdkClient.getTrades.mockRejectedValue(new Error('SDK Failure'));

    // Mock the fallback fetch
    // We need to mock both the Gamma API call (to get markets) and the Data API call (to get trades)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { conditionId: 'market-1' },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            transactionHash: 'tx-1',
            proxyWallet: '0xFallback',
            side: 'BUY',
            size: '1',
            price: '1',
            timestamp: Date.now() / 1000,
            asset: 'asset-1',
          }
        ],
      });

    global.fetch = fetchMock;

    const results = await (candidates as any).fetchRecentTrades();

    expect(mockSdkClient.getTrades).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].owner).toBe('0xFallback');
    expect(logger.debug).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'SDK getTrades failed, falling back to data-api');
  });
});
