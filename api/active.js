const supabase = require('../supabase_client');
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
    // 1. Intentar leer de Supabase
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('signals')
                .select('*')
                .eq('status', 'OPEN')
                .order('timestamp', { ascending: false });

            if (!error && data) {
                return res.status(200).json({
                    success: true, data: data.map(s => ({
                        Timestamp: s.timestamp,
                        Symbol: s.symbol,
                        Signal: s.signal_type,
                        Price: s.entry_price,
                        TP: s.tp_price,
                        SL: s.sl_price,
                        Status: s.status,
                        Score: s.score || 0
                    }))
                });
            }
        } catch (err) {
            console.warn('[API] Supabase error, falling back to CSV:', err.message);
        }
    }

    // 2. Fallback: Leer de CSV Local
    try {
        const logFile = path.resolve(__dirname, '../signals_log.csv');
        if (!fs.existsSync(logFile)) {
            return res.status(200).json({ success: true, data: [] });
        }

        const content = fs.readFileSync(logFile, 'utf-8');
        const lines = content.trim().split('\n');
        if (lines.length <= 1) return res.status(200).json({ success: true, data: [] });

        const headers = lines[0].split(',').map(h => h.trim());
        const statusIdx = headers.indexOf('Status');
        const symbolIdx = headers.indexOf('Symbol');
        const typeIdx = headers.indexOf('Signal');
        const priceIdx = headers.indexOf('Entry_Price');
        const tpIdx = headers.indexOf('TP');
        const slIdx = headers.indexOf('SL');
        const scoreIdx = headers.indexOf('Score');
        const timeIdx = headers.indexOf('Timestamp');

        const activeSignals = [];
        // Leer de abajo hacia arriba (más recientes primero)
        for (let i = lines.length - 1; i >= 1; i--) {
            // Regex para CSV que respeta comillas
            const values = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
            if (!values) continue;

            // Limpiar valores
            const cleanValues = values.map(v => v ? v.trim().replace(/^"|"$/g, '') : '');

            if (cleanValues[statusIdx] === 'OPEN') {
                activeSignals.push({
                    Timestamp: cleanValues[timeIdx],
                    Symbol: cleanValues[symbolIdx],
                    Signal: cleanValues[typeIdx],
                    Price: parseFloat(cleanValues[priceIdx]),
                    TP: parseFloat(cleanValues[tpIdx]),
                    SL: parseFloat(cleanValues[slIdx]),
                    Status: 'OPEN',
                    Score: parseFloat(cleanValues[scoreIdx]) || 0
                });
            }
        }

        res.status(200).json({ success: true, data: activeSignals });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
