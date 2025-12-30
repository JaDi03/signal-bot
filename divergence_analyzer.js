const TechnicalIndicators = require('technicalindicators');

class DivergenceAnalyzer {
    constructor(candles, price) {
        this.candles = candles;
        this.currentPrice = price;
    }

    detect() {
        if (this.candles.length < 30) return { bullish: [], bearish: [] };

        const closes = this.candles.map(c => c.close);
        const low = this.candles.map(c => c.low);
        const high = this.candles.map(c => c.high);

        // RSI Logic
        const rsi = TechnicalIndicators.RSI.calculate({ period: 14, values: closes });

        // MACD Logic
        const macdInput = {
            values: closes,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        };
        const macd = TechnicalIndicators.MACD.calculate(macdInput);

        // Pad arrays to match candle length
        // RSI cuts 14, MACD cuts 26
        // We need to align indexes from the end

        const divergences = {
            bullish: [],
            bearish: []
        };

        // Helper to get val at index from end (0 = latest)
        const getVal = (arr, idxFromEnd) => arr[arr.length - 1 - idxFromEnd];
        const getCandle = (idxFromEnd) => this.candles[this.candles.length - 1 - idxFromEnd];

        // Look for pivots in last 20 candles (excluding current forming candle)
        // Simple pivot: High > Prev & High > Next

        // BULLISH DIVERGENCE:
        // Price makes Lower Low, Indicator makes Higher Low

        // BEARISH DIVERGENCE:
        // Price makes Higher High, Indicator makes Lower High

        // We scan pivots in Price and compare with Indicator

        // ... Simplified implementation for reliability ...
        // Check last 2 significant lows for Bullish

        // Find last 2 lows
        let lows = [];
        for (let i = 2; i < 20; i++) {
            if (low[low.length - 1 - i] < low[low.length - 1 - i - 1] &&
                low[low.length - 1 - i] < low[low.length - 1 - i + 1]) {
                lows.push({
                    index: i,
                    value: low[low.length - 1 - i],
                    rsi: rsi[rsi.length - 1 - i]
                    // Note: RSI array is shorter, need careful alignment
                    // RSI length = N - 14. 
                    // rsi[rsi.length - 1] matches closes[closes.length - 1]
                });
            }
        }

        if (lows.length >= 2) {
            const currLow = lows[0]; // Most recent
            const prevLow = lows[1]; // Previous

            // Regular Bullish: Price Lower Low, RSI Higher Low
            if (currLow.value < prevLow.value && currLow.rsi > prevLow.rsi) {
                divergences.bullish.push({
                    type: 'REGULAR_RSI',
                    strength: Math.abs(currLow.rsi - prevLow.rsi),
                    candles: [prevLow.index, currLow.index]
                });
            }
        }

        // Find last 2 highs for Bearish
        let highs = [];
        for (let i = 2; i < 20; i++) {
            if (high[high.length - 1 - i] > high[high.length - 1 - i - 1] &&
                high[high.length - 1 - i] > high[high.length - 1 - i + 1]) {
                highs.push({
                    index: i,
                    value: high[high.length - 1 - i],
                    rsi: rsi[rsi.length - 1 - i]
                });
            }
        }

        if (highs.length >= 2) {
            const currHigh = highs[0];
            const prevHigh = highs[1];

            // Regular Bearish: Price Higher High, RSI Lower High
            if (currHigh.value > prevHigh.value && currHigh.rsi < prevHigh.rsi) {
                divergences.bearish.push({
                    type: 'REGULAR_RSI',
                    strength: Math.abs(prevHigh.rsi - currHigh.rsi),
                    candles: [prevHigh.index, currHigh.index]
                });
            }
        }

        return divergences;
    }
}

module.exports = DivergenceAnalyzer;
