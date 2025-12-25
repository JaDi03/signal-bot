const ccxt = require('ccxt');
const TechnicalIndicators = require('technicalindicators');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

// Market structure analysis modules
const LiquidityAnalyzer = require('./liquidity_analyzer');
const OrderBlockDetector = require('./orderblock_detector');
const GapAnalyzer = require('./gap_analyzer');
const NewsAnalyzer = require('./news_analyzer');

// Configuration
const config = {
  exchange: 'binance',
  timeframe: '15m',
  symbols: [
    'BTC/USDT',
    'ETH/USDT',
    'BNB/USDT',
    'SOL/USDT',
    'XRP/USDT',
    'ADA/USDT',
    'DOGE/USDT',
    'POL/USDT',
    'LTC/USDT',
    'LINK/USDT',
  ],
  telegramToken: process.env.TELEGRAM_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  chatId: process.env.TELEGRAM_CHAT_ID || 'YOUR_CHAT_ID_HERE',
  checkIntervalMinutes: 15,
  logFile: 'signals_log.csv',

  // Risk management
  riskPerTrade: 0.01,
  maxPositions: 3,
  maxDailyDrawdown: 0.03,
  minSignalScore: 60,
};

const exchange = new ccxt.binance({ enableRateLimit: true });
const bot = new TelegramBot(config.telegramToken, { polling: false });
const newsAnalyzer = new NewsAnalyzer();
const lastSignals = {};

// Initialize CSV with headers (Only if NOT in Vercel to avoid Read-only filesystem error)
if (!process.env.VERCEL) {
  if (!fs.existsSync(config.logFile)) {
    try {
      const header = 'Timestamp,Symbol,Signal,Regime,Strategy,Entry_Price,SL,TP,Position_Size_USDT,Status,Exit_Price,Exit_Time,PnL_Percent,PnL_USDT,Score,ATR,Reasons,Timeframe\n';
      fs.writeFileSync(config.logFile, header);
    } catch (err) {
      console.warn('[WARN] File system is read-only or inaccessible:', err.message);
    }
  }
}

// Utility: Sleep function for delays
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Utility: Check if there's already an open position for a symbol
function isPositionOpen(symbol) {
  try {
    if (!fs.existsSync(config.logFile)) return false;
    const content = fs.readFileSync(config.logFile, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length <= 1) return false;

    const headers = lines[0].split(',');
    const statusIdx = headers.indexOf('Status');
    const symbolIdx = headers.indexOf('Symbol');

    if (statusIdx === -1 || symbolIdx === -1) return false;

    // Check last 20 signals (arbitrary depth to find open positions)
    const recentLines = lines.slice(-20);
    return recentLines.some(line => {
      const values = line.split(',');
      return values[symbolIdx] === symbol && values[statusIdx] === 'OPEN';
    });
  } catch (err) {
    console.error(`[ERROR] isPositionOpen ${symbol}:`, err.message);
    return false;
  }
}

// Utility: Check if there's already an open position for a symbol (Local CSV)
function isPositionOpenLocal(symbol) {
  try {
    if (process.env.VERCEL || !fs.existsSync(config.logFile)) return false;
    const content = fs.readFileSync(config.logFile, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length <= 1) return false;

    const headers = lines[0].split(',');
    const statusIdx = headers.indexOf('Status');
    const symbolIdx = headers.indexOf('Symbol');

    if (statusIdx === -1 || symbolIdx === -1) return false;

    // Check last 20 signals (arbitrary depth to find open positions)
    const recentLines = lines.slice(-20);
    return recentLines.some(line => {
      const values = line.split(',');
      return values[symbolIdx] === symbol && values[statusIdx] === 'OPEN';
    });
  } catch (err) {
    console.error(`[ERROR] isPositionOpenLocal ${symbol}:`, err.message);
    return false;
  }
}

/**
 * NEW: Supabase Integration Functions
 */

async function isPositionOpenSupabase(symbol) {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase
      .from('signals')
      .select('status')
      .eq('symbol', symbol)
      .eq('status', 'OPEN');

    if (error) throw error;
    return data && data.length > 0;
  } catch (err) {
    console.error(`[ERROR] isPositionOpenSupabase ${symbol}:`, err.message);
    return false;
  }
}

