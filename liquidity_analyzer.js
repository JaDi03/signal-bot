// ============================================
// LIQUIDITY ZONES ANALYZER
// ============================================
// Detects areas where stop losses cluster (liquidity pools)
// Used for: Entry timing, TP targets, SL placement

class LiquidityAnalyzer {
    constructor(candles, currentPrice) {
        this.candles = candles;
        this.currentPrice = currentPrice;
        this.swingPoints = [];
        this.liquidityZones = [];
    }

    // Main analysis function
    analyze() {
        this.detectSwingPoints();
        this.identifyLiquidityZones();
        this.scoreZones();
        return this.getLiquidityMap();
    }

    // Detect swing highs and lows
    detectSwingPoints() {
        const lookback = 5; // Candles on each side

        for (let i = lookback; i < this.candles.length - lookback; i++) {
            const current = this.candles[i];

            // Check for swing high
            let isSwingHigh = true;
            for (let j = i - lookback; j <= i + lookback; j++) {
                if (j !== i && this.candles[j].high >= current.high) {
                    isSwingHigh = false;
                    break;
                }
            }

            if (isSwingHigh) {
                this.swingPoints.push({
                    type: 'high',
                    price: current.high,
                    index: i,
                    timestamp: current.timestamp,
                    volume: current.volume
                });
            }

            // Check for swing low
            let isSwingLow = true;
            for (let j = i - lookback; j <= i + lookback; j++) {
                if (j !== i && this.candles[j].low <= current.low) {
                    isSwingLow = false;
                    break;
                }
            }

            if (isSwingLow) {
                this.swingPoints.push({
                    type: 'low',
                    price: current.low,
                    index: i,
                    timestamp: current.timestamp,
                    volume: current.volume
                });
            }
        }
    }

    // Group similar price levels into liquidity zones
    identifyLiquidityZones() {
        const tolerance = 0.005; // 0.5% price tolerance
        const zones = [];

        // Group swing points by price proximity
        this.swingPoints.forEach(point => {
            let addedToZone = false;

            for (let zone of zones) {
                const priceDiff = Math.abs(point.price - zone.price) / zone.price;
                if (priceDiff <= tolerance) {
                    zone.touches.push(point);
                    zone.price = (zone.price * zone.touches.length + point.price) / (zone.touches.length + 1);
                    addedToZone = true;
                    break;
                }
            }

            if (!addedToZone) {
                zones.push({
                    price: point.price,
                    type: point.type,
                    touches: [point],
                    tested: false,
                    strength: 0
                });
            }
        });

        // Filter zones with multiple touches (stronger liquidity)
        this.liquidityZones = zones.filter(zone => zone.touches.length >= 2);

        // Add round number levels
        this.addRoundNumberLevels();
    }

    // Add psychological round number levels
    addRoundNumberLevels() {
        const roundNumbers = this.getRoundNumbers(this.currentPrice);

        roundNumbers.forEach(price => {
            // Check if not already in zones
            const exists = this.liquidityZones.some(zone =>
                Math.abs(zone.price - price) / price < 0.001
            );

            if (!exists) {
                this.liquidityZones.push({
                    price: price,
                    type: price > this.currentPrice ? 'high' : 'low',
                    touches: [],
                    tested: false,
                    strength: 0,
                    isRoundNumber: true
                });
            }
        });
    }

    // Get relevant round numbers
    getRoundNumbers(price) {
        const numbers = [];
        const magnitude = Math.pow(10, Math.floor(Math.log10(price)));

        // Add round numbers at different magnitudes
        for (let mult of [0.5, 1, 2, 5, 10]) {
            const roundNum = Math.round(price / (magnitude * mult)) * (magnitude * mult);
            if (Math.abs(roundNum - price) / price < 0.1) { // Within 10%
                numbers.push(roundNum);
            }
        }

        return [...new Set(numbers)]; // Remove duplicates
    }

    // Score liquidity zones by strength
    scoreZones() {
        const now = Date.now();

        this.liquidityZones.forEach(zone => {
            let score = 0;

            // Number of touches (more = stronger)
            score += zone.touches.length * 10;

            // Round number bonus
            if (zone.isRoundNumber) {
                score += 15;
            }

            // Recency (more recent = stronger)
            if (zone.touches.length > 0) {
                const lastTouch = zone.touches[zone.touches.length - 1];
                const daysSinceTouch = (now - lastTouch.timestamp) / (1000 * 60 * 60 * 24);
                score += Math.max(0, 20 - daysSinceTouch * 2);
            }

            // Volume at level
            const avgVolume = zone.touches.reduce((sum, t) => sum + t.volume, 0) / zone.touches.length;
            const overallAvgVolume = this.candles.reduce((sum, c) => sum + c.volume, 0) / this.candles.length;
            if (avgVolume > overallAvgVolume * 1.5) {
                score += 10;
            }

            // Check if tested (price came close recently)
            const recentCandles = this.candles.slice(-20);
            zone.tested = recentCandles.some(c => {
                const dist = Math.abs(c.close - zone.price) / zone.price;
                return dist < 0.002; // Within 0.2%
            });

            if (!zone.tested) {
                score += 10; // Untested zones are stronger
            }

            zone.strength = score;
        });

        // Sort by strength
        this.liquidityZones.sort((a, b) => b.strength - a.strength);
    }

    // Get organized liquidity map
    getLiquidityMap() {
        const above = this.liquidityZones
            .filter(z => z.price > this.currentPrice)
            .sort((a, b) => a.price - b.price) // Closest first
            .slice(0, 5); // Top 5

        const below = this.liquidityZones
            .filter(z => z.price < this.currentPrice)
            .sort((a, b) => b.price - a.price) // Closest first
            .slice(0, 5); // Top 5

        return {
            above,
            below,
            nearest: this.getNearestZone(),
            strongest: this.liquidityZones[0] || null
        };
    }

    // Get nearest liquidity zone
    getNearestZone() {
        let nearest = null;
        let minDist = Infinity;

        this.liquidityZones.forEach(zone => {
            const dist = Math.abs(zone.price - this.currentPrice);
            if (dist < minDist) {
                minDist = dist;
                nearest = zone;
            }
        });

        return nearest;
    }

    // Check if price is near liquidity
    isNearLiquidity(threshold = 0.01) {
        const nearest = this.getNearestZone();
        if (!nearest) return false;

        const dist = Math.abs(nearest.price - this.currentPrice) / this.currentPrice;
        return dist < threshold;
    }

    // Get liquidity sweep probability
    getSweepProbability(direction) {
        const zones = direction === 'up'
            ? this.liquidityZones.filter(z => z.price > this.currentPrice)
            : this.liquidityZones.filter(z => z.price < this.currentPrice);

        if (zones.length === 0) return 0;

        const nearest = zones.sort((a, b) =>
            Math.abs(a.price - this.currentPrice) - Math.abs(b.price - this.currentPrice)
        )[0];

        // Higher strength = higher probability of sweep
        return Math.min(nearest.strength / 100, 1);
    }
}

// Export
module.exports = LiquidityAnalyzer;
