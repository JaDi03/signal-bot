require('dotenv').config();

const supabase = require('./supabase_client');
const ccxt = require('ccxt');
const TechnicalIndicators = require('technicalindicators');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const MODE = 'TRAIN'; // TRAIN | SIM | LIVE

// ========== REINFORCEMENT LEARNING AGENT ==========
const { SimpleDQNAgent } = require('./rl_agent');
const rlAgent = new SimpleDQNAgent(20, 3); // 20 features, 3 acciones: 0=HOLD, 1=LONG, 2=SHORT

let currentState = null;  // Estado actual del mercado
let lastAction = null;    // Última acción tomada por el agente

console.log('[RL 🤖] Agente RL activado - Aprendizaje en tiempo real ON');
console.log('[RL 🤖] Modelo se guardará en ./rl_model_pro/');

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
    'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT',
    'XRP/USDT', 'ZCASH/USDT', 'ZBT/USDT', 'ASTER/USDT',
    'LTC/USDT', 'LINK/USDT',
  ],
  telegramToken: process.env.TELEGRAM_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  checkIntervalMinutes: 15,
  logFile: 'signals_log.csv',
  riskPerTrade: 0.01,
  minRR: 1.5,
  minSignalScore: 75,
  maxPositions: 3,
  maxDailyDrawdown: 0.03,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
};

const exchange = new ccxt.binance({ enableRateLimit: true });
const bot = new TelegramBot(config.telegramToken, { polling: false });
const newsAnalyzer = new NewsAnalyzer();
const lastSignals = {};

// Initialize CSV
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

// Utility: Sleep
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ GESTIÓN DE POSICIONES ABIERTAS ============
async function getOpenPositions() {
  const openPositions = [];

  if (!process.env.VERCEL && fs.existsSync(config.logFile)) {
    try {
      const content = fs.readFileSync(config.logFile, 'utf-8');
      const lines = content.trim().split('\n');
      if (lines.length <= 1) return [];

      const headers = lines[0].split(',');
      const symbolIdx = headers.indexOf('Symbol');
      const signalIdx = headers.indexOf('Signal');
      const entryIdx = headers.indexOf('Entry_Price');
      const slIdx = headers.indexOf('SL');
      const tpIdx = headers.indexOf('TP');
      const sizeIdx = headers.indexOf('Position_Size_USDT');
      const statusIdx = headers.indexOf('Status');

      for (let i = lines.length - 1; i >= 1 && openPositions.length < config.maxPositions; i--) {
        const values = lines[i].split(',');
        if (values[statusIdx]?.trim() === 'OPEN') {
          openPositions.push({
            symbol: values[symbolIdx]?.trim(),
            signalType: values[signalIdx]?.trim(),
            entry_price: parseFloat(values[entryIdx]) || 0,
            sl: parseFloat(values[slIdx]) || 0,
            tp: parseFloat(values[tpIdx]) || 0,
            positionSize: parseFloat(values[sizeIdx]) || 100,
            timestamp: values[0] // Timestamp para duración
          });
        }
      }
    } catch (err) {
      console.error('[ERROR] Leyendo open positions CSV:', err.message);
    }
  }

  console.log(`[INFO] Posiciones abiertas encontradas: ${openPositions.length}/${config.maxPositions}`);
  return openPositions;
}

