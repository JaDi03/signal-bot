const fs = require('fs');
const supabase = require('./supabase_client');

async function readSignals() {
    try {
        if (supabase) {
            const { data, error } = await supabase
                .from('signals')
                .select('*')
                .order('timestamp', { ascending: false });

            if (error) throw error;

            return data.map(s => ({
                Timestamp: s.timestamp,
                Symbol: s.symbol,
                Signal: s.signal_type,
                Regime: s.regime,
                Strategy: s.strategy,
                Entry_Price: s.entry_price,
                SL: s.sl_price,
                TP: s.tp_price,
                Exit_Price: s.exit_price,
                Exit_Time: s.exit_time,
                PnL_Percent: s.pnl_percent,
                PnL_USDT: s.pnl_usdt,
                Status: s.status,
                Score: s.score,
                ATR: s.atr,
                Reasons: s.reasons,
                Timeframe: s.timeframe
            }));
        }

        if (!fs.existsSync('signals_log.csv')) return [];

        const content = fs.readFileSync('signals_log.csv', 'utf-8');
        const lines = content.trim().split('\n');
        if (lines.length <= 1) return [];

        const headers = lines[0].split(',');
        return lines.slice(1).map(line => {
            const values = line.split(',');
            const signal = {};
            headers.forEach((h, i) => signal[h.trim()] = values[i]?.trim().replace(/"/g, '') || '');
            return signal;
        });
    } catch (err) {
        console.error('[DATABASE UTILS ERROR]', err.message);
        return [];
    }
}

function calculateStats(signals) {
    const closedSignals = signals.filter(s => s.Status === 'TP_HIT' || s.Status === 'SL_HIT');
    if (closedSignals.length === 0) return { totalSignals: signals.length, openSignals: signals.filter(s => s.Status === 'OPEN').length, closedSignals: 0 };

    const winners = closedSignals.filter(s => s.Status === 'TP_HIT');
    const losers = closedSignals.filter(s => s.Status === 'SL_HIT');
    const winRate = (winners.length / closedSignals.length) * 100;
    const totalPnL = closedSignals.reduce((sum, s) => sum + parseFloat(s.PnL_USDT || 0), 0);
    const totalWins = winners.reduce((sum, s) => sum + parseFloat(s.PnL_USDT || 0), 0);
    const totalLosses = Math.abs(losers.reduce((sum, s) => sum + parseFloat(s.PnL_USDT || 0), 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 999;

    return {
        totalSignals: signals.length,
        openSignals: signals.filter(s => s.Status === 'OPEN').length,
        closedSignals: closedSignals.length,
        winRate: winRate.toFixed(1),
        totalPnL: totalPnL.toFixed(2),
        profitFactor: profitFactor.toFixed(2),
        winners: winners.length,
        losers: losers.length
    };
}

module.exports = { readSignals, calculateStats };


// Añade esta función a tu módulo de base de datos
async function saveSignal(signalData) {
    try {
        const payload = {
            timestamp: new Date().toISOString(),
            symbol: signalData.symbol,
            signal_type: signalData.type,
            regime: signalData.regime,
            strategy: signalData.strategy,
            entry_price: signalData.price,
            sl_price: signalData.sl,
            tp_price: signalData.tp,
            status: 'OPEN', // Inicia abierta hasta que el monitor de precios la cierre
            score: signalData.score,
            atr: signalData.atr,
            reasons: signalData.reasons,
            timeframe: config.timeframe || '15m'
        };

        // 1. Guardar en Supabase (Si está configurado)
        if (supabase) {
            const { error } = await supabase.from('signals').insert([payload]);
            if (error) console.error('[SUPABASE ERROR]', error.message);
        }

        // 2. Guardar en CSV (Respaldo local siempre)
        const csvLine = `\n${payload.timestamp},${payload.symbol},${payload.signal_type},${payload.regime},${payload.strategy},${payload.entry_price},${payload.sl_price},${payload.tp_price},OPEN,${payload.score},${payload.atr},"${payload.reasons}",${payload.timeframe}`;
        
        if (!fs.existsSync('signals_log.csv')) {
            const headers = 'Timestamp,Symbol,Signal,Regime,Strategy,Entry_Price,SL,TP,Status,Score,ATR,Reasons,Timeframe';
            fs.writeFileSync('signals_log.csv', headers + csvLine);
        } else {
            fs.appendFileSync('signals_log.csv', csvLine);
        }

        console.log(`[DATABASE] Signal saved successfully for ${signalData.symbol}`);
    } catch (err) {
        console.error('[SAVE SIGNAL ERROR]', err.message);
    }
}