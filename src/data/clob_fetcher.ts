import { logger } from '../reporting/logs';

export interface OrderBookLevel {
    price: number;
    size: number;
}

export interface OrderBook {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
}

export class ClobFetcher {
    private readonly clobApi: string;

    constructor(clobApi = 'https://clob.polymarket.com') {
        this.clobApi = clobApi;
    }

    /**
     * Fetches the real-time Level 2 order book for a given CLOB token ID.
     * Both bids and asks are returned sorted by best price first:
     *  - bids: descending (highest price first)
     *  - asks: ascending (lowest price first)
     */
    async fetchOrderBook(clobTokenId: string): Promise<OrderBook | null> {
        const url = `${this.clobApi}/book?token_id=${clobTokenId}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                logger.warn({ status: response.status, clobTokenId }, 'CLOB /book request failed');
                return null;
            }

            const data = await response.json() as {
                bids: Array<{ price: string; size: string }>;
                asks: Array<{ price: string; size: string }>;
            };

            const bids = (data.bids || [])
                .map(level => ({
                    price: parseFloat(level.price),
                    size: parseFloat(level.size),
                }))
                // Ensure strictly descending for bids (best bid at index 0)
                .sort((a, b) => b.price - a.price);

            const asks = (data.asks || [])
                .map(level => ({
                    price: parseFloat(level.price),
                    size: parseFloat(level.size),
                }))
                // Ensure strictly ascending for asks (best ask at index 0)
                .sort((a, b) => a.price - b.price);

            return { bids, asks };
        } catch (error) {
            logger.error({ error, clobTokenId }, 'Failed to fetch order book');
            return null;
        }
    }
}
