import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhaleIngestion } from '../src/whales/whale_ingestion';
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

// Mock DB
const mockDb = {
  listWhales: vi.fn(),
  getTradeByTradeId: vi.fn(),
  insertTrades: vi.fn(),
  updateWhale: vi.fn(),
} as any;

const mockConfig = {
  pollIntervalMs: 60000,
  maxRequestsPerMinute: 100,
  metadataCacheTtlMs: 300000,
} as any;

describe('WhaleIngestion SDK Migration', () => {
  let ingestion: WhaleIngestion;
  let mockSdkClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSdkClient = {
      getTrades: vi.fn(),
      getOrderBook: vi.fn(),
    };

    ingestion = new WhaleIngestion(
      mockDb,
      mockConfig,
      'https://clob.polymarket.com',
      'https://gamma-api.polymarket.com',
      mockSdkClient as any
    );
  });

  it('should use sdkClient.getTrades and map results correctly', async () => {
    const sdkTrades = [
      {
        id: 'trade-1',
        taker_order_id: 'taker-1',
        market: 'market-1',
        asset_id: 'asset-1',
        side: 'BUY',
        size: '10',
        fee_rate_bps: '10',
        price: '1.5',
        status: 'FILLED',
        match_time: '2026-06-10T00:00:00Z',
        owner: '0xOwner',
        maker_address: '0xMaker',
        outcome: 'YES',
        type: 'LIMIT',
      },
    ];
    mockSdkClient.getTrades.mockResolvedValue(sdkTrades);

    const results = await (ingestion as any).fetchTradesFromClob('0xOwner', undefined, 100);

    expect(mockSdkClient.getTrades).toHaveBeenCalledWith({
      maker_address: '0xOwner',
      after: undefined,
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('trade-1');
    expect(results[0].side).toBe('BUY');
    expect(results[0].price).toBe('1.5');
  });

  it('should handle SDK errors gracefully and return empty array', async () => {
    mockSdkClient.getTrades.mockRejectedValue(new Error('API Error'));

    const results = await (ingestion as any).fetchTradesFromClob('0xOwner');

    expect(results).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });
});
