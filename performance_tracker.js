const ccxt = require('ccxt');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

// ============================================
// CONFIGURACIÓN
// ============================================
const config = {
    logFile: 'signals_log.csv',
    checkIntervalMinutes: 5,  // Verificar cada 5 minutos
    telegramToken: 'TU_BOT_TOKEN_AQUÍ',
    chatId: 'TU_CHAT_ID_AQUÍ',
};

const exchange = new ccxt.binance({ enableRateLimit: true });
const bot = new TelegramBot(config.telegramToken, { polling: false });

// Utility: Format price with dynamic precision based on value
function formatPrice(price) {
    const p = parseFloat(price);
    if (isNaN(p)) return 'N/A';
    if (p < 1) return p.toFixed(4);
    if (p < 10) return p.toFixed(3);
    return p.toFixed(2);
}

// ============================================
// LEER Y PARSEAR CSV
// ============================================
function readSignals() {
    try {
        if (!fs.existsSync(config.logFile)) {
            console.log('[WARN] signals_log.csv not found');
            return [];
        }

        const content = fs.readFileSync(config.logFile, 'utf-8');
        const lines = content.trim().split('\n');

        if (lines.length <= 1) {
            console.log('[INFO] No signals in CSV yet');
            return [];
        }

        const headers = lines[0].split(',');
        const signals = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            if (values.length < headers.length) continue;

            const signal = {};
            headers.forEach((header, index) => {
                signal[header.trim()] = values[index]?.trim().replace(/"/g, '') || '';
            });

            signals.push(signal);
        }

        return signals;
    } catch (err) {
        console.error('[ERROR] readSignals:', err.message);
        return [];
    }
}

// ============================================
// ACTUALIZAR CSV
// ============================================
function updateSignal(index, updatedSignal) {
    try {
        const content = fs.readFileSync(config.logFile, 'utf-8');
        const lines = content.trim().split('\n');

        if (index + 1 >= lines.length) {
            console.error('[ERROR] Invalid signal index');
            return false;
        }

        // Reconstruir la línea
        const values = [
            updatedSignal.Timestamp,
            updatedSignal.Symbol,
            updatedSignal.Signal,
            updatedSignal.Regime,
            updatedSignal.Strategy,
            updatedSignal.Entry_Price,
            updatedSignal.SL,
            updatedSignal.TP,
            updatedSignal.Position_Size_USDT,
            updatedSignal.Status,
            updatedSignal.Exit_Price || '',
            updatedSignal.Exit_Time || '',
            updatedSignal.PnL_Percent || '',
            updatedSignal.PnL_USDT || '',
            updatedSignal.Score,
            updatedSignal.ATR,
            `"${updatedSignal.Reasons}"`,
            updatedSignal.Timeframe
        ];

        lines[index + 1] = values.join(',');
        fs.writeFileSync(config.logFile, lines.join('\n') + '\n');
        return true;
    } catch (err) {
        console.error('[ERROR] updateSignal:', err.message);
        return false;
    }
}

