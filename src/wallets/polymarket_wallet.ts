import { WalletConfig, WalletState, TradeRecord } from '../types';
import { logger } from '../reporting/logs';
import { ClobClient, Side } from '@polymarket/clob-client-v2';
import { ClobClientProvider } from './clob_client_provider';

export class PolymarketWallet {
  private state: WalletState;
  private readonly trades: TradeRecord[] = [];
  private readonly clientProvider: ClobClientProvider;

  constructor(config: WalletConfig, assignedStrategy: string, clientProvider: ClobClientProvider) {
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
    this.clientProvider = clientProvider;
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
      const client = await this.clientProvider.getAuthenticatedClient();

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
        side: request.side as Side,
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
