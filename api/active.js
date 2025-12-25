const supabase = require('../supabase_client');

module.exports = async (req, res) => {
    if (!supabase) return res.status(200).json({ success: true, data: [] });
    try {
        const { data, error } = await supabase
            .from('signals')
            .select('*')
            .eq('status', 'OPEN')
            .order('timestamp', { ascending: false });
        if (error) throw error;
        res.status(200).json({
            success: true, data: data.map(s => ({
                Timestamp: s.timestamp,
                Symbol: s.symbol,
                Signal: s.signal_type,
                Price: s.entry_price,
                TP: s.tp_price,
                SL: s.sl_price,
                Status: s.status
            }))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