async function saveSignalSupabase(signal, symbol) {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('signals')
      .insert([{
        symbol: symbol,
        signal_type: signal.type,
        regime: signal.regime,
        strategy: signal.strategy,
        entry_price: signal.price,
        sl_price: signal.sl,
        tp_price: signal.tp,
        status: 'OPEN',
        score: signal.score,
        atr: signal.atr,
        reasons: signal.reasons,
        timeframe: config.timeframe
      }]);

    if (error) throw error;
    console.log(`[SUCCESS] Signal for ${symbol} saved to Supabase`);
    return true;
  } catch (err) {
    console.error(`[ERROR] saveSignalSupabase ${symbol}:`, err.message);
    return false;
  }
}

async function updateOpenPositionsSupabase() {
  if (!supabase) return;
  try {
    console.log('[DEBUG] Checking open positions in Supabase...');
    const { data: openSignals, error } = await supabase
      .from('signals')
      .select('*')
      .eq('status', 'OPEN');

    if (error) throw error;
    if (!openSignals || openSignals.length === 0) return;

    for (const signal of openSignals) {
      try {
        const ticker = await exchange.fetchTicker(signal.symbol);
        const currentPrice = ticker.last;
        const entryPrice = parseFloat(signal.entry_price);
        const tp = parseFloat(signal.tp_price);
        const sl = parseFloat(signal.sl_price);

        let newStatus = 'OPEN';
        let exitPrice = null;

        if (signal.signal_type === 'LONG') {
          if (currentPrice >= tp) {
            newStatus = 'TP_HIT';
            exitPrice = tp;
          } else if (currentPrice <= sl) {
            newStatus = 'SL_HIT';
            exitPrice = sl;
          }
        } else { // SHORT
          if (currentPrice <= tp) {
            newStatus = 'TP_HIT';
            exitPrice = tp;
          } else if (currentPrice >= sl) {
            newStatus = 'SL_HIT';
            exitPrice = sl;
          }
        }

        if (newStatus !== 'OPEN') {
          const pnlPercent = signal.signal_type === 'LONG'
            ? ((exitPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - exitPrice) / entryPrice) * 100;

          const pnlUsdt = 100 * (pnlPercent / 100);

          const { error: updateError } = await supabase
            .from('signals')
            .update({
              status: newStatus,
              exit_price: exitPrice,
              exit_time: new Date().toISOString(),
              pnl_percent: pnlPercent,
              pnl_usdt: pnlUsdt
            })
            .eq('id', signal.id);

          if (updateError) throw updateError;
          console.log(`[CLOSED] ${signal.symbol} ${newStatus} at ${exitPrice} (PnL: ${pnlPercent.toFixed(2)}%)`);
        }
      } catch (tickerErr) {
        console.error(`[ERROR] updateOpenPosition for ${signal.symbol}:`, tickerErr.message);
      }
    }
  } catch (err) {
    console.error('[ERROR] updateOpenPositionsSupabase:', err.message);
  }
}

// Utility: Format price with dynamic precision based on value
function formatPrice(price) {
  const p = parseFloat(price);
  if (isNaN(p)) return 'N/A';
  if (p < 1) return p.toFixed(4);
  if (p < 10) return p.toFixed(3);
  return p.toFixed(2);
}

