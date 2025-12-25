const { readSignals } = require('../database_utils');

module.exports = async (req, res) => {
    try {
        const signals = await readSignals();
        const activeSignals = signals.filter(s => s.Status === 'OPEN');
        res.status(200).json({ success: true, data: activeSignals });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
