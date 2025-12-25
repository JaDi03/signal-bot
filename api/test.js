module.exports = async (req, res) => {
    res.status(200).json({
        success: true,
        message: "Infraestructura de Vercel funcionando",
        timestamp: new Date().toISOString()
    });
};