async function closePosition(position, exitPrice, reason = 'TP/SL') {
  const pnlPercent = position.signalType === 'LONG'
    ? ((exitPrice - position.entry_price) / position.entry_price) * 100
    : ((position.entry_price - exitPrice) / position.entry_price) * 100;

  const pnlUSDT = (pnlPercent / 100) * position.positionSize;
  const exitTime = new Date().toISOString();

  const entryTime = position.timestamp ? new Date(position.timestamp) : new Date();
  const durationMinutes = Math.max(1, (new Date(exitTime) - entryTime) / 60000);

  // ========== RL: APRENDIZAJE ==========
  if (currentState !== null && lastAction !== null) {
    let reward = pnlPercent / 10;
    if (pnlPercent > 0) {
      reward += 1.0;
      if (reason.includes('TP')) reward += 1.5;
    } else {
      reward -= 0.8;
      if (reason.includes('SL')) reward -= 1.0;
    }
    if (durationMinutes < 15) reward -= 0.5;
    if (durationMinutes > 60 && pnlPercent > 0) reward += 0.7;

    rlAgent.remember(currentState, lastAction, reward, currentState, true);
    await rlAgent.replay(32);

    console.log(`[RL 🤖] 🎓 APRENDIZAJE | Acción: ${['HOLD', 'LONG', 'SHORT'][lastAction]} | PnL: ${pnlPercent.toFixed(2)}% | Reward: ${reward.toFixed(3)}`);

    if (Math.random() < 0.2) {
      await rlAgent.save().catch(() => { });
    }

    currentState = null;
    lastAction = null;
  }

  // Actualizar CSV
  if (!process.env.VERCEL && fs.existsSync(config.logFile)) {
    try {
      const content = fs.readFileSync(config.logFile, 'utf-8');
      const lines = content.split('\n');
      const headers = lines[0].split(',');
      const statusIdx = headers.indexOf('Status');
      const exitPriceIdx = headers.indexOf('Exit_Price');
      const exitTimeIdx = headers.indexOf('Exit_Time');
      const pnlPercentIdx = headers.indexOf('PnL_Percent');
      const pnlUsdtIdx = headers.indexOf('PnL_USDT');
      const symbolIdx = headers.indexOf('Symbol');

      let updated = false;
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values[symbolIdx]?.trim() === position.symbol && values[statusIdx]?.trim() === 'OPEN') {
          values[statusIdx] = reason.includes('TP') ? 'TP_HIT' : 'SL_HIT';
          values[exitPriceIdx] = exitPrice.toFixed(8);
          values[exitTimeIdx] = exitTime;
          values[pnlPercentIdx] = pnlPercent.toFixed(2);
          values[pnlUsdtIdx] = pnlUSDT.toFixed(2);
          lines[i] = values.join(',');
          updated = true;
          break;
        }
      }

      if (updated) {
        fs.writeFileSync(config.logFile, lines.join('\n'));
        console.log(`✅ [CERRADA] ${position.symbol} | ${reason} | PnL: ${pnlPercent.toFixed(2)}%`);
      }
    } catch (err) {
      console.error('[ERROR] Actualizando CSV:', err.message);
    }
  }

  // Telegram
  const emoji = pnlPercent >= 0 ? '🟢' : '🔴';
  const message = `${emoji} **POSICIÓN CERRADA**\n${position.symbol} ${position.signalType}\nEntrada: $${position.entry_price.toFixed(4)}\nSalida: $${exitPrice.toFixed(4)}\nPnL: ${pnlPercent.toFixed(2)}% ($${pnlUSDT.toFixed(2)})\nDuración: ~${durationMinutes.toFixed(0)}min\nRazón: ${reason}`;

  try {
    await bot.sendMessage(config.chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    console.warn('[WARN] Error Telegram:', err.message);
  }
}


async function getHigherTimeframeBias(symbol, timeframe = '1h') {
  try {
    const htfCandles = await getOHLCV(symbol, 200, timeframe); // 200 velas en 1h o 4h
    if (!htfCandles || htfCandles.length < 50) return 'NEUTRAL';

    const htfInd = calculateAllIndicators(htfCandles);
    if (!htfInd) return 'NEUTRAL';

    // Bias simple pero efectivo
    const aboveEma200 = htfInd.close > htfInd.ema200;
    const strongTrend = htfInd.adx > 25;
    const bullishFlow = htfInd.pdi > htfInd.mdi;

    if (aboveEma200 && strongTrend && bullishFlow) return 'BULLISH';
    if (!aboveEma200 && strongTrend && !bullishFlow) return 'BEARISH';

    return 'NEUTRAL';
  } catch (err) {
    console.warn(`[HTF] Error analizando ${timeframe} para ${symbol}`);
    return 'NEUTRAL';
  }
}

async function getHTFBias(symbol, timeframe = '1h') {
  try {
    const htfCandles = await getOHLCV(symbol, 200, timeframe);
    if (!htfCandles || htfCandles.length < 50) return 'NEUTRAL';

    const closes = htfCandles.map(c => c.close);
    const ema50 = TechnicalIndicators.EMA.calculate({ period: 50, values: closes });
    const ema200 = TechnicalIndicators.EMA.calculate({ period: 200, values: closes });

    const currentClose = closes[closes.length - 1];
    const currentEma50 = ema50[ema50.length - 1];
    const currentEma200 = ema200[ema200.length - 1];

    // Bias fuerte: precio > EMA50 > EMA200 = BULLISH
    if (currentClose > currentEma50 && currentEma50 > currentEma200) return 'BULLISH';
    if (currentClose < currentEma50 && currentEma50 < currentEma200) return 'BEARISH';

    return 'NEUTRAL';
  } catch (err) {
    console.warn(`[HTF] Error en ${timeframe} para ${symbol}`);
    return 'NEUTRAL';
  }
}

