const fs = require('fs');
const supabase = require('../supabase_client');

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
        return [];
    } catch (err) {
        console.error('[API ERROR]', err.message);
        return [];
    }
}

module.exports = async (req, res) => {
    try {
        console.log('[API] Fetching signals...');
        const signals = await readSignals();
        res.status(200).json({ success: true, data: signals });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
