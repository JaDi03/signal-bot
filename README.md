# Crypto Trading Signals Bot

An intelligent cryptocurrency trading signals bot with automatic market regime detection, multiple trading strategies, and performance tracking.

## Features

- **Market Regime Detection**: Automatically identifies TRENDING, RANGING, HIGH_VOLATILITY, and BREAKOUT market conditions
- **Multiple Strategies**: 
  - Momentum (for trending markets)
  - Mean Reversion (for ranging markets)
  - Breakout (for breakout scenarios)
- **Signal Scoring System**: 0-100 point scoring, only sends signals ≥60
- **Real Technical Indicators**: EMAs, RSI, MACD, Bollinger Bands, ADX, Stochastic RSI, OBV, ATR
- **Risk Management**: Dynamic position sizing, TP/SL based on ATR, max positions limit
- **Performance Tracking**: Automatic TP/SL verification, PnL calculation, win rate statistics
- **Web Dashboard**: Modern interface with real-time metrics, charts, and signal history
- **Telegram Notifications**: Detailed alerts for new signals, TP/SL hits, and daily summaries

## Quick Start

### Prerequisites

- Node.js v16 or higher
- npm
- Binance account (for market data)
- Telegram Bot (optional, for notifications)

### Installation

```bash
npm install
```

### Configuration

1. **Telegram Setup** (optional):
   - Create a bot with [@BotFather](https://t.me/botfather)
   - Get your Chat ID from [@userinfobot](https://t.me/userinfobot)
   - Set environment variables or edit `bot.js`:
     ```bash
     export TELEGRAM_TOKEN="your_bot_token"
     export TELEGRAM_CHAT_ID="your_chat_id"
     ```

2. **Run the bot**:
   ```bash
   npm start
   ```

This will start:
- ✅ Signal generation bot (analyzes market every 15 min)
- ✅ Performance tracker (checks TP/SL every 5 min)
- ✅ Web dashboard (available at `http://localhost:3000`)

To stop everything, press `Ctrl+C`

## Project Structure

```
signal_bot/
├── bot.js                    # Main bot with strategies
├── performance_tracker.js    # TP/SL tracking and stats
├── server.js                 # Web server and API
├── start.js                  # Process orchestrator
├── signals_log.csv          # Signal records
├── package.json             # Dependencies
├── public/
│   ├── dashboard.html       # Dashboard interface
│   ├── dashboard.css        # Styles
│   └── dashboard.js         # Dashboard logic
└── README.md                # This file
```

## Configuration

Edit `bot.js` to customize:

```javascript
const config = {
  symbols: ['BTC/USDT', 'ETH/USDT', ...],  // Trading pairs
  timeframe: '15m',                         // Candle timeframe
  checkIntervalMinutes: 15,                 // Analysis frequency
  minSignalScore: 60,                       // Minimum score (0-100)
  riskPerTrade: 0.01,                       // 1% risk per trade
  maxPositions: 3,                          // Max simultaneous positions
  maxDailyDrawdown: 0.03,                   // 3% max daily drawdown
};
```

## How It Works

### 1. Market Regime Detection
The bot analyzes the market every 15 minutes and determines the current regime:
- **TRENDING**: ADX > 25, price respects EMAs
- **RANGING**: ADX < 20, price oscillates
- **HIGH_VOLATILITY**: High ATR
- **BREAKOUT**: BB expansion with volume

### 2. Strategy Selection
Based on the detected regime, it activates the most appropriate strategy:
- **Momentum**: For strong trends
- **Mean Reversion**: For sideways markets
- **Breakout**: For level breaks

### 3. Signal Scoring
Each signal receives a 0-100 score based on:
- Indicator confirmation (40 points)
- Regime strength (20 points)
- Level confluence (20 points)
- Volume (10 points)
- Orderbook imbalance (10 points)

### 4. Performance Tracking
The tracker verifies every 5 minutes if open signals reached TP or SL:
- Updates status in CSV
- Calculates real PnL
- Sends Telegram notification
- Generates statistics

## Dashboard

The dashboard shows:
- **Main Metrics**: Win Rate, Total PnL, Profit Factor, Trades
- **Active Signals**: With floating PnL and elapsed time
- **Charts**:
  - Equity curve (cumulative PnL)
  - Win rate by symbol
  - Win rate by strategy
  - PnL distribution
- **Full History**: With filters by status, type, and search

## Telegram Notifications

### New Signal
```
🟢 SIGNAL MOMENTUM - LONG
━━━━━━━━━━━━━━━━━━━━
📊 BTC/USDT @ $45,230
🔥 Score: 78/100
📈 Regime: TRENDING

💰 Entry: $45,230
🛡️ SL: $44,550 (-1.5%)
🎯 TP: $46,590 (+3.0%)
💵 Size: $100 USDT

📋 Reasons:
✓ Bullish EMA alignment
✓ MACD bullish crossover
...
```

### TP/SL Hit
```
✅ TP HIT - BTC/USDT
━━━━━━━━━━━━━━━━━━━━
💰 Entry: $45,230
🎯 Exit: $46,590
📈 PnL: +3.0% (+$3.00 USDT)
⏱️ Duration: 4h 23m
```

## CSV Format

```csv
Timestamp,Symbol,Signal,Regime,Strategy,Entry_Price,SL,TP,Position_Size_USDT,Status,Exit_Price,Exit_Time,PnL_Percent,PnL_USDT,Score,ATR,Reasons,Timeframe
```

**Possible statuses**:
- `OPEN`: Active signal
- `TP_HIT`: Take Profit reached ✅
- `SL_HIT`: Stop Loss reached ❌

## Deployment

### Vercel (Recommended for Dashboard)

1. Push to GitHub
2. Import project in Vercel
3. Set environment variables:
   - `TELEGRAM_TOKEN`
   - `TELEGRAM_CHAT_ID`
4. Deploy

### Local Server

```bash
npm start
```

## Troubleshooting

### No signals generated
- Check that there are enough candles (minimum 200)
- Review minimum score in configuration
- Verify Binance connection

### Telegram not sending messages
- Verify token and chat ID
- Ensure you've started a conversation with the bot
- Check console for error logs

### Dashboard not loading data
- Verify `server.js` is running
- Check that `signals_log.csv` exists
- Review browser console (F12)

## Disclaimer

This bot is for educational and research purposes only. Cryptocurrency trading carries significant risks. Do not use money you cannot afford to lose. Past results do not guarantee future results.

## License

ISC

---

**Developed for intelligent traders**
