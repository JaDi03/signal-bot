const { createClient } = require('@supabase/supabase-js');
try {
    require('dotenv').config();
} catch (err) {
    // Ignorar si no está instalado (entorno Vercel)
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// No lanzamos error fatal aquí para permitir que Vercel termine el Build 
// aunque no se hayan puesto las variables aún.
let supabase = null;

if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[INFO] Cliente de Supabase inicializado correctamente');
} else {
    console.warn('[WARN] Faltan variables de entorno SUPABASE_URL o SUPABASE_KEY. Supabase no estará disponible.');
}

module.exports = supabase;
