const express = require('express');
const fs = require('fs');
const path = require('path');
const supabase = require('./supabase_client');

const app = express();
const PORT = 3000;

// Servir archivos estáticos
app.use(express.static('public'));

// ============================================
// FUNCIONES DE LECTURA DE CSV
// ============================================
async function readSignals() {
    try {
        // PRIORIDAD: Supabase si está configurado y el cliente se inició correctamente
        if (supabase) {
            console.log('[INFO] Reading signals from Supabase...');
            const { data, error } = await supabase
                .from('signals')
                .select('*')
                .order('timestamp', { ascending: false });

            if (error) throw error;

            // Mapear campos de Supabase a formato CSV para compatibilidad con el Dashboard
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

        // FALLBACK: CSV Local
        if (!fs.existsSync('signals_log.csv')) {
            return [];
        }

        const content = fs.readFileSync('signals_log.csv', 'utf-8');
        const lines = content.trim().split('\n');

        if (lines.length <= 1) {
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
// CALCULAR ESTADÍSTICAS
// ============================================
function calculateStats(signals) {
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
            winners: 0,
            losers: 0,
            bySymbol: {},
            byStrategy: {},
            byRegime: {}
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

    // Stats por símbolo
    const bySymbol = {};
    closedSignals.forEach(s => {
        if (!bySymbol[s.Symbol]) {
            bySymbol[s.Symbol] = { total: 0, wins: 0, losses: 0, pnl: 0 };
        }
        bySymbol[s.Symbol].total++;
        if (s.Status === 'TP_HIT') bySymbol[s.Symbol].wins++;
        else bySymbol[s.Symbol].losses++;
        bySymbol[s.Symbol].pnl += parseFloat(s.PnL_USDT || 0);
    });

    // Stats por estrategia
    const byStrategy = {};
    closedSignals.forEach(s => {
        if (!byStrategy[s.Strategy]) {
            byStrategy[s.Strategy] = { total: 0, wins: 0, losses: 0, pnl: 0 };
        }
        byStrategy[s.Strategy].total++;
        if (s.Status === 'TP_HIT') byStrategy[s.Strategy].wins++;
        else byStrategy[s.Strategy].losses++;
        byStrategy[s.Strategy].pnl += parseFloat(s.PnL_USDT || 0);
    });

    // Stats por régimen
    const byRegime = {};
    closedSignals.forEach(s => {
        if (!byRegime[s.Regime]) {
            byRegime[s.Regime] = { total: 0, wins: 0, losses: 0, pnl: 0 };
        }
        byRegime[s.Regime].total++;
        if (s.Status === 'TP_HIT') byRegime[s.Regime].wins++;
        else byRegime[s.Regime].losses++;
        byRegime[s.Regime].pnl += parseFloat(s.PnL_USDT || 0);
    });

    return {
        totalSignals: signals.length,
        openSignals: signals.filter(s => s.Status === 'OPEN').length,
        closedSignals: closedSignals.length,
        winRate,
        totalPnL,
        avgWin,
        avgLoss,
        profitFactor,
        winners: winners.length,
        losers: losers.length,
        bySymbol,
        byStrategy,
        byRegime
    };
}

// ============================================
// API ENDPOINTS
// ============================================

// API ENDPOINTS
// ============================================

// Obtener todas las señales
app.get('/api/signals', async (req, res) => {
    try {
        const signals = await readSignals();
        res.json({ success: true, data: signals });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Obtener solo señales abiertas
app.get('/api/signals/active', async (req, res) => {
    try {
        const signals = await readSignals();
        const activeSignals = signals.filter(s => s.Status === 'OPEN');
        res.json({ success: true, data: activeSignals });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Obtener estadísticas
app.get('/api/stats', async (req, res) => {
    try {
        const signals = await readSignals();
        const stats = calculateStats(signals);
        res.json({ success: true, data: stats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Obtener desempeño por símbolo
app.get('/api/performance/:symbol', async (req, res) => {
    try {
        const signals = await readSignals();
        const symbolSignals = signals.filter(s => s.Symbol === req.params.symbol);
        const stats = calculateStats(symbolSignals);
        res.json({ success: true, data: stats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Servir el dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════╗');
    console.log('║   DASHBOARD SERVER v1.0                ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`[INFO] Server running at http://localhost:${PORT}`);
    console.log(`[INFO] Open your browser and navigate to the URL above\n`);
});
