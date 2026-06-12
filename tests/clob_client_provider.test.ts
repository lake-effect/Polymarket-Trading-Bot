import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClobClientProvider } from '../src/wallets/clob_client_provider';
import { ClobClient } from '@polymarket/clob-client-v2';

vi.mock('@polymarket/clob-client-v2');
vi.mock('../src/reporting/logs', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('ClobClientProvider', () => {
  const MOCK_PK = '0x1234567890123456789012345678901234567890';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('POLYMARKET_PRIVATE_KEY', MOCK_PK);
  });

  it('should throw an error if POLYMARKET_PRIVATE_KEY is missing', async () => {
    vi.stubEnv('POLYMARKET_PRIVATE_KEY', '');
    const provider = new ClobClientProvider();
    await expect(provider.getAuthenticatedClient()).rejects.toThrow(/POLYMARKET_PRIVATE_KEY not set/);
  });

  it('should perform the L1 -> L2 auth flow and return a client', async () => {
    const mockCreateOrDeriveApiKey = vi.fn().mockResolvedValue({ apiKey: 'test-api-key', apiSecret: 'test-secret', apiPassphrase: 'test-pass' });

    // Mock ClobClient constructor to return different things for L1 and L2
    // For simplicity, we'll just make the first instance returned by the mock have the method
    (ClobClient as any).mockImplementation(() => ({
      createOrDeriveApiKey: mockCreateOrDeriveApiKey,
    }));

    const provider = new ClobClientProvider();
    const client = await provider.getAuthenticatedClient();

    expect(ClobClient).toHaveBeenCalledTimes(2); // Once for L1, once for L2
    expect(mockCreateOrDeriveApiKey).toHaveBeenCalled();
    expect(client).toBeDefined();
  });

  it('should cache the authenticated client', async () => {
    const mockCreateOrDeriveApiKey = vi.fn().mockResolvedValue({ apiKey: 'test-api-key', apiSecret: 'test-secret', apiPassphrase: 'test-pass' });
    (ClobClient as any).mockImplementation(() => ({
      createOrDeriveApiKey: mockCreateOrDeriveApiKey,
    }));

    const provider = new ClobClientProvider();
    const client1 = await provider.getAuthenticatedClient();
    const client2 = await provider.getAuthenticatedClient();

    expect(client1).toBe(client2);
    expect(ClobClient).toHaveBeenCalledTimes(2); // Still only 2 because the second call is cached
    expect(mockCreateOrDeriveApiKey).toHaveBeenCalledTimes(1);
  });

  it('should re-authenticate if cache is invalidated', async () => {
    const mockCreateOrDeriveApiKey = vi.fn().mockResolvedValue({ apiKey: 'test-api-key', apiSecret: 'test-secret', apiPassphrase: 'test-pass' });
    (ClobClient as any).mockImplementation(() => ({
      createOrDeriveApiKey: mockCreateOrDeriveApiKey,
    }));

    const provider = new ClobClientProvider();
    await provider.getAuthenticatedClient();
    provider.invalidateCache();
    await provider.getAuthenticatedClient();

    expect(ClobClient).toHaveBeenCalledTimes(4); // 2 for first flow, 2 for second flow
    expect(mockCreateOrDeriveApiKey).toHaveBeenCalledTimes(2);
  });

  it('should throw and log error if auth flow fails', async () => {
    const mockError = new Error('Auth Failed');
    (ClobClient as any).mockImplementation(() => ({
      createOrDeriveApiKey: vi.fn().mockRejectedValue(mockError),
    }));

    const provider = new ClobClientProvider();
    await expect(provider.getAuthenticatedClient()).rejects.toThrow('Auth Failed');
  });
});
