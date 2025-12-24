// ============================================
// FAIR VALUE GAP (FVG) ANALYZER
// ============================================
// Detects price imbalances (gaps) that tend to get filled
// 3-candle pattern: gap between candle 1 and candle 3

class GapAnalyzer {
    constructor(candles, currentPrice) {
        this.candles = candles;
        this.currentPrice = currentPrice;
        this.gaps = [];
    }

    // Main detection function
    detect() {
        this.findFairValueGaps();
        this.scoreGaps();
        return this.getActiveGaps();
    }

    // Find 3-candle fair value gaps
    findFairValueGaps() {
        // Need at least 3 candles
        for (let i = 2; i < this.candles.length; i++) {
            const candle1 = this.candles[i - 2];
            const candle2 = this.candles[i - 1];
            const candle3 = this.candles[i];

            // Bullish FVG: candle1.high < candle3.low
            if (candle1.high < candle3.low) {
                const gap = {
                    type: 'bullish',
                    top: candle3.low,
                    bottom: candle1.high,
                    size: candle3.low - candle1.high,
                    sizePercent: ((candle3.low - candle1.high) / candle1.high) * 100,
                    index: i,
                    timestamp: candle3.timestamp,
                    volume: candle2.volume, // Middle candle volume
                    filled: 0, // 0 = unfilled, 0.5 = 50% filled, 1 = 100% filled
                    strength: 0,
                    valid: true
                };

                // Check if gap is significant (>0.2%)
                if (gap.sizePercent > 0.2) {
                    this.gaps.push(gap);
                }
            }

            // Bearish FVG: candle1.low > candle3.high
            if (candle1.low > candle3.high) {
                const gap = {
                    type: 'bearish',
                    top: candle1.low,
                    bottom: candle3.high,
                    size: candle1.low - candle3.high,
                    sizePercent: ((candle1.low - candle3.high) / candle3.high) * 100,
                    index: i,
                    timestamp: candle3.timestamp,
                    volume: candle2.volume,
                    filled: 0,
                    strength: 0,
                    valid: true
                };

                if (gap.sizePercent > 0.2) {
                    this.gaps.push(gap);
                }
            }
        }

        // Check fill status for all gaps
        this.checkFillStatus();
    }

    // Check if gaps have been filled
    checkFillStatus() {
        this.gaps.forEach(gap => {
            const subsequentCandles = this.candles.slice(gap.index + 1);

            let maxFill = 0;

            subsequentCandles.forEach(candle => {
                if (gap.type === 'bullish') {
                    // Check how much of the gap was filled by price going down
                    if (candle.low <= gap.top && candle.low >= gap.bottom) {
                        const fillPercent = (gap.top - candle.low) / gap.size;
                        maxFill = Math.max(maxFill, fillPercent);
                    }
                    if (candle.low <= gap.bottom) {
                        maxFill = 1; // 100% filled
                    }
                } else {
                    // Bearish gap - check fill by price going up
                    if (candle.high >= gap.bottom && candle.high <= gap.top) {
                        const fillPercent = (candle.high - gap.bottom) / gap.size;
                        maxFill = Math.max(maxFill, fillPercent);
                    }
                    if (candle.high >= gap.top) {
                        maxFill = 1; // 100% filled
                    }
                }
            });

            gap.filled = maxFill;

            // Invalidate if completely filled
            if (gap.filled >= 0.95) {
                gap.valid = false;
            }
        });
    }

    // Score gaps by significance
    scoreGaps() {
        const now = Date.now();
        const avgVolume = this.candles.reduce((sum, c) => sum + c.volume, 0) / this.candles.length;

        this.gaps.forEach(gap => {
            if (!gap.valid) {
                gap.strength = 0;
                return;
            }

            let score = 0;

            // Gap size (bigger = more significant)
            if (gap.sizePercent > 2) {
                score += 30;
            } else if (gap.sizePercent > 1) {
                score += 20;
            } else if (gap.sizePercent > 0.5) {
                score += 10;
            } else {
                score += 5;
            }

            // Volume during gap creation
            if (gap.volume > avgVolume * 2) {
                score += 20;
            } else if (gap.volume > avgVolume * 1.5) {
                score += 10;
            }

            // Recency (newer gaps more likely to fill soon)
            const daysSince = (now - gap.timestamp) / (1000 * 60 * 60 * 24);
            if (daysSince < 1) {
                score += 20;
            } else if (daysSince < 3) {
                score += 15;
            } else if (daysSince < 7) {
                score += 10;
            } else if (daysSince > 30) {
                score -= 10; // Old gaps less relevant
            }

            // Partial fill status
            if (gap.filled === 0) {
                score += 15; // Completely unfilled
            } else if (gap.filled < 0.5) {
                score += 10; // Partially filled
            } else {
                score += 5; // Mostly filled
            }

            gap.strength = score;
        });

        // Sort by strength
        this.gaps.sort((a, b) => b.strength - a.strength);
    }

    // Get active (unfilled) gaps
    getActiveGaps() {
        const validGaps = this.gaps.filter(g => g.valid);

        const bullish = validGaps
            .filter(g => g.type === 'bullish' && g.bottom < this.currentPrice)
            .sort((a, b) => b.bottom - a.bottom) // Closest first
            .slice(0, 3);

        const bearish = validGaps
            .filter(g => g.type === 'bearish' && g.top > this.currentPrice)
            .sort((a, b) => a.top - b.top) // Closest first
            .slice(0, 3);

        return {
            bullish,
            bearish,
            all: validGaps,
            nearest: this.getNearestGap(validGaps)
        };
    }

    // Get nearest gap
    getNearestGap(gaps = this.gaps.filter(g => g.valid)) {
        if (gaps.length === 0) return null;

        let nearest = null;
        let minDist = Infinity;

        gaps.forEach(gap => {
            const gapMid = (gap.top + gap.bottom) / 2;
            const dist = Math.abs(gapMid - this.currentPrice);

            if (dist < minDist) {
                minDist = dist;
                nearest = gap;
            }
        });

        return nearest;
    }

    // Check if price is in a gap
    isInGap() {
        return this.gaps.some(gap => {
            if (!gap.valid) return false;
            return this.currentPrice >= gap.bottom && this.currentPrice <= gap.top;
        });
    }

    // Get gap for TP target
    getGapForTP(signalType) {
        const gaps = signalType === 'LONG'
            ? this.getActiveGaps().bearish // Target unfilled gap above
            : this.getActiveGaps().bullish; // Target unfilled gap below

        if (gaps.length === 0) return null;

        // Return strongest gap
        return gaps[0];
    }

    // Get fill probability
    getFillProbability(gap) {
        if (!gap || !gap.valid) return 0;

        // Based on strength and time
        const baseProb = Math.min(gap.strength / 100, 0.9);

        // Adjust for partial fills
        if (gap.filled > 0.5) {
            return baseProb * 1.2; // More likely to complete
        }

        return baseProb;
    }
}

// Export
module.exports = GapAnalyzer;
