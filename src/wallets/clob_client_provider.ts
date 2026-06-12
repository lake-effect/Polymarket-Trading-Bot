import { ClobClient, Chain } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { polygon } from 'viem/chains';
import { logger } from '../reporting/logs';

/**
 * ClobClientProvider manages the L1 -> L2 authentication flow for the Polymarket CLOB SDK.
 * It derives L2 API credentials using an L1 private key and caches the authenticated client.
 */
export class ClobClientProvider {
  private authenticatedClient: ClobClient | null = null;

  /**
   * Returns an authenticated ClobClient.
   * If not already cached, it performs the L1 -> L2 authentication flow.
   */
  async getAuthenticatedClient(): Promise<ClobClient> {
    if (this.authenticatedClient) {
      return this.authenticatedClient;
    }

    const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error(
        'POLYMARKET_PRIVATE_KEY not set; L1 authentication is required to obtain L2 API credentials.'
      );
    }

    try {
      const signer = createWalletClient({
        account: `0x${privateKey.replace('0x', '')}`,
        chain: polygon,
        transport: http(),
      });

      logger.info('ClobClientProvider: Initializing L1 authentication to derive L2 API keys...');

      // Phase 1: L1-only client to fetch L2 credentials
      const l1Client = new ClobClient({
        host: 'https://clob.polymarket.com',
        chain: Chain.POLYGON,
        signer: signer as any,
      });

      // Phase 2: Derive L2 API Key using L1 signature
      const creds = await l1Client.createOrDeriveApiKey();
      logger.info('ClobClientProvider: Successfully derived L2 API credentials');

      // Phase 3: Full authenticated client for trade execution
      this.authenticatedClient = new ClobClient({
        host: 'https://clob.polymarket.com',
        chain: Chain.POLYGON,
        signer: signer as any,
        creds: creds,
      });

      return this.authenticatedClient;
    } catch (error) {
      logger.error({ error }, 'ClobClientProvider: Failed to authenticate with Polymarket CLOB (L1 -> L2 flow)');
      throw error;
    }
  }

  /**
   * Forces a re-authentication by clearing the cached client.
   */
  invalidateCache(): void {
    this.authenticatedClient = null;
    logger.debug('ClobClientProvider: Authenticated client cache invalidated');
  }
}