// ============================================
// VERIFICAR PRECIOS Y ACTUALIZAR ESTADO
// ============================================
async function checkOpenSignals() {
    console.log('[DEBUG] Checking open signals...');

    const signals = readSignals();
    const openSignals = signals.filter(s => s.Status === 'OPEN');

    if (openSignals.length === 0) {
        console.log('[INFO] No open signals to check');
        return;
    }

    console.log(`[INFO] Found ${openSignals.length} open signals`);

    for (let i = 0; i < signals.length; i++) {
        const signal = signals[i];

        if (signal.Status !== 'OPEN') continue;

        try {
            console.log(`[DEBUG] Checking ${signal.Symbol} - ${signal.Signal}`);

            // Obtener precio actual
            const ticker = await exchange.fetchTicker(signal.Symbol);
            const currentPrice = ticker.last;

            const entryPrice = parseFloat(signal.Entry_Price);
            const sl = parseFloat(signal.SL);
            const tp = parseFloat(signal.TP);
            const positionSize = parseFloat(signal.Position_Size_USDT) || 100;

            let statusChanged = false;
            let newStatus = 'OPEN';
            let exitPrice = null;
            let pnlPercent = 0;
            let pnlUSDT = 0;

            // Verificar si alcanzó TP o SL
            if (signal.Signal === 'LONG') {
                if (currentPrice >= tp) {
                    // TP alcanzado
                    newStatus = 'TP_HIT';
                    exitPrice = tp;
                    pnlPercent = ((tp - entryPrice) / entryPrice) * 100;
                    pnlUSDT = positionSize * (pnlPercent / 100);
                    statusChanged = true;
                } else if (currentPrice <= sl) {
                    // SL alcanzado
                    newStatus = 'SL_HIT';
                    exitPrice = sl;
                    pnlPercent = ((sl - entryPrice) / entryPrice) * 100;
                    pnlUSDT = positionSize * (pnlPercent / 100);
                    statusChanged = true;
                }
            } else if (signal.Signal === 'SHORT') {
                if (currentPrice <= tp) {
                    // TP alcanzado
                    newStatus = 'TP_HIT';
                    exitPrice = tp;
                    pnlPercent = ((entryPrice - tp) / entryPrice) * 100;
                    pnlUSDT = positionSize * (pnlPercent / 100);
                    statusChanged = true;
                } else if (currentPrice >= sl) {
                    // SL alcanzado
                    newStatus = 'SL_HIT';
                    exitPrice = sl;
                    pnlPercent = ((entryPrice - sl) / entryPrice) * 100;
                    pnlUSDT = positionSize * (pnlPercent / 100);
                    statusChanged = true;
                }
            }

            if (statusChanged) {
                console.log(`[SIGNAL CLOSED] ${signal.Symbol} ${signal.Signal} - ${newStatus}`);

                // Actualizar señal
                signal.Status = newStatus;
                signal.Exit_Price = formatPrice(exitPrice);
                signal.Exit_Time = new Date().toISOString();
                signal.PnL_Percent = pnlPercent.toFixed(2);
                signal.PnL_USDT = pnlUSDT.toFixed(2);

                updateSignal(i, signal);

                // Enviar notificación de Telegram
                const emoji = newStatus === 'TP_HIT' ? '✅' : '❌';
                const color = newStatus === 'TP_HIT' ? 'GANANCIA' : 'PÉRDIDA';

                const entryTime = new Date(signal.Timestamp);
                const exitTime = new Date(signal.Exit_Time);
                const duration = Math.floor((exitTime - entryTime) / 1000 / 60); // minutos
                const hours = Math.floor(duration / 60);
                const minutes = duration % 60;

                const message = `${emoji} **${newStatus.replace('_', ' ')} - ${signal.Symbol}**\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `📊 Estrategia: ${signal.Strategy}\n` +
                    `💰 Entry: $${signal.Entry_Price}\n` +
                    `🎯 Exit: $${formatPrice(exitPrice)}\n` +
                    `📈 PnL: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% (${pnlUSDT >= 0 ? '+' : ''}$${pnlUSDT.toFixed(2)} USDT)\n` +
                    `⏱️ Duración: ${hours}h ${minutes}m\n` +
                    `🔥 Score: ${signal.Score}/100\n\n` +
                    `⏰ ${new Date().toLocaleString()}`;

                try {
                    await bot.sendMessage(config.chatId, message, { parse_mode: 'Markdown' });
                    console.log('[SUCCESS] Telegram notification sent');
                } catch (telegramErr) {
                    console.error('[ERROR] Telegram:', telegramErr.message);
                }
            } else {
                // Calcular PnL flotante
                let floatingPnL = 0;
                if (signal.Signal === 'LONG') {
                    floatingPnL = ((currentPrice - entryPrice) / entryPrice) * 100;
                } else {
                    floatingPnL = ((entryPrice - currentPrice) / entryPrice) * 100;
                }
                console.log(`[INFO] ${signal.Symbol} ${signal.Signal} - Floating PnL: ${floatingPnL.toFixed(2)}%`);
            }

            // Pequeña pausa para no saturar la API
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (err) {
            console.error(`[ERROR] Checking ${signal.Symbol}:`, err.message);
        }
    }

    console.log('[DEBUG] Finished checking signals\n');
}

// ============================================
// CALCULAR ESTADÍSTICAS
// ============================================
function calculateStats() {
    const signals = readSignals();
    const closedSignals = signals.filter(s => s.Status === 'TP_HIT' || s.Status === 'SL_HIT');

    if (closedSignals.length === 0) {
        return {
            totalSignals: signals.length,
            openSignals: signals.filter(s => s.Status === 'OPEN').length,
            closedSignals: 0,
            winRate: 0,
            totalPnL: 0,
            avgWin: 0,
            avgLoss: 0,
            profitFactor: 0,
            bestTrade: null,
            worstTrade: null
        };
    }

    const winners = closedSignals.filter(s => s.Status === 'TP_HIT');
    const losers = closedSignals.filter(s => s.Status === 'SL_HIT');

    const winRate = (winners.length / closedSignals.length) * 100;

    const totalPnL = closedSignals.reduce((sum, s) => sum + parseFloat(s.PnL_USDT || 0), 0);

    const totalWins = winners.reduce((sum, s) => sum + parseFloat(s.PnL_USDT || 0), 0);
    const totalLosses = Math.abs(losers.reduce((sum, s) => sum + parseFloat(s.PnL_USDT || 0), 0));

    const avgWin = winners.length > 0 ? totalWins / winners.length : 0;
    const avgLoss = losers.length > 0 ? totalLosses / losers.length : 0;

    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;

    const bestTrade = closedSignals.reduce((best, s) => {
        const pnl = parseFloat(s.PnL_USDT || 0);
        return !best || pnl > parseFloat(best.PnL_USDT || 0) ? s : best;
    }, null);

    const worstTrade = closedSignals.reduce((worst, s) => {
        const pnl = parseFloat(s.PnL_USDT || 0);
        return !worst || pnl < parseFloat(worst.PnL_USDT || 0) ? s : worst;
    }, null);

    return {
        totalSignals: signals.length,
        openSignals: signals.filter(s => s.Status === 'OPEN').length,
        closedSignals: closedSignals.length,
        winRate: winRate.toFixed(1),
        totalPnL: totalPnL.toFixed(2),
        avgWin: avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        profitFactor: profitFactor.toFixed(2),
        bestTrade,
        worstTrade,
        winners: winners.length,
        losers: losers.length
    };
}

// ============================================
// RESUMEN DIARIO
// ============================================
async function sendDailySummary() {
    console.log('[DEBUG] Generating daily summary...');

    const stats = calculateStats();

    if (stats.closedSignals === 0) {
        console.log('[INFO] No closed signals for daily summary');
        return;
    }

    const message = `📊 **RESUMEN DIARIO - ${new Date().toLocaleDateString()}**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📈 Operaciones: ${stats.closedSignals}\n` +
        `✅ Ganadoras: ${stats.winners} (${stats.winRate}%)\n` +
        `❌ Perdedoras: ${stats.losers}\n` +
        `💰 PnL Total: ${stats.totalPnL >= 0 ? '+' : ''}$${stats.totalPnL} USDT\n` +
        `📊 Profit Factor: ${stats.profitFactor}\n` +
        `🏆 Mejor: ${stats.bestTrade?.Symbol} ${stats.bestTrade?.Signal} +${stats.bestTrade?.PnL_Percent}%\n` +
        `📉 Peor: ${stats.worstTrade?.Symbol} ${stats.worstTrade?.Signal} ${stats.worstTrade?.PnL_Percent}%\n` +
        `📂 Abiertas: ${stats.openSignals}\n\n` +
        `⏰ ${new Date().toLocaleString()}`;

    try {
        await bot.sendMessage(config.chatId, message, { parse_mode: 'Markdown' });
        console.log('[SUCCESS] Daily summary sent');
    } catch (err) {
        console.error('[ERROR] Telegram:', err.message);
    }
}

// ============================================
// INICIAR TRACKER
// ============================================
console.log('╔════════════════════════════════════════╗');
console.log('║   PERFORMANCE TRACKER v1.0             ║');
console.log('╚════════════════════════════════════════╝');
console.log(`[INFO] Intervalo de verificación: ${config.checkIntervalMinutes} minutos\n`);

// Ejecutar inmediatamente
checkOpenSignals();

// Verificar cada intervalo
setInterval(checkOpenSignals, config.checkIntervalMinutes * 60 * 1000);

// Resumen diario a las 23:59
const now = new Date();
const tomorrow = new Date(now);
tomorrow.setDate(tomorrow.getDate() + 1);
tomorrow.setHours(23, 59, 0, 0);
const msUntilSummary = tomorrow - now;

setTimeout(() => {
    sendDailySummary();
    // Luego cada 24 horas
    setInterval(sendDailySummary, 24 * 60 * 60 * 1000);
}, msUntilSummary);

console.log(`[INFO] Daily summary scheduled for ${tomorrow.toLocaleString()}\n`);
