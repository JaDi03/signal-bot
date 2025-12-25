-- Esquema para SignalBot en Supabase

-- Crear tabla de señales
CREATE TABLE IF NOT EXISTS signals (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    symbol TEXT NOT NULL,
    signal_type TEXT NOT NULL, -- LONG, SHORT
    regime TEXT,
    strategy TEXT,
    entry_price NUMERIC,
    sl_price NUMERIC,
    tp_price NUMERIC,
    exit_price NUMERIC,
    exit_time TIMESTAMPTZ,
    pnl_percent NUMERIC,
    pnl_usdt NUMERIC,
    status TEXT DEFAULT 'OPEN', -- OPEN, TP_HIT, SL_HIT, CLOSED
    score INTEGER,
    atr NUMERIC,
    reasons TEXT,
    timeframe TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp);