// Fetch OHLCV data with retry mechanism
async function getOHLCV(symbol, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[DEBUG] Fetching OHLCV for ${symbol} (attempt ${attempt}/${retries})`);

      if (attempt > 1) await sleep(2000);

      const ohlcv = await exchange.fetchOHLCV(symbol, config.timeframe, undefined, 200);
      console.log(`[DEBUG] OHLCV fetched: ${ohlcv.length} candles`);

      return ohlcv.map(c => ({
        timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5]
      }));
    } catch (err) {
      console.error(`[ERROR] getOHLCV ${symbol} (attempt ${attempt}): ${err.message}`);

      if (attempt === retries) {
        console.error(`[ERROR] Failed after ${retries} attempts`);
        return [];
      }

      if (err.message.includes('fetch failed') || err.message.includes('ECONNRESET')) {
        console.log(`[INFO] Network error, waiting 5s...`);
        await sleep(5000);
      }
    }
  }
  return [];
}

// Get orderbook imbalance for market pressure analysis
async function getOrderbookImbalance(symbol) {
  try {
    const orderbook = await exchange.fetchOrderBook(symbol, 20);
    const bidsVol = orderbook.bids.reduce((sum, bid) => sum + (bid[1] || 0), 0);
    const asksVol = orderbook.asks.reduce((sum, ask) => sum + (ask[1] || 0), 0);
    const total = bidsVol + asksVol;
    if (total === 0) return { ratio: 0, text: 'N/A' };
    const ratio = (bidsVol - asksVol) / total * 100;
    let text = '';
    if (ratio > 15) text = `Strong buyers (+${ratio.toFixed(1)}%)`;
    else if (ratio < -15) text = `Strong sellers (${ratio.toFixed(1)}%)`;
    else text = `Balanced (${ratio.toFixed(1)}%)`;
    return { ratio, text };
  } catch (err) {
    return { ratio: 0, text: 'N/A' };
  }
}

// Calculate all technical indicators
function calculateAllIndicators(candles) {
  console.log('[DEBUG] Calculating indicators...');

  if (!candles || candles.length < 200) {
    console.log(`[WARN] Not enough candles: ${candles ? candles.length : 0}`);
    return null;
  }

  try {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    const ema9 = TechnicalIndicators.EMA.calculate({ period: 9, values: closes });
    const ema21 = TechnicalIndicators.EMA.calculate({ period: 21, values: closes });
    const ema50 = TechnicalIndicators.EMA.calculate({ period: 50, values: closes });
    const ema200 = TechnicalIndicators.EMA.calculate({ period: 200, values: closes });
    const rsi = TechnicalIndicators.RSI.calculate({ period: 14, values: closes });
    const macd = TechnicalIndicators.MACD.calculate({
      values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false
    });
    const bb = TechnicalIndicators.BollingerBands.calculate({
      period: 20, values: closes, stdDev: 2
    });
    const atr = TechnicalIndicators.ATR.calculate({
      high: highs, low: lows, close: closes, period: 14
    });
    const adx = TechnicalIndicators.ADX.calculate({
      high: highs, low: lows, close: closes, period: 14
    });
    const stochRSI = TechnicalIndicators.StochasticRSI.calculate({
      values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3
    });
    const obv = TechnicalIndicators.OBV.calculate({ close: closes, volume: volumes });
    const volumeSMA = TechnicalIndicators.SMA.calculate({ period: 20, values: volumes });

    const currentClose = closes[closes.length - 1];

    return {
      close: currentClose,
      ema9: ema9[ema9.length - 1],
      ema21: ema21[ema21.length - 1],
      ema50: ema50[ema50.length - 1],
      ema200: ema200[ema200.length - 1],
      rsi: rsi[rsi.length - 1],
      rsiPrev: rsi[rsi.length - 2],
      macd: macd[macd.length - 1]?.MACD || 0,
      macdSignal: macd[macd.length - 1]?.signal || 0,
      macdHistogram: macd[macd.length - 1]?.histogram || 0,
      macdPrev: macd[macd.length - 2]?.MACD || 0,
      bbUpper: bb[bb.length - 1]?.upper || currentClose * 1.02,
      bbMiddle: bb[bb.length - 1]?.middle || currentClose,
      bbLower: bb[bb.length - 1]?.lower || currentClose * 0.98,
      bbWidth: bb[bb.length - 1] ? (bb[bb.length - 1].upper - bb[bb.length - 1].lower) / bb[bb.length - 1].middle : 0.04,
      atr: atr[atr.length - 1],
      adx: adx[adx.length - 1]?.adx || 20,
      pdi: adx[adx.length - 1]?.pdi || 20,
      mdi: adx[adx.length - 1]?.mdi || 20,
      stochRsiK: stochRSI[stochRSI.length - 1]?.k || 50,
      stochRsiD: stochRSI[stochRSI.length - 1]?.d || 50,
      stochRsiKPrev: stochRSI[stochRSI.length - 2]?.k || 50,
      obv: obv[obv.length - 1],
      obvPrev: obv[obv.length - 2],
      volumeAvg: volumeSMA[volumeSMA.length - 1],
      volumeRatio: candles[candles.length - 1].volume / volumeSMA[volumeSMA.length - 1],
    };
  } catch (err) {
    console.error('[ERROR] calculateIndicators:', err.message);
    return null;
  }
}

// Detect current market regime
function detectMarketRegime(ind) {
  const adx = ind.adx;
  const atr = ind.atr;
  const close = ind.close;
  const bbWidth = ind.bbWidth;
  const volatility = (atr / close) * 100;

  // Trending market: strong ADX, price respects EMAs
  if (adx > 25 && volatility < 3) {
    const bullish = close > ind.ema200 && ind.ema50 > ind.ema200;
    const bearish = close < ind.ema200 && ind.ema50 < ind.ema200;
    if (bullish || bearish) {
      return { regime: 'TRENDING', direction: bullish ? 'UP' : 'DOWN' };
    }
  }

  // High volatility market
  if (volatility > 3 || bbWidth > 0.06) {
    return { regime: 'HIGH_VOLATILITY', direction: 'NEUTRAL' };
  }

  // Ranging market: low ADX
  if (adx < 20) {
    return { regime: 'RANGING', direction: 'NEUTRAL' };
  }

  // Breakout: expanding Bollinger Bands with high volume
  if (bbWidth > 0.05 && ind.volumeRatio > 1.5) {
    const breakoutUp = close > ind.bbUpper;
    const breakoutDown = close < ind.bbLower;
    if (breakoutUp || breakoutDown) {
      return { regime: 'BREAKOUT', direction: breakoutUp ? 'UP' : 'DOWN' };
    }
  }

  return { regime: 'NEUTRAL', direction: 'NEUTRAL' };
}

// Strategy: Momentum (for trending markets)
function generateMomentumSignal(ind) {
  const signals = { long: 0, short: 0, reasons: [] };

  // Long conditions
  if (ind.close > ind.ema200 && ind.ema50 > ind.ema200 && ind.ema21 > ind.ema50) {
    signals.long += 20;
    signals.reasons.push('✓ Bullish EMA alignment');
  }
  if (ind.macd > ind.macdSignal && ind.macd > 0) {
    signals.long += 20;
    signals.reasons.push('✓ MACD bullish crossover');
  }
  if (ind.rsi > 40 && ind.rsi < 70) {
    signals.long += 15;
    signals.reasons.push(`✓ RSI optimal (${ind.rsi.toFixed(1)})`);
  }
  if (ind.volumeRatio > 1.2) {
    signals.long += 15;
    signals.reasons.push(`✓ Volume ${ind.volumeRatio.toFixed(1)}x avg`);
  }
  if (ind.adx > 25) {
    signals.long += 15;
    signals.reasons.push(`✓ Strong trend (ADX ${ind.adx.toFixed(1)})`);
  }
  if (ind.pdi > ind.mdi) {
    signals.long += 10;
    signals.reasons.push('✓ Buying pressure (DMI)');
  }
  if (ind.obv > ind.obvPrev) {
    signals.long += 5;
    signals.reasons.push('✓ OBV rising');
  }

  // Short conditions
  if (ind.close < ind.ema200 && ind.ema50 < ind.ema200 && ind.ema21 < ind.ema50) {
    signals.short += 20;
    signals.reasons.push('✓ Bearish EMA alignment');
  }
  if (ind.macd < ind.macdSignal && ind.macd < 0) {
    signals.short += 20;
    signals.reasons.push('✓ MACD bearish crossover');
  }
  if (ind.rsi < 60 && ind.rsi > 30) {
    signals.short += 15;
    signals.reasons.push(`✓ RSI optimal (${ind.rsi.toFixed(1)})`);
  }
  if (ind.volumeRatio > 1.2) {
    signals.short += 15;
    signals.reasons.push(`✓ Volume ${ind.volumeRatio.toFixed(1)}x avg`);
  }
  if (ind.adx > 25) {
    signals.short += 15;
    signals.reasons.push(`✓ Strong trend (ADX ${ind.adx.toFixed(1)})`);
  }
  if (ind.mdi > ind.pdi) {
    signals.short += 10;
    signals.reasons.push('✓ Selling pressure (DMI)');
  }
  if (ind.obv < ind.obvPrev) {
    signals.short += 5;
    signals.reasons.push('✓ OBV falling');
  }

  return signals;
}

// Strategy: Mean Reversion (for ranging markets)
function generateMeanReversionSignal(ind) {
  const signals = { long: 0, short: 0, reasons: [] };

  // Long conditions (oversold bounce)
  if (ind.close <= ind.bbLower) {
    signals.long += 25;
    signals.reasons.push('✓ Price at lower BB');
  }
  if (ind.rsi < 30) {
    signals.long += 25;
    signals.reasons.push(`✓ RSI oversold (${ind.rsi.toFixed(1)})`);
  }
  if (ind.stochRsiK < 20 && ind.stochRsiK > ind.stochRsiKPrev) {
    signals.long += 20;
    signals.reasons.push('✓ Stoch RSI bullish cross');
  }

  // Short conditions (overbought rejection)
  if (ind.close >= ind.bbUpper) {
    signals.short += 25;
    signals.reasons.push('✓ Price at upper BB');
  }
  if (ind.rsi > 70) {
    signals.short += 25;
    signals.reasons.push(`✓ RSI overbought (${ind.rsi.toFixed(1)})`);
  }
  if (ind.stochRsiK > 80 && ind.stochRsiK < ind.stochRsiKPrev) {
    signals.short += 20;
    signals.reasons.push('✓ Stoch RSI bearish cross');
  }

  return signals;
}

// Strategy: Breakout (for breakout scenarios)
function generateBreakoutSignal(ind) {
  const signals = { long: 0, short: 0, reasons: [] };

  // Long conditions (bullish breakout)
  if (ind.close > ind.bbUpper && ind.volumeRatio > 1.5) {
    signals.long += 30;
    signals.reasons.push('✓ Bullish breakout with volume');
  }
  if (ind.rsi > 50 && ind.rsi < 80) {
    signals.long += 20;
    signals.reasons.push(`✓ Positive momentum (RSI ${ind.rsi.toFixed(1)})`);
  }

  // Short conditions (bearish breakout)
  if (ind.close < ind.bbLower && ind.volumeRatio > 1.5) {
    signals.short += 30;
    signals.reasons.push('✓ Bearish breakout with volume');
  }
  if (ind.rsi < 50 && ind.rsi > 20) {
    signals.short += 20;
    signals.reasons.push(`✓ Negative momentum (RSI ${ind.rsi.toFixed(1)})`);
  }

  return signals;
}

// Calculate dynamic Take Profit based on market structure
function calculateDynamicTP(signalType, currentPrice, atr, liquidityMap, orderBlocks, gaps) {
  const targets = [];

  if (signalType === 'LONG') {
    // Collect potential targets above current price
    liquidityMap.above.forEach(zone => {
      targets.push({ price: zone.price, strength: zone.strength, type: 'liquidity' });
    });

    orderBlocks.bearish.forEach(block => {
      const blockPrice = (block.top + block.bottom) / 2;
      targets.push({ price: blockPrice, strength: block.strength, type: 'orderblock' });
    });

    gaps.bearish.forEach(gap => {
      const gapPrice = (gap.top + gap.bottom) / 2;
      targets.push({ price: gapPrice, strength: gap.strength, type: 'gap' });
    });
  } else {
    // Collect potential targets below current price
    liquidityMap.below.forEach(zone => {
      targets.push({ price: zone.price, strength: zone.strength, type: 'liquidity' });
    });

    orderBlocks.bullish.forEach(block => {
      const blockPrice = (block.top + block.bottom) / 2;
      targets.push({ price: blockPrice, strength: block.strength, type: 'orderblock' });
    });

    gaps.bullish.forEach(gap => {
      const gapPrice = (gap.top + gap.bottom) / 2;
      targets.push({ price: gapPrice, strength: gap.strength, type: 'gap' });
    });
  }

  // Filter targets by distance (min 1%, max 10%)
  const minDistance = currentPrice * 0.01;
  const maxDistance = currentPrice * 0.10;

  const validTargets = targets.filter(t => {
    const dist = Math.abs(t.price - currentPrice);
    return dist >= minDistance && dist <= maxDistance;
  });

  if (validTargets.length === 0) {
    // Fallback to ATR-based TP
    return signalType === 'LONG'
      ? currentPrice + (atr * 3.0)
      : currentPrice - (atr * 3.0);
  }

  // Score targets by strength/distance ratio
  validTargets.forEach(t => {
    const dist = Math.abs(t.price - currentPrice);
    t.score = t.strength / (dist / currentPrice * 100); // Strength per % distance
  });

  // Sort by score and select best
  validTargets.sort((a, b) => b.score - a.score);
  const bestTarget = validTargets[0];

  console.log(`[DEBUG] TP target: ${bestTarget.type} at $${bestTarget.price.toFixed(2)} (strength: ${bestTarget.strength.toFixed(0)})`);

  return bestTarget.price;
}

// Calculate dynamic Stop Loss based on market structure
function calculateDynamicSL(signalType, currentPrice, atr, liquidityMap, orderBlocks, gaps) {
  const invalidationPoints = [];

  if (signalType === 'LONG') {
    // Find structure below entry for SL placement
    liquidityMap.below.forEach(zone => {
      invalidationPoints.push({ price: zone.price, strength: zone.strength, type: 'liquidity' });
    });

    orderBlocks.bullish.forEach(block => {
      // Place SL below order block
      invalidationPoints.push({ price: block.low, strength: block.strength, type: 'orderblock' });
    });
  } else {
    // Find structure above entry for SL placement
    liquidityMap.above.forEach(zone => {
      invalidationPoints.push({ price: zone.price, strength: zone.strength, type: 'liquidity' });
    });

    orderBlocks.bearish.forEach(block => {
      // Place SL above order block
      invalidationPoints.push({ price: block.high, strength: block.strength, type: 'orderblock' });
    });
  }

  if (invalidationPoints.length === 0) {
    // Fallback to ATR-based SL
    return signalType === 'LONG'
      ? currentPrice - (atr * 1.5)
      : currentPrice + (atr * 1.5);
  }

  // Find nearest strong structure
  invalidationPoints.sort((a, b) => {
    const distA = Math.abs(a.price - currentPrice);
    const distB = Math.abs(b.price - currentPrice);
    return distA - distB;
  });

  const nearest = invalidationPoints[0];

  // Add buffer beyond structure (0.3% to avoid exact level)
  const buffer = currentPrice * 0.003;
  const slPrice = signalType === 'LONG'
    ? nearest.price - buffer
    : nearest.price + buffer;

  // Validate SL is not too tight (min 0.5%) or too wide (max 3%)
  const slPercent = Math.abs((slPrice - currentPrice) / currentPrice * 100);

  if (slPercent < 0.5) {
    // Too tight, use minimum
    return signalType === 'LONG'
      ? currentPrice * 0.995
      : currentPrice * 1.005;
  }

  if (slPercent > 3) {
    // Too wide, cap at 3%
    return signalType === 'LONG'
      ? currentPrice * 0.97
      : currentPrice * 1.03;
  }

  console.log(`[DEBUG] SL: ${nearest.type} at $${slPrice.toFixed(2)} (${slPercent.toFixed(2)}%)`);

  return slPrice;
}

// Generate trading signal with scoring system
async function generateSignal(candles, symbol, sentimentData) {
  console.log(`[DEBUG] Generating signal for ${symbol}`);

  if (!candles || candles.length === 0) return null;

  const ind = calculateAllIndicators(candles);
  if (!ind) return null;

  const regime = detectMarketRegime(ind);
  console.log(`[DEBUG] Regime: ${regime.regime} (${regime.direction})`);

  let strategySignals = { long: 0, short: 0, reasons: [] };
  let strategyName = '';

  // Select strategy based on market regime
  if (regime.regime === 'TRENDING') {
    strategySignals = generateMomentumSignal(ind);
    strategyName = 'MOMENTUM';
  } else if (regime.regime === 'RANGING') {
    strategySignals = generateMeanReversionSignal(ind);
    strategyName = 'MEAN_REVERSION';
  } else if (regime.regime === 'BREAKOUT') {
    strategySignals = generateBreakoutSignal(ind);
    strategyName = 'BREAKOUT';
  } else {
    // For neutral regimes, use the strategy with highest score
    const momentum = generateMomentumSignal(ind);
    const meanRev = generateMeanReversionSignal(ind);
    const breakout = generateBreakoutSignal(ind);

    if (momentum.long > meanRev.long && momentum.long > breakout.long) {
      strategySignals.long = momentum.long;
      strategySignals.reasons = momentum.reasons;
      strategyName = 'MOMENTUM';
    } else if (meanRev.long > breakout.long) {
      strategySignals.long = meanRev.long;
      strategySignals.reasons = meanRev.reasons;
      strategyName = 'MEAN_REVERSION';
    } else {
      strategySignals.long = breakout.long;
      strategySignals.reasons = breakout.reasons;
      strategyName = 'BREAKOUT';
    }

    if (momentum.short > meanRev.short && momentum.short > breakout.short) {
      strategySignals.short = momentum.short;
      if (strategySignals.short > strategySignals.long) {
        strategySignals.reasons = momentum.reasons;
        strategyName = 'MOMENTUM';
      }
    } else if (meanRev.short > breakout.short) {
      strategySignals.short = meanRev.short;
      if (strategySignals.short > strategySignals.long) {
        strategySignals.reasons = meanRev.reasons;
        strategyName = 'MEAN_REVERSION';
      }
    } else {
      strategySignals.short = breakout.short;
      if (strategySignals.short > strategySignals.long) {
        strategySignals.reasons = breakout.reasons;
        strategyName = 'BREAKOUT';
      }
    }
  }

  const imbalance = await getOrderbookImbalance(symbol);

  let finalScore = 0;
  let signalType = null;
  let reasons = [];

  if (strategySignals.long > strategySignals.short && strategySignals.long > 0) {
    finalScore = strategySignals.long;
    signalType = 'LONG';
    reasons = strategySignals.reasons;

    if (imbalance.ratio > 10) {
      finalScore += 10;
      reasons.push(`✓ Orderbook buyers (${imbalance.text})`);
    }

    if (regime.regime === 'TRENDING' && regime.direction === 'UP') {
      finalScore += 10;
      reasons.push(`✓ Favorable regime (${regime.regime})`);
    }

  } else if (strategySignals.short > strategySignals.long && strategySignals.short > 0) {
    finalScore = strategySignals.short;
    signalType = 'SHORT';
    reasons = strategySignals.reasons;

    if (imbalance.ratio < -10) {
      finalScore += 10;
      reasons.push(`✓ Orderbook sellers (${imbalance.text})`);
    }

    if (regime.regime === 'TRENDING' && regime.direction === 'DOWN') {
      finalScore += 10;
      reasons.push(`✓ Favorable regime (${regime.regime})`);
    }
  }

  // Add sentiment-based bonuses
  if (sentimentData && signalType) {
    const sentimentBonus = newsAnalyzer.getSentimentBonus(signalType, sentimentData.fearGreed, sentimentData.newsSentiment);
    if (sentimentBonus !== 0) {
      finalScore += sentimentBonus;
      const type = sentimentBonus > 0 ? '✓' : '⚠';
      reasons.push(`${type} Market sentiment alignment: ${sentimentBonus > 0 ? '+' : ''}${sentimentBonus} pts`);
    }
  }

  // Filter low-quality signals
  if (finalScore < config.minSignalScore) {
    console.log(`[DEBUG] Score too low: ${finalScore} < ${config.minSignalScore}`);
    return null;
  }

  // Analyze market structure for dynamic TP/SL
  const price = ind.close;
  const atr = ind.atr;

  console.log('[DEBUG] Analyzing market structure...');
  const liquidityMap = new LiquidityAnalyzer(candles, price).analyze();
  const orderBlocks = new OrderBlockDetector(candles, price).detect();
  const gaps = new GapAnalyzer(candles, price).detect();

  // Calculate dynamic TP based on market structure
  const tp = calculateDynamicTP(signalType, price, atr, liquidityMap, orderBlocks, gaps);

  // Calculate dynamic SL based on market structure
  const sl = calculateDynamicSL(signalType, price, atr, liquidityMap, orderBlocks, gaps);

  // Calculate percentages
  let slPercent, tpPercent, riskReward;

  if (signalType === 'LONG') {
    slPercent = ((price - sl) / price * 100);
    tpPercent = ((tp - price) / price * 100);
    riskReward = tpPercent / slPercent;
  } else {
    slPercent = ((sl - price) / price * 100);
    tpPercent = ((price - tp) / price * 100);
    riskReward = tpPercent / slPercent;
  }

  // Validate risk:reward ratio (minimum 1:1.5)
  if (riskReward < 1.5) {
    console.log(`[DEBUG] Risk:Reward too low: 1:${riskReward.toFixed(2)}`);
    return null;
  }

  // Add structure-based bonuses to score
  if (orderBlocks.nearest && orderBlocks.nearest.strength > 50) {
    finalScore += 15;
    reasons.push(`✓ Strong order block (${orderBlocks.nearest.strength.toFixed(0)})`);
  }

  if (liquidityMap.nearest && liquidityMap.nearest.strength > 50) {
    finalScore += 10;
    reasons.push(`✓ Liquidity zone detected`);
  }

  if (gaps.nearest && gaps.nearest.strength > 50) {
    finalScore += 10;
    reasons.push(`✓ Fair value gap (${gaps.nearest.sizePercent.toFixed(1)}%)`);
  }

  const positionSize = 100;

  // Format Telegram message
  const emoji = signalType === 'LONG' ? '🟢' : '🔴';
  const sentimentDesc = sentimentData ? newsAnalyzer.getSentimentDescription(sentimentData.fearGreed, sentimentData.newsSentiment) : '';

  const message = `${emoji} **SIGNAL ${strategyName} - ${signalType}**\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 ${symbol} @ $${formatPrice(price)}\n` +
    `🔥 Score: ${finalScore.toFixed(0)}/100\n` +
    `📈 Regime: ${regime.regime}\n` +
    `${sentimentDesc}\n\n` +
    `💰 Entry: $${formatPrice(price)}\n` +
    `🛡️ SL: $${formatPrice(sl)} (-${slPercent.toFixed(1)}%)\n` +
    `🎯 TP: $${formatPrice(tp)} (+${tpPercent.toFixed(1)}%)\n` +
    `💵 Size: $${positionSize.toFixed(0)} USDT\n\n` +
    `📋 Reasons:\n${reasons.join('\n')}\n\n` +
    `⏰ ${new Date().toLocaleString()}`;

  console.log(`[SIGNAL] ${signalType} detected - Score: ${finalScore}`);

  return {
    message,
    type: signalType,
    strategy: strategyName,
    regime: regime.regime,
    price,
    sl,
    tp,
    atr,
    score: finalScore,
    positionSize,
    imbalance: imbalance.text,
    reasons: reasons.join(' | ')
  };
}

// Main function: Check all symbols for signals
async function checkSignals() {
  console.log('[DEBUG] Starting checkSignals');

  // NEW: Update existing open positions first (Serverless friendly)
  if (process.env.SUPABASE_URL) {
    await updateOpenPositionsSupabase();
  }

  // Fetch market sentiment
  const sentimentData = await newsAnalyzer.analyze();

  if (sentimentData.shouldPauseTrading) {
    console.log('[WARNING] Trading paused due to extreme market sentiment or bearish news.');
    return;
  }

  for (const symbol of config.symbols) {
    try {
      console.log(`\n[DEBUG] Processing ${symbol}`);

      // NEW: Check if position is already open to avoid duplicates
      // Check both Local (if running local) and Supabase (if configured)
      const isLocalOpen = isPositionOpenLocal(symbol);
      let isSupabaseOpen = false;
      if (process.env.SUPABASE_URL) {
        isSupabaseOpen = await isPositionOpenSupabase(symbol);
      }

      if (isLocalOpen || isSupabaseOpen) {
        console.log(`[INFO] Position already open for ${symbol} (Local: ${isLocalOpen}, Supa: ${isSupabaseOpen}), skipping...`);
        continue;
      }

      const candles = await getOHLCV(symbol);
      if (candles.length === 0) {
        console.log(`[WARN] No candles for ${symbol}, skipping`);
        continue;
      }

      const signal = await generateSignal(candles, symbol, sentimentData);

      if (signal) {
        console.log(`[DEBUG] Signal detected for ${symbol}: ${signal.type}`);

        const signalKey = `${symbol}_${signal.type}`;
        if (lastSignals[signalKey] !== signal.type) {
          try {
            console.log('\n' + '='.repeat(50));
            console.log('SIGNAL DETECTED:');
            console.log(signal.message);
            console.log('='.repeat(50) + '\n');

            // Send Telegram notification
            try {
              await bot.sendMessage(config.chatId, signal.message, { parse_mode: 'Markdown' });
              console.log('[SUCCESS] Telegram notification sent');
            } catch (telegramErr) {
              console.error('[ERROR] Telegram:', telegramErr.message);
            }

            // Save to CSV (Only if NOT in Vercel)
            if (!process.env.VERCEL) {
              try {
                const timestamp = new Date().toISOString();
                const entry = `${timestamp},${symbol},${signal.type},${signal.regime},${signal.strategy},${formatPrice(signal.price)},${formatPrice(signal.sl)},${formatPrice(signal.tp)},${signal.positionSize.toFixed(2)},OPEN,,,,,${signal.score.toFixed(0)},${signal.atr.toFixed(2)},"${signal.reasons}",${config.timeframe}\n`;
                fs.appendFileSync(config.logFile, entry);
                console.log(`[SUCCESS] Saved to ${config.logFile}`);
              } catch (csvErr) {
                console.warn('[WARN] Could not save to local CSV (likely read-only FS):', csvErr.message);
              }
            }

            // NEW: Save to Supabase
            if (supabase) {
              await saveSignalSupabase(signal, symbol);
            }

            lastSignals[signalKey] = signal.type;
          } catch (err) {
            console.error(`[ERROR] Save for ${symbol}:`, err.message);
          }
        } else {
          console.log(`[INFO] Signal ${signal.type} for ${symbol} already sent`);
        }
      }

      await sleep(500); // Delay between symbols to avoid rate limiting

    } catch (err) {
      console.error(`[ERROR] checkSignals for ${symbol}:`, err.message);
    }
  }
  console.log('[DEBUG] checkSignals finished\n');
}

// Export functions for serverless use
module.exports = {
  checkSignals,
  generateSignal,
  getOHLCV,
  isPositionOpenSupabase,
  saveSignalSupabase,
  updateOpenPositionsSupabase,
  config,
  exchange
};

// Start the bot only if run directly
if (require.main === module) {
  // Initialize and start bot
  console.log('╔════════════════════════════════════════╗');
  console.log('║   TRADING SIGNALS BOT v2.0             ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`[INFO] Symbols: ${config.symbols.join(', ')}`);
  console.log(`[INFO] Timeframe: ${config.timeframe}`);
  console.log(`[INFO] Check interval: ${config.checkIntervalMinutes} minutes`);
  console.log(`[INFO] Minimum score: ${config.minSignalScore}/100`);
  console.log(`[INFO] Risk per trade: ${config.riskPerTrade * 100}%\n`);

  checkSignals();
  setInterval(checkSignals, config.checkIntervalMinutes * 60 * 1000);
}