// ============ generateSignal COMPLETA Y CORREGIDA ============
async function generateSignal(candles, symbol, sentimentData) {
  if (!candles || candles.length === 0) return null;

  const ind = calculateAllIndicators(candles);
  if (!ind) return null;

  const price = ind.close;
  const regime = detectMarketRegime(ind);

  // Analizadores SMC
  let liquidityMap = { above: [], below: [] };
  let obDetector = { bullish: [], bearish: [] };
  let gapDetector = { bullish: [], bearish: [] };

  try {
    liquidityMap = new LiquidityAnalyzer(candles, price).analyze();
    obDetector = new OrderBlockDetector(candles, price).detect();
    gapDetector = new GapAnalyzer(candles, price).detect();
  } catch (err) {
    console.warn(`[WARN] Analizadores SMC no disponibles para ${symbol}:`, err.message);
  }

  let strategySignals = { long: 0, short: 0, reasons: [] };
  let strategyName = 'MOMENTUM';

  if (regime.regime === 'TRENDING') {
    strategySignals = generateMomentumSignal(ind);
    strategyName = 'MOMENTUM';
  } else if (regime.regime === 'RANGING') {
    strategySignals = generateMeanReversionSignal(ind);
    strategyName = 'MEAN_REVERSION';
  } else {
    strategySignals = generateBreakoutSignal(ind);
    strategyName = 'BREAKOUT';
  }

  let signalType = null;
  if (strategySignals.long > strategySignals.short && strategySignals.long > 40) {
    signalType = 'LONG';
  } else if (strategySignals.short > strategySignals.long && strategySignals.short > 40) {
    signalType = 'SHORT';
  }

  if (!signalType) return null;

  // ========== FILTRO DE SESIÓN (ALTA LIQUIDEZ - LONDON/NY) ==========
  if (MODE !== 'TRAIN') {
    const hourUTC = new Date().getUTCHours();
    const isHighLiquidity = hourUTC >= 8 && hourUTC <= 17;

    if (!isHighLiquidity) {
      console.log('[SESSION ⏰] Fuera de horario alta liquidez');
      return null;
    }
  }


  // ========== FILTRO DE VOLUMEN ==========
  const lastVol = candles[candles.length - 1].volume;
  const avgVol = candles.slice(-10).reduce((a, b) => a + b.volume, 0) / 10;
  if (lastVol < avgVol * 0.8) {
    console.log('[VOL ⚠️] Volumen débil — señal ignorada');
    return null;
  }

  // ========== CÁLCULO TP/SL Y RR ==========
  const atr = ind.atr || (price * 0.01);
  let tp = calculateDynamicTP(signalType, price, atr, liquidityMap, obDetector, gapDetector);
  let sl = calculateDynamicSL(signalType, price, atr, liquidityMap, obDetector, gapDetector);

  const minSLDist = atr * 2.0;
  if (signalType === 'LONG') {
    if (sl > (price - minSLDist)) sl = price - minSLDist;
  } else {
    if (sl < (price + minSLDist)) sl = price + minSLDist;
  }

  const slPercent = Math.abs((price - sl) / price * 100);
  const tpPercent = Math.abs((tp - price) / price * 100);
  const rr = tpPercent / slPercent;

  if (rr < 1.3) return null;

  let finalScore = Math.max(strategySignals.long, strategySignals.short);
  let reasons = strategySignals.reasons.join(' | ');

  if (finalScore < config.minSignalScore) return null;

  // ========== BONUS POR FAIR VALUE GAP (FVG) ACTIVO ==========
  const gapData = gapDetector.getActiveGaps();
  const recentFVG = gapData.nearestFVG || (gapData.fvgs && gapData.fvgs[0]);

  if (recentFVG) {
    const inFVG = price > recentFVG.bottom && price < recentFVG.top;

    if (inFVG) {
      finalScore += 20;
      reasons += ' | FVG Active';
      console.log(`[FVG 🎯] Precio dentro de FVG ${recentFVG.type.toUpperCase()} | Bonus +20 al score`);
    }
  }

  // ========== FILTRO HTF (EMA50 + EMA200) ==========
  const bias1h = await getHTFBias(symbol, '1h');
  const bias4h = await getHTFBias(symbol, '4h');

  console.log(`[HTF 📊] ${symbol} → 1h: ${bias1h} | 4h: ${bias4h}`);

  if (signalType === 'LONG' && (bias1h === 'BEARISH' || bias4h === 'BEARISH')) {
    console.log('[HTF 🚫] LONG rechazado: contra tendencia HTF');
    return null;
  }

  if (signalType === 'SHORT' && (bias1h === 'BULLISH' || bias4h === 'BULLISH')) {
    console.log('[HTF 🚫] SHORT rechazado: contra tendencia HTF');
    return null;
  }

  // ========== RL: ESTADO PROFESIONAL (20 features) ==========
  let state;
  try {
    state = [
      (ind.rsi || 50) / 100,
      ((ind.rsiPrev !== undefined ? ind.rsiPrev : ind.rsi) || 50) / 100,
      (ind.macdHistogram || 0) / 100,
      ((ind.macdHistogramPrev !== undefined ? ind.macdHistogramPrev : ind.macdHistogram) || 0) / 100,
      (ind.adx || 20) / 50,
      (ind.pdi || 20) / 50,
      (ind.mdi || 20) / 50,
      ind.close > (ind.ema50 || ind.close) ? 1 : 0,
      ind.close > (ind.ema200 || ind.close) ? 1 : 0,
      ind.bbWidth || 0.02,
      ((ind.atr || price * 0.01) / price) || 0.01,
      Math.min(ind.volumeRatio || 1, 5),
      regime.regime === 'TRENDING' ? 1 : (regime.regime === 'BREAKOUT' ? 0.8 : (regime.regime === 'RANGING' ? 0.5 : 0)),
      (liquidityMap?.above?.[0]?.strength || 0) / 100,
      (liquidityMap?.below?.[0]?.strength || 0) / 100,
      (obDetector?.bullish?.[0]?.strength || 0) / 100,
      (obDetector?.bearish?.[0]?.strength || 0) / 100,
      ((gapDetector?.bullish?.length || 0) + (gapDetector?.bearish?.length || 0)) / 5,
      finalScore / 100,
      Math.min(rr || 1.5, 10) / 10
    ];
  } catch (err) {
    console.warn(`[RL] Error extrayendo estado para ${symbol}:`, err.message);
    state = new Array(20).fill(0.5);
  }

  currentState = state;

  // ========== DECISIÓN DEL AGENTE RL ==========
  const action = rlAgent.act(state);
  lastAction = action;

  // ========== RL: APRENDIZAJE CONTINUO (SIM) ==========
  let simReward = 0;

  // Reward básico por alineación
  if (
    (action === 1 && signalType === 'LONG') ||
    (action === 2 && signalType === 'SHORT')
  ) {
    simReward += 0.1;
  }

  // Penalización por HOLD
  if (action === 0) {
    simReward -= 0.02;
  }

  // Penalización por ir contra score
  if (finalScore < 80 && action !== 0) {
    simReward -= 0.05;
  }

  rlAgent.remember(state, action, simReward, state, false);

  // Entrena cada X pasos para no bloquear
  if (Math.random() < 0.3) {
    rlAgent.replay(16);
  }


  console.log(`[RL 🤖] Epsilon: ${(rlAgent.epsilon || 1).toFixed(3)} | Acción: ${action} (${['HOLD', 'LONG', 'SHORT'][action]})`);

  if (action === 0) {
    console.log('[RL 🤖] 🚫 SEÑAL RECHAZADA por agente');
    return null;
  }

  if (action === 2) {
    signalType = 'SHORT';
    console.log('[RL 🤖] 🔄 FORZANDO SHORT');
  }

  // Cálculo final de positionSize
  const baseRisk = config.riskPerTrade * 1000;
  let positionSize = (baseRisk / (slPercent / 100));
  if (positionSize > 500) positionSize = 500;

  // Bonus HTF alineación
  if ((signalType === 'LONG' && bias1h === 'BULLISH' && bias4h === 'BULLISH') ||
    (signalType === 'SHORT' && bias1h === 'BEARISH' && bias4h === 'BEARISH')) {
    positionSize *= 1.3;
    console.log('[HTF ✅] Alineación HTF fuerte → tamaño +30%');
  }

  // Penalización si RL fuerza SHORT
  if (action === 2) positionSize *= 0.8;

  const emoji = signalType === 'LONG' ? '🟢' : '🔴';

  return {
    message: `${emoji} **${strategyName} ${signalType}** (RL:${['HOLD', 'LONG', 'SHORT'][action]})\nScore: ${Math.round(finalScore)} | RR: 1:${rr.toFixed(2)}\n$${positionSize.toFixed(0)} | ${price.toFixed(4)}`,
    type: signalType,
    strategy: strategyName,
    price,
    sl,
    tp,
    score: finalScore,
    positionSize,
    reasons,
    atr,
    regime: regime.regime,
    rlAction: action,
    state: state
  };
}

