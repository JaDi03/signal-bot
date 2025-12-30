// ============================================
// GAP & FAIR VALUE GAP (FVG) ANALYZER
// ============================================
// Detects classic gaps + Fair Value Gaps (3-candle imbalance)
// FVG: Very powerful SMC concept for entries and targets

class GapAnalyzer {
    constructor(candles, currentPrice) {
        this.candles = candles;
        this.currentPrice = currentPrice;
        this.gaps = [];        // Classic gaps + FVG
        this.fvgs = [];        // Solo FVGs (para acceso rápido)
    }

    // Main detection function
    detect() {
        this.findClassicGaps();
        this.findFairValueGaps();  // ← NUEVA DETECCIÓN FVG
        this.scoreGaps();
        return this.getActiveGaps();
    }

    // Classic gaps (overnight or large moves)
    findClassicGaps() {
        for (let i = 1; i < this.candles.length; i++) {
            const prev = this.candles[i - 1];
            const curr = this.candles[i];

            if (curr.low > prev.high) {
                this.gaps.push({
                    type: 'bullish',
                    top: curr.low,
                    bottom: prev.high,
                    size: curr.low - prev.high,
                    sizePercent: ((curr.low - prev.high) / prev.high) * 100,
                    index: i,
                    timestamp: curr.timestamp,
                    volume: curr.volume,
                    filled: 0,
                    strength: 0,
                    valid: true,
                    isFVG: false
                });
            }

            if (curr.high < prev.low) {
                this.gaps.push({
                    type: 'bearish',
                    top: prev.low,
                    bottom: curr.high,
                    size: prev.low - curr.high,
                    sizePercent: ((prev.low - curr.high) / curr.high) * 100,
                    index: i,
                    timestamp: curr.timestamp,
                    volume: curr.volume,
                    filled: 0,
                    strength: 0,
                    valid: true,
                    isFVG: false
                });
            }
        }
    }

    // ========== NUEVA: DETECCIÓN DE FAIR VALUE GAPS (FVG) ==========
    findFairValueGaps() {
        for (let i = 2; i < this.candles.length; i++) {
            const candle1 = this.candles[i - 2];
            const candle2 = this.candles[i - 1]; // Middle candle (impulso)
            const candle3 = this.candles[i];

            // Bullish FVG
            if (candle1.high < candle3.low) {
                const fvg = {
                    type: 'bullish',
                    top: candle3.low,
                    bottom: candle1.high,
                    size: candle3.low - candle1.high,
                    sizePercent: ((candle3.low - candle1.high) / candle1.high) * 100,
                    index: i,
                    timestamp: candle3.timestamp,
                    volume: candle2.volume,
                    filled: 0,
                    strength: 0,
                    valid: true,
                    isFVG: true
                };

                if (fvg.sizePercent > 0.2) {
                    this.gaps.push(fvg);
                    this.fvgs.push(fvg);
                }
            }

            // Bearish FVG
            if (candle1.low > candle3.high) {
                const fvg = {
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
                    valid: true,
                    isFVG: true
                };

                if (fvg.sizePercent > 0.2) {
                    this.gaps.push(fvg);
                    this.fvgs.push(fvg);
                }
            }
        }
    }

    // Check fill status (igual para gaps y FVG)
    checkFillStatus() {
        this.gaps.forEach(gap => {
            const subsequentCandles = this.candles.slice(gap.index + 1);

            let maxFill = 0;

            subsequentCandles.forEach(candle => {
                if (gap.type === 'bullish') {
                    if (candle.low <= gap.top && candle.low >= gap.bottom) {
                        const fillPercent = (gap.top - candle.low) / gap.size;
                        maxFill = Math.max(maxFill, fillPercent);
                    }
                    if (candle.low <= gap.bottom) maxFill = 1;
                } else {
                    if (candle.high >= gap.bottom && candle.high <= gap.top) {
                        const fillPercent = (candle.high - gap.bottom) / gap.size;
                        maxFill = Math.max(maxFill, fillPercent);
                    }
                    if (candle.high >= gap.top) maxFill = 1;
                }
            });

            gap.filled = maxFill;
            if (gap.filled >= 0.95) gap.valid = false;
        });
    }

    // Score gaps (más peso a FVG)
    scoreGaps() {
        const now = Date.now();
        const avgVolume = this.candles.reduce((sum, c) => sum + c.volume, 0) / this.candles.length;

        this.gaps.forEach(gap => {
            if (!gap.valid) {
                gap.strength = 0;
                return;
            }

            let score = 0;

            // FVG tiene bonus base
            if (gap.isFVG) score += 20;

            // Size
            if (gap.sizePercent > 2) score += 30;
            else if (gap.sizePercent > 1) score += 20;
            else if (gap.sizePercent > 0.5) score += 10;
            else score += 5;

            // Volume
            if (gap.volume > avgVolume * 2) score += 20;
            else if (gap.volume > avgVolume * 1.5) score += 10;

            // Recency
            const daysSince = (now - gap.timestamp) / (1000 * 60 * 60 * 24);
            if (daysSince < 1) score += 20;
            else if (daysSince < 3) score += 15;
            else if (daysSince < 7) score += 10;

            // Unfilled bonus
            if (gap.filled === 0) score += 15;
            else if (gap.filled < 0.5) score += 10;

            gap.strength = Math.min(score, 100);
        });

        this.gaps.sort((a, b) => b.strength - a.strength);
    }

    // Get active gaps
    getActiveGaps() {
        const validGaps = this.gaps.filter(g => g.valid);

        const bullish = validGaps
            .filter(g => g.type === 'bullish' && g.bottom < this.currentPrice)
            .sort((a, b) => b.bottom - a.bottom)
            .slice(0, 3);

        const bearish = validGaps
            .filter(g => g.type === 'bearish' && g.top > this.currentPrice)
            .sort((a, b) => a.top - b.top)
            .slice(0, 3);

        const fvgs = this.fvgs.filter(g => g.valid);

        return {
            bullish,
            bearish,
            all: validGaps,
            fvgs: fvgs,
            nearest: this.getNearestGap(validGaps),
            nearestFVG: this.getNearestGap(fvgs)
        };
    }

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

    isInGap() {
        return this.gaps.some(gap => gap.valid && this.currentPrice >= gap.bottom && this.currentPrice <= gap.top);
    }

    getGapForTP(signalType) {
        const gaps = signalType === 'LONG' ? this.getActiveGaps().bearish : this.getActiveGaps().bullish;
        return gaps.length > 0 ? gaps[0] : null;
    }

    getFillProbability(gap) {
        if (!gap || !gap.valid) return 0;
        const baseProb = Math.min(gap.strength / 100, 0.9);
        return gap.filled > 0.5 ? baseProb * 1.2 : baseProb;
    }
}

// Export
module.exports = GapAnalyzer;