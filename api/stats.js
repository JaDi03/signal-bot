const supabase = require('../supabase_client');

async function readSignals() {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('signals')
            .select('*')
            .order('timestamp', { ascending: false });
        if (error) throw error;
        return data.map(s => ({
            Timestamp: s.timestamp,
            Symbol: s.symbol,
            Signal: s.signal_type,
            Status: s.status,
            PnL_USDT: s.pnl_usdt
        }));
    } catch (err) { return []; }
}

function calculateStats(signals) {
    const closedSignals = signals.filter(s => s.Status === 'TP_HIT' || s.Status === 'SL_HIT');
    if (closedSignals.length === 0) return { totalSignals: signals.length, openSignals: signals.filter(s => s.Status === 'OPEN').length, closedSignals: 0 };
    const winners = closedSignals.filter(s => s.Status === 'TP_HIT');
    const winnersCount = winners.length;
    const losersCount = closedSignals.length - winnersCount;
    const winRate = (winnersCount / closedSignals.length) * 100;
    const totalPnL = closedSignals.reduce((sum, s) => sum + parseFloat(s.PnL_USDT || 0), 0);
    return {
        totalSignals: signals.length,
        openSignals: signals.filter(s => s.Status === 'OPEN').length,
        closedSignals: closedSignals.length,
        winRate: winRate.toFixed(1),
        totalPnL: totalPnL.toFixed(2),
        winners: winnersCount,
        losers: losersCount
    };
}

module.exports = async (req, res) => {
    try {
        const signals = await readSignals();
        const stats = calculateStats(signals);
        res.status(200).json({ success: true, data: stats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
