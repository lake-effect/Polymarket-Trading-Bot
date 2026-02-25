import { ClobFetcher } from './src/data/clob_fetcher';
import { FillSimulator } from './src/paper_trading/fill_simulator';
import { OrderbookStream } from './src/data/orderbook_stream';
import { MarketData } from './src/types';

async function verifyVwapSlippage() {
    console.log('--- VWAP Slippage Simulator Test ---');

    const clobFetcher = new ClobFetcher('https://clob.polymarket.com');
    const stream = new OrderbookStream('https://gamma-api.polymarket.com', 60000);

    // We mock the stream's cache for a known high-volume market CLOB token ID
    // Using a sample clobTokenId; in real life the stream fetches this.
    const sampleMarketId = 'test-market';
    // Example token ID for a random active market (we just need one to test the book fetch)
    // Let's first fetch *any* active market to get a real token ID
    const fetcher = new (require('./src/data/market_fetcher').MarketFetcher)('https://gamma-api.polymarket.com', 50);
    const markets = await fetcher.fetchSnapshot();

    if (markets.length === 0) {
        console.log('No markets found to test.');
        return;
    }

    // Find a balanced market (probability ~0.5) to see a thicker order book
    const m = markets.find((x: any) => x.outcomePrices[0] > 0.3 && x.outcomePrices[0] < 0.7) || markets[0];
    console.log(`\nTesting liquidity on market: ${m.question}`);

    // Mock the stream getMarket response
    (stream as any).cache = new Map();
    (stream as any).cache.set(m.marketId, m);

    const simulator = new FillSimulator(stream, clobFetcher);

    try {
        const outcome = 'YES';
        const side = 'BUY';
        const price = m.outcomePrices[0] || 0.5;

        // Fetch and display top 3 levels of the book for context
        const tokenId = m.clobTokenIds[0];
        const book = await clobFetcher.fetchOrderBook(tokenId);
        if (book) {
            console.log(`\n--- Order Book Top 3 (Asks) ---`);
            for (let i = 0; i < Math.min(3, book.asks.length); i++) {
                console.log(`  Ask: $${book.asks[i].price.toFixed(4)} | Size: ${book.asks[i].size}`);
            }
        }

        console.log(`\nBase Price (Mid/Last): $${price.toFixed(4)}`);
        console.log(`Outcome: ${outcome}, Side: ${side}`);

        // Test 1: Small order
        let size = 10;
        console.log(`\nTest 1: Ordering $${size} notional...`);
        let fill = await simulator.simulate({ marketId: m.marketId, outcome, side, price, size });
        console.log(`Result: Filled ${fill.size} shares @ $${fill.price.toFixed(4)}`);

        // Test 2: Medium order
        size = 1000;
        console.log(`\nTest 2: Ordering $${size} notional...`);
        fill = await simulator.simulate({ marketId: m.marketId, outcome, side, price, size });
        console.log(`Result: Filled ${fill.size} shares @ $${fill.price.toFixed(4)}`);

        // Test 3: Massive block order (should incur huge slippage or fail)
        size = 100000;
        console.log(`\nTest 3: Ordering $${size} notional for massive slippage...`);
        fill = await simulator.simulate({ marketId: m.marketId, outcome, side, price, size });
        console.log(`Result: Filled ${fill.size} shares @ $${fill.price.toFixed(4)}`);

        // Test 4: Extreme block order to wipe the first level
        size = 300000;
        console.log(`\nTest 4: Ordering $${size} notional to sweet multiple levels...`);
        fill = await simulator.simulate({ marketId: m.marketId, outcome, side, price, size });
        console.log(`Result: Filled ${fill.size} shares @ $${fill.price.toFixed(4)}`);

    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\nError during simulation (Expected if book depleted): ${msg}`);
    }
}

verifyVwapSlippage().catch(console.error);
