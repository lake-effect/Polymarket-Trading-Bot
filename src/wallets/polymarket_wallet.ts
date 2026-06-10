import { WalletConfig, WalletState, TradeRecord } from '../types';
import { logger } from '../reporting/logs';
import { ClobClient, Chain } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { polygon } from 'viem/chains';

export class PolymarketWallet {
  private state: WalletState;
  private readonly trades: TradeRecord[] = [];
  private authenticatedClient: ClobClient | null = null;

  constructor(config: WalletConfig, assignedStrategy: string) {
    this.state = {
      walletId: config.id,
      mode: 'LIVE',
      assignedStrategy,
      capitalAllocated: config.capital,
      availableBalance: config.capital,
      openPositions: [],
      realizedPnl: 0,
      riskLimits: {
        maxPositionSize: config.riskLimits?.maxPositionSize ?? 100,
        maxExposurePerMarket: config.riskLimits?.maxExposurePerMarket ?? 200,
        maxDailyLoss: config.riskLimits?.maxDailyLoss ?? 100,
        maxOpenTrades: config.riskLimits?.maxOpenTrades ?? 5,
        maxDrawdown: config.riskLimits?.maxDrawdown ?? 0.2,
      },
    };
  }

  /**
   * Initializes the authenticated ClobClient using the L1 Private Key.
   * Following the Polymarket SDK pattern: 
   * 1. Initialize client with L1 Signer.
   * 2. Derive/Create L2 API Keys using L1 authentication.
   * 3. Initialize final client with both L1 Signer and L2 Credentials.
   */
  private async getAuthenticatedClient(): Promise<ClobClient> {
    if (this.authenticatedClient) return this.authenticatedClient;

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

      logger.info('Initializing L1 authentication to derive L2 API keys...');
      
      // Phase 1: L1-only client to fetch L2 credentials
      const l1Client = new ClobClient({
        host: 'https://clob.polymarket.com',
        chain: Chain.POLYGON,
        signer: signer as any,
      });

      // Phase 2: Derive L2 API Key using L1 signature
      const creds = await l1Client.createOrDeriveApiKey();
      logger.info({ walletId: this.state.walletId }, 'Successfully derived L2 API credentials');

      // Phase 3: Full authenticated client for trade execution
      this.authenticatedClient = new ClobClient({
        host: 'https://clob.polymarket.com',
        chain: Chain.POLYGON,
        signer: signer as any,
        creds: creds,
      });

      return this.authenticatedClient;
    } catch (error) {
      logger.error({ error }, 'Failed to authenticate with Polymarket CLOB (L1 -> L2 flow)');
      throw error;
    }
  }

  getState(): WalletState {
    return { ...this.state, openPositions: [...this.state.openPositions] };
  }

  getTradeHistory(): TradeRecord[] {
    return [...this.trades];
  }

  updateBalance(delta: number): void {
    this.state.availableBalance += delta;
  }

  async placeOrder(request: {
    marketId: string;
    outcome: 'YES' | 'NO';
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
  }): Promise<void> {
    try {
      const client = await this.getAuthenticatedClient();

      const marketInfo = await client.getClobMarketInfo(request.marketId);
      const token = marketInfo.t.find(t => t.o === request.outcome);

      if (!token) {
        throw new Error(`Outcome ${request.outcome} not found for market ${request.marketId}`);
      }

      const tokenId = token.t;

      const orderResponse = await client.createAndPostOrder({
        tokenID: tokenId,
        price: request.price,
        size: request.size,
        side: request.side,
      });

      const orderId = orderResponse.id || orderResponse.orderID;

      logger.info(
        {
          walletId: this.state.walletId,
          orderId: orderId,
          marketId: request.marketId,
          tokenID: tokenId,
          price: request.price,
          size: request.size,
        },
        `LIVE order executed successfully ${request.side} ${request.outcome}`,
      );

      this.trades.push({
        orderId: orderId,
        walletId: this.state.walletId,
        marketId: request.marketId,
        outcome: request.outcome,
        side: request.side,
        price: request.price,
        size: request.size,
        cost: request.price * request.size,
        fee: 0,
        feeAsset: 'USDC',
        realizedPnl: 0,
        cumulativePnl: this.state.realizedPnl,
        balanceAfter: this.state.availableBalance - (request.price * request.size),
        timestamp: Date.now(),
      });
      this.updateBalance(-(request.price * request.size));

    } catch (error) {
      logger.error({ error, ...request }, 'LIVE order execution failed');
      throw error;
    }
  }
}
