const { readSignals } = require('../database_utils');

module.exports = async (req, res) => {
    try {
        const signals = await readSignals();
        res.status(200).json({ success: true, data: signals });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
