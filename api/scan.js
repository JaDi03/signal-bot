const { checkSignals } = require('../bot');

module.exports = async (req, res) => {
    // En Vercel Serverless (CommonJS), req.headers es un objeto plano
    const authHeader = req.headers['authorization'];

    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ success: false, message: 'No autorizado' });
    }

    try {
        console.log('[CRON] Iniciando escaneo de mercado...');
        // Realizamos un escaneo de todas las monedas
        await checkSignals();

        res.status(200).json({
            success: true,
            timestamp: new Date().toISOString(),
            message: 'Escaneo completado con éxito'
        });
    } catch (err) {
        console.error('[CRON ERROR]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
