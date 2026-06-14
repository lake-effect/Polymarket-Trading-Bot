import { ClobClient, Chain, ApiError } from '@polymarket/clob-client-v2';
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
    private readonly client: ClobClient;
    private readonly feeRateCache: Map<string, { rate: number; exponent: number }>;

    constructor(clobApi = 'https://clob.polymarket.com') {
        // Read-only endpoints work without authentication
        this.client = new ClobClient({
            host: clobApi,
            chain: Chain.POLYGON,
            throwOnError: false,
        });
        this.feeRateCache = new Map();
    }

    /**
     * Fetches the real-time Level 2 order book for a given CLOB token ID.
     * Both bids and asks are returned sorted by best price first:
     *  - bids: descending (highest price first)
     *  - asks: ascending (lowest price first)
     */
    async fetchOrderBook(clobTokenId: string): Promise<OrderBook | null> {
        try {
            const book = await this.client.getOrderBook(clobTokenId);

            // SDK returns error object on failure
            if ('error' in book) {
                logger.warn({ error: (book as any).error, clobTokenId }, 'CLOB getOrderBook failed');
                return null;
            }

            const bids = (book.bids || [])
                .map(level => ({
                    price: parseFloat(level.price),
                    size: parseFloat(level.size),
                }))
                // Ensure strictly descending for bids (best bid at index 0)
                .sort((a, b) => b.price - a.price);

            const asks = (book.asks || [])
                .map(level => ({
                    price: parseFloat(level.price),
                    size: parseFloat(level.size),
                }))
                // Ensure strictly ascending for asks (best ask at index 0)
                .sort((a, b) => a.price - b.price);

            return { bids, asks };
        } catch (error) {
            if (error instanceof ApiError) {
                logger.warn({ status: error.status, error: error.message, clobTokenId }, 'CLOB getOrderBook API error');
            } else {
                logger.error({ error, clobTokenId }, 'Failed to fetch order book');
            }
            return null;
        }
    }

    /**
     * Fetch multiple order books in a single batch request.
     */
    async fetchOrderBooks(tokenIds: string[]): Promise<Record<string, OrderBook | null>> {
        const results: Record<string, OrderBook | null> = {};
        if (tokenIds.length === 0) return results;

        try {
            const params = tokenIds.map(id => ({
                token_id: id,
                side: 'BUY' as any // side is required by BookParams but not used for full book fetch
            }));
            const books = await this.client.getOrderBooks(params);

            if ('error' in books) {
                logger.warn({ error: (books as any).error }, 'CLOB getOrderBooks failed');
                for (const id of tokenIds) results[id] = null;
                return results;
            }

            for (const book of (books as any[])) {
                const tokenId = book.token_id;
                if ('error' in book) {
                    results[tokenId] = null;
                    continue;
                }

                const bids = (book.bids || [])
                    .map((level: { price: string; size: string }) => ({
                        price: parseFloat(level.price),
                        size: parseFloat(level.size),
                    }))
                    .sort((a, b) => b.price - a.price);

                const asks = (book.asks || [])
                    .map((level: { price: string; size: string }) => ({
                        price: parseFloat(level.price),
                        size: parseFloat(level.size),
                    }))
                    .sort((a, b) => a.price - b.price);

                results[tokenId] = { bids, asks };
            }

            return results;
        } catch (error) {
            if (error instanceof ApiError) {
                logger.warn({ status: error.status, error: error.message }, 'CLOB getOrderBooks API error');
            } else {
                logger.error({ error }, 'Failed to fetch order books batch');
            }
            for (const id of tokenIds) results[id] = null;
            return results;
        }
    }

    /**
     * Resolves the taker fee parameters for a given market token.
     * Caches the result to avoid spamming the Polymarket `/fee-rate` endpoint.
     */
    async fetchFeeRate(clobTokenId: string): Promise<{ rate: number; exponent: number }> {
        if (this.feeRateCache.has(clobTokenId)) {
            return this.feeRateCache.get(clobTokenId)!;
        }

        const defaultFee = { rate: 0, exponent: 0 };

        try {
            const [rateBps, exponent] = await Promise.all([
                this.client.getFeeRateBps(clobTokenId),
                this.client.getFeeExponent(clobTokenId),
            ]);

            // SDK may return error objects
            if ((typeof rateBps === 'object' && rateBps !== null && 'error' in rateBps) || 
                (typeof exponent === 'object' && exponent !== null && 'error' in exponent)) {
                logger.warn({ clobTokenId }, 'CLOB fee rate endpoints returned errors, using defaults');
                this.feeRateCache.set(clobTokenId, defaultFee);
                return defaultFee;
            }

            // Convert from bps (basis points) to raw rate
            const rate = Number(rateBps) / 10_000;
            const exp = Number(exponent);

            const feeInfo = { rate, exponent: exp };
            this.feeRateCache.set(clobTokenId, feeInfo);
            return feeInfo;
        } catch (error) {
            if (error instanceof ApiError) {
                logger.warn({ status: error.status, error: error.message, clobTokenId }, 'CLOB fee rate API error');
            } else {
                logger.error({ error, clobTokenId }, 'Failed to fetch fee rate');
            }
            this.feeRateCache.set(clobTokenId, defaultFee);
            return defaultFee;
        }
    }

    /**
     * Get the ClobClient instance for advanced operations.
     */
    getClient(): ClobClient {
        return this.client;
    }
}
