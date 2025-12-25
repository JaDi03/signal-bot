// ============================================
// NEWS & SENTIMENT ANALYZER
// ============================================
// Integrates macro news, Fear & Greed Index, and sentiment analysis
// Helps bot avoid trading during high-risk events

const axios = require('axios');

class NewsAnalyzer {
    constructor() {
        this.cache = {
            fearGreed: null,
            news: null,
            lastUpdate: 0
        };
        this.cacheDuration = 60 * 60 * 1000; // 1 hour cache
    }

    // Main analysis function
    async analyze() {
        try {
            const fearGreed = await this.getFearGreedIndex();
            const newsSentiment = await this.getNewsSentiment();

            return {
                fearGreed,
                newsSentiment,
                overallSentiment: this.calculateOverallSentiment(fearGreed, newsSentiment),
                shouldPauseTrading: this.shouldPauseTrading(fearGreed, newsSentiment)
            };
        } catch (err) {
            console.error('[ERROR] News analysis failed:', err.message);
            return {
                fearGreed: { value: 50, classification: 'Neutral' },
                newsSentiment: { score: 0, classification: 'Neutral' },
                overallSentiment: 0,
                shouldPauseTrading: false
            };
        }
    }

    // Get Fear & Greed Index from alternative.me
    async getFearGreedIndex() {
        // Check cache
        if (this.cache.fearGreed && Date.now() - this.cache.lastUpdate < this.cacheDuration) {
            return this.cache.fearGreed;
        }

        try {
            const response = await axios.get('https://api.alternative.me/fng/', {
                timeout: 5000
            });

            const data = response.data.data[0];
            const result = {
                value: parseInt(data.value),
                classification: data.value_classification,
                timestamp: data.timestamp
            };

            this.cache.fearGreed = result;
            this.cache.lastUpdate = Date.now();

            console.log(`[INFO] Fear & Greed Index: ${result.value} (${result.classification})`);
            return result;
        } catch (err) {
            console.error('[ERROR] Failed to fetch Fear & Greed Index:', err.message);
            return { value: 50, classification: 'Neutral' };
        }
    }

    // Get crypto news sentiment from CryptoCompare
    async getNewsSentiment() {
        // Check cache
        if (this.cache.news && Date.now() - this.cache.lastUpdate < this.cacheDuration) {
            return this.cache.news;
        }

        try {
            const response = await axios.get('https://min-api.cryptocompare.com/data/v2/news/?lang=EN', {
                timeout: 5000,
                params: {
                    categories: 'BTC,ETH,Trading,Blockchain'
                }
            });

            const articles = response.data.Data.slice(0, 20); // Analyze last 20 articles
            const sentiment = this.analyzeSentiment(articles);

            this.cache.news = sentiment;
            this.cache.lastUpdate = Date.now();

            console.log(`[INFO] News sentiment: ${sentiment.score.toFixed(1)} (${sentiment.classification})`);
            return sentiment;
        } catch (err) {
            console.error('[ERROR] Failed to fetch news:', err.message);
            return { score: 0, classification: 'Neutral', articles: [] };
        }
    }

    // Analyze sentiment from news headlines
    analyzeSentiment(articles) {
        const bullishKeywords = [
            'adoption', 'institutional', 'etf approved', 'rally', 'surge', 'breakout',
            'bullish', 'growth', 'partnership', 'integration', 'upgrade', 'milestone',
            'record high', 'all-time high', 'ath', 'buying', 'accumulation'
        ];

        const bearishKeywords = [
            'hack', 'regulation', 'ban', 'crash', 'dump', 'bearish', 'decline',
            'lawsuit', 'fraud', 'scam', 'warning', 'risk', 'sell-off', 'selloff',
            'plunge', 'collapse', 'investigation', 'crackdown', 'restriction'
        ];

        let bullishScore = 0;
        let bearishScore = 0;
        const relevantArticles = [];

        articles.forEach(article => {
            const text = (article.title + ' ' + article.body).toLowerCase();
            let articleScore = 0;

            bullishKeywords.forEach(keyword => {
                if (text.includes(keyword)) {
                    bullishScore += 1;
                    articleScore += 1;
                }
            });

            bearishKeywords.forEach(keyword => {
                if (text.includes(keyword)) {
                    bearishScore += 1;
                    articleScore -= 1;
                }
            });

            if (Math.abs(articleScore) > 0) {
                relevantArticles.push({
                    title: article.title,
                    sentiment: articleScore > 0 ? 'bullish' : 'bearish',
                    url: article.url
                });
            }
        });

        // Calculate overall sentiment score (-100 to +100)
        const total = bullishScore + bearishScore;
        const score = total > 0
            ? ((bullishScore - bearishScore) / total) * 100
            : 0;

        let classification;
        if (score > 30) classification = 'Very Bullish';
        else if (score > 10) classification = 'Bullish';
        else if (score < -30) classification = 'Very Bearish';
        else if (score < -10) classification = 'Bearish';
        else classification = 'Neutral';

        return {
            score,
            classification,
            bullishCount: bullishScore,
            bearishCount: bearishScore,
            articles: relevantArticles.slice(0, 5) // Top 5 relevant
        };
    }

    // Calculate overall sentiment combining Fear & Greed + News
    calculateOverallSentiment(fearGreed, newsSentiment) {
        // Normalize Fear & Greed to -100 to +100 scale
        const fgNormalized = (fearGreed.value - 50) * 2;

        // Weight: 60% Fear & Greed, 40% News
        const overall = (fgNormalized * 0.6) + (newsSentiment.score * 0.4);

        return overall;
    }

    // Determine if trading should be paused
    shouldPauseTrading(fearGreed, newsSentiment) {
        // Pause if extreme fear (< 20) or extreme greed (> 80)
        if (fearGreed.value < 20 || fearGreed.value > 80) {
            console.log(`[WARNING] Extreme market sentiment: ${fearGreed.classification}`);
            return true;
        }

        // Pause if very bearish news (< -50)
        if (newsSentiment.score < -50) {
            console.log(`[WARNING] Very bearish news sentiment: ${newsSentiment.classification}`);
            return true;
        }

        return false;
    }

    // Get sentiment bonus for signal scoring
    getSentimentBonus(signalType, fearGreed, newsSentiment) {
        const overall = this.calculateOverallSentiment(fearGreed, newsSentiment);
        let bonus = 0;

        if (signalType === 'LONG') {
            // Bullish sentiment helps LONG signals
            if (overall > 30) {
                bonus = 15;
            } else if (overall > 10) {
                bonus = 10;
            } else if (overall < -20) {
                bonus = -10; // Penalty for bearish sentiment on LONG
            }
        } else {
            // Bearish sentiment helps SHORT signals
            if (overall < -30) {
                bonus = 15;
            } else if (overall < -10) {
                bonus = 10;
            } else if (overall > 20) {
                bonus = -10; // Penalty for bullish sentiment on SHORT
            }
        }

        return bonus;
    }

    // Get sentiment description for Telegram message
    getSentimentDescription(fearGreed, newsSentiment) {
        const overall = this.calculateOverallSentiment(fearGreed, newsSentiment);

        let emoji = '😐';
        if (overall > 30) emoji = '🚀';
        else if (overall > 10) emoji = '📈';
        else if (overall < -30) emoji = '💀';
        else if (overall < -10) emoji = '📉';

        return `${emoji} Sentiment: ${overall.toFixed(0)} | F&G: ${fearGreed.value} (${fearGreed.classification})`;
    }
}

// Export
module.exports = NewsAnalyzer;