// ============ checkSignals CON NEWS ROBUSTO ============
async function checkSignals() {
  console.log('\n🚀 [CHECK] Iniciando análisis...', new Date().toLocaleString());

  let sentimentData = { shouldPauseTrading: false };
  try {
    sentimentData = await newsAnalyzer.analyze();
  } catch (err) {
    console.warn('[NEWS ⚠️] Error en noticias, continuando sin sentiment:', err.message);
  }

  if (sentimentData.shouldPauseTrading) {
    console.log('[WARNING] Trading pausado por noticias extremas.');
    return;
  }

  for (const symbol of config.symbols) {
    try {
      console.log(`\n[DEBUG] Procesando ${symbol}`);

      // 1. Gestión de posiciones abiertas (CSV local o Supabase)
      const openPositions = await getOpenPositions();
      const position = openPositions.find(p => p.symbol === symbol);

      if (position) {
        // Si hay posición, verificar si cerrar
        console.log(`[POS LEÍDA] ${symbol} ${position.signalType} @ ${position.entry_price}`);
        const candles = await getOHLCV(symbol);
        if (candles.length > 0) {
          const currentPrice = candles[candles.length - 1].close;
          // Verificar SL/TP
          let reason = null;
          if (position.signalType === 'LONG') {
            if (currentPrice >= position.tp) reason = 'TP alcanzado';
            else if (currentPrice <= position.sl) reason = 'SL tocado';
          } else {
            if (currentPrice <= position.tp) reason = 'TP alcanzado';
            else if (currentPrice >= position.sl) reason = 'SL tocado';
          }

          if (reason) {
            await closePosition(position, currentPrice, reason);
          } else {
            // ========= RL STEP (MANTENER POSICIÓN) =========
            // Si mantenemos la posición, premiamos ligeramente si va en positivo
            const pnlCurrent = position.signalType === 'LONG'
              ? (currentPrice - position.entry_price) / position.entry_price
              : (position.entry_price - currentPrice) / position.entry_price;

            // Pequeño reward por floating profit, pequeña penalización por drawdown
            // Esto ayuda a que el agente "sienta" la posición tick a tick
            const stepReward = pnlCurrent > 0 ? 0.05 : -0.05;

            if (currentState && lastAction) {
              // Asumimos que la acción de mantener es "consistente" con la tendencia
              // Actualizamos memoria a corto plazo
              rlAgent.remember(currentState, lastAction, stepReward, currentState, false);
            }
          }
        }
        continue; // No abrir nueva si ya existe
      }

      // 2. Analizar nuevas entradas
      const candles = await getOHLCV(symbol);
      if (candles.length === 0) continue;

      const signal = await generateSignal(candles, symbol, sentimentData);

      if (signal) {
        console.log(`[SIGNAL] ${signal.type} detectado para ${symbol}`);

        // Guardar/Ejecutar señal
        // (Lógica de guardado CSV resturada)
        if (!process.env.VERCEL) {
          try {
            const timestamp = new Date().toISOString();
            // CSV Header: Timestamp,Symbol,Signal,Regime,Strategy,Entry_Price,SL,TP,Position_Size_USDT,Status...
            const entry = `${timestamp},${symbol},${signal.type},${signal.regime},${signal.strategy},${signal.price},${signal.sl},${signal.tp},${signal.positionSize.toFixed(2)},OPEN,,,,,${signal.score},${signal.atr},"${signal.reasons}",${config.timeframe}\n`;
            fs.appendFileSync(config.logFile, entry);
            console.log(`[CSV] Guardado en ${config.logFile}`);
          } catch (e) { console.error('[CSV ERROR]', e.message); }
        }

        // Telegram
        bot.sendMessage(config.chatId, signal.message, { parse_mode: 'Markdown' }).catch(e => console.error(e.message));
      }

      await sleep(1000);

    } catch (err) {
      console.error(`[ERROR] Loop ${symbol}:`, err.message);
    }
  }
  console.log('[DEBUG] Ciclo finalizado\n');
}

// START
if (require.main === module) {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  🎯 TRADING BOT CON RL PROFESIONAL ACTIVADO ║');
  console.log('╚══════════════════════════════════════════════╝');

  // Ejecución inmediata al inicio
  checkSignals();

  // Intervalo
  setInterval(checkSignals, config.checkIntervalMinutes * 60 * 1000);
}