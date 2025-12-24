// ============================================
// ORDER BLOCK DETECTOR
// ============================================
// Identifies institutional accumulation/distribution zones
// Last opposite candle before strong move = order block

class OrderBlockDetector {
    constructor(candles, currentPrice) {
        this.candles = candles;
        this.currentPrice = currentPrice;
        this.orderBlocks = [];
    }

    // Main detection function
    detect() {
        this.findOrderBlocks();
        this.scoreBlocks();
        return this.getActiveBlocks();
    }

    // Find order blocks in price history
    findOrderBlocks() {
        const minMovePercent = 0.02; // 2% minimum move to qualify
        const lookback = 100; // Analyze last 100 candles

        for (let i = 3; i < Math.min(lookback, this.candles.length - 1); i++) {
            // Check for bullish order block (last red before rally)
            const bullishOB = this.detectBullishOB(i, minMovePercent);
            if (bullishOB) {
                this.orderBlocks.push(bullishOB);
            }

            // Check for bearish order block (last green before drop)
            const bearishOB = this.detectBearishOB(i, minMovePercent);
            if (bearishOB) {
                this.orderBlocks.push(bearishOB);
            }
        }
    }

    // Detect bullish order block
    detectBullishOB(index, minMove) {
        const current = this.candles[index];
        const isBearishCandle = current.close < current.open;

        if (!isBearishCandle) return null;

        // Check for strong bullish move after this candle
        let highestHigh = current.high;
        let moveFound = false;

        for (let j = index + 1; j < Math.min(index + 10, this.candles.length); j++) {
            if (this.candles[j].high > highestHigh) {
                highestHigh = this.candles[j].high;
            }

            const movePercent = (highestHigh - current.low) / current.low;
            if (movePercent >= minMove) {
                moveFound = true;
                break;
            }
        }

        if (!moveFound) return null;

        return {
            type: 'bullish',
            top: current.open,
            bottom: current.close,
            high: current.high,
            low: current.low,
            index: index,
            timestamp: current.timestamp,
            volume: current.volume,
            moveSize: (highestHigh - current.low) / current.low,
            tested: false,
            strength: 0,
            valid: true
        };
    }

    // Detect bearish order block
    detectBearishOB(index, minMove) {
        const current = this.candles[index];
        const isBullishCandle = current.close > current.open;

        if (!isBullishCandle) return null;

        // Check for strong bearish move after this candle
        let lowestLow = current.low;
        let moveFound = false;

        for (let j = index + 1; j < Math.min(index + 10, this.candles.length); j++) {
            if (this.candles[j].low < lowestLow) {
                lowestLow = this.candles[j].low;
            }

            const movePercent = (current.high - lowestLow) / current.high;
            if (movePercent >= minMove) {
                moveFound = true;
                break;
            }
        }

        if (!moveFound) return null;

        return {
            type: 'bearish',
            top: current.close,
            bottom: current.open,
            high: current.high,
            low: current.low,
            index: index,
            timestamp: current.timestamp,
            volume: current.volume,
            moveSize: (current.high - lowestLow) / current.high,
            tested: false,
            strength: 0,
            valid: true
        };
    }

    // Score order blocks by strength
    scoreBlocks() {
        const now = Date.now();
        const avgVolume = this.candles.reduce((sum, c) => sum + c.volume, 0) / this.candles.length;

        this.orderBlocks.forEach(block => {
            let score = 0;

            // Size of subsequent move (bigger = stronger)
            score += Math.min(block.moveSize * 100, 30);

            // Volume in order block candle
            if (block.volume > avgVolume * 1.5) {
                score += 20;
            } else if (block.volume > avgVolume) {
                score += 10;
            }

            // Recency (more recent = stronger, but not too recent)
            const daysSince = (now - block.timestamp) / (1000 * 60 * 60 * 24);
            if (daysSince < 1) {
                score += 15;
            } else if (daysSince < 7) {
                score += 10;
            } else if (daysSince < 30) {
                score += 5;
            }

            // Check if tested
            const recentCandles = this.candles.slice(block.index + 1);
            let testCount = 0;

            recentCandles.forEach(candle => {
                const touchedBlock = block.type === 'bullish'
                    ? candle.low <= block.top && candle.low >= block.bottom
                    : candle.high >= block.bottom && candle.high <= block.top;

                if (touchedBlock) {
                    testCount++;
                }
            });

            block.tested = testCount > 0;

            // Untested blocks are stronger
            if (!block.tested) {
                score += 15;
            } else if (testCount === 1) {
                score += 10; // One test and held = strong
            } else if (testCount > 3) {
                score -= 10; // Too many tests = weak
                block.valid = false;
            }

            // Invalidate if price closed through block
            const brokeThrough = recentCandles.some(candle => {
                return block.type === 'bullish'
                    ? candle.close < block.bottom
                    : candle.close > block.top;
            });

            if (brokeThrough) {
                block.valid = false;
                score = 0;
            }

            block.strength = score;
        });

        // Sort by strength
        this.orderBlocks.sort((a, b) => b.strength - a.strength);
    }

    // Get active (valid) order blocks
    getActiveBlocks() {
        const validBlocks = this.orderBlocks.filter(b => b.valid);

        const bullish = validBlocks
            .filter(b => b.type === 'bullish' && b.top < this.currentPrice)
            .sort((a, b) => b.top - a.top) // Closest first
            .slice(0, 3);

        const bearish = validBlocks
            .filter(b => b.type === 'bearish' && b.bottom > this.currentPrice)
            .sort((a, b) => a.bottom - b.bottom) // Closest first
            .slice(0, 3);

        return {
            bullish,
            bearish,
            all: validBlocks,
            nearest: this.getNearestBlock(validBlocks)
        };
    }

    // Get nearest order block
    getNearestBlock(blocks = this.orderBlocks.filter(b => b.valid)) {
        if (blocks.length === 0) return null;

        let nearest = null;
        let minDist = Infinity;

        blocks.forEach(block => {
            const blockPrice = block.type === 'bullish'
                ? (block.top + block.bottom) / 2
                : (block.top + block.bottom) / 2;

            const dist = Math.abs(blockPrice - this.currentPrice);
            if (dist < minDist) {
                minDist = dist;
                nearest = block;
            }
        });

        return nearest;
    }

    // Check if price is testing an order block
    isTestingBlock(tolerance = 0.005) {
        const nearest = this.getNearestBlock();
        if (!nearest) return false;

        const inBlock = nearest.type === 'bullish'
            ? this.currentPrice >= nearest.bottom && this.currentPrice <= nearest.top
            : this.currentPrice >= nearest.bottom && this.currentPrice <= nearest.top;

        if (inBlock) return true;

        // Check if very close
        const blockPrice = (nearest.top + nearest.bottom) / 2;
        const dist = Math.abs(this.currentPrice - blockPrice) / this.currentPrice;

        return dist < tolerance;
    }

    // Get order block for SL placement
    getBlockForSL(signalType) {
        const blocks = signalType === 'LONG'
            ? this.getActiveBlocks().bullish
            : this.getActiveBlocks().bearish;

        if (blocks.length === 0) return null;

        // Return strongest block below/above current price
        return blocks[0];
    }
}

// Export
module.exports = OrderBlockDetector;
