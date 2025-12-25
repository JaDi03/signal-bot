const { readSignals, calculateStats } = require('../database_utils');

module.exports = async (req, res) => {
    try {
        const signals = await readSignals();
        const stats = calculateStats(signals);
        res.status(200).json({ success: true, data: stats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
