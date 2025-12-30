class FibonacciAnalyzer {
    constructor(candles, currentPrice) {
        this.candles = candles;
        this.currentPrice = currentPrice;
    }

    /**
     * Identifies potential swing points in the last N candles
     * Returns { high, low, trend }
     */
    findSwingPoints(period = 50) {
        if (this.candles.length < period) return null;

        // Analyze the recent chunk
        const recent = this.candles.slice(-period);

        // Find highest high and lowest low
        let maxHigh = -Infinity;
        let minLow = Infinity;
        let maxIndex = -1;
        let minIndex = -1;

        recent.forEach((c, i) => {
            if (c.high > maxHigh) {
                maxHigh = c.high;
                maxIndex = i;
            }
            if (c.low < minLow) {
                minLow = c.low;
                minIndex = i;
            }
        });

        // Determine impulsive move direction
        // If Low comes before High => Upward move to retrace down
        // If High comes before Low => Downward move to retrace up
        let trend = 'UNKNOWN';
        if (minIndex < maxIndex) trend = 'UP';
        else trend = 'DOWN';

        return { high: maxHigh, low: minLow, trend };
    }

    calculateRetracements() {
        const swing = this.findSwingPoints(60); // Look back ~60 candles (15h on 15m)
        if (!swing) return null;

        const range = swing.high - swing.low;
        if (range === 0) return null;

        let levels = {};

        // If trend was UP (Low -> High), we look for pullbacks DOwn
        // Retracement levels from Top
        if (swing.trend === 'UP') {
            levels = {
                trend: 'UP', // Retracing DOWN
                fib236: swing.high - (range * 0.236),
                fib382: swing.high - (range * 0.382),
                fib050: swing.high - (range * 0.5),
                fib618: swing.high - (range * 0.618),
                fib786: swing.high - (range * 0.786)
            };
        }
        // If trend was DOWN (High -> Low), we look for bounces UP
        else {
            levels = {
                trend: 'DOWN', // Retracing UP
                fib236: swing.low + (range * 0.236),
                fib382: swing.low + (range * 0.382),
                fib050: swing.low + (range * 0.5),
                fib618: swing.low + (range * 0.618),
                fib786: swing.low + (range * 0.786)
            };
        }

        return levels;
    }

    getOptimalEntry() {
        const fibs = this.calculateRetracements();
        if (!fibs) return null;

        // Find nearest fib level to current price
        const price = this.currentPrice;
        const levels = [fibs.fib382, fibs.fib050, fibs.fib618];

        // Check finding closest
        const closest = levels.reduce((prev, curr) => {
            return (Math.abs(curr - price) < Math.abs(prev - price) ? curr : prev);
        });

        // Calculate distance %
        const dist = Math.abs(closest - price) / price * 100;

        return {
            nearestLevel: closest,
            distanceKeywords: dist < 0.2 ? 'SPOT_ON' : (dist < 0.5 ? 'NEAR' : 'FAR'),
            trend: fibs.trend,
            levels: fibs // return all levels for context
        };
    }
}

module.exports = FibonacciAnalyzer;
