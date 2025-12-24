const { spawn } = require('child_process');
const path = require('path');

// ============================================
// CONFIGURACIÓN
// ============================================
const processes = [];

// Colores para la consola
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',

    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};

// ============================================
// FUNCIONES DE UTILIDAD
// ============================================
function log(prefix, color, message) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${prefix}${colors.reset} ${message}`);
}

function startProcess(name, script, color) {
    log(name, color, 'Iniciando...');

    const proc = spawn('node', [script], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        lines.forEach(line => log(name, color, line));
    });

    proc.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        lines.forEach(line => log(name, colors.red, `ERROR: ${line}`));
    });

    proc.on('close', (code) => {
        if (code !== 0 && code !== null) {
            log(name, colors.red, `Proceso terminado con código ${code}`);
        } else {
            log(name, color, 'Proceso terminado');
        }
    });

    proc.on('error', (err) => {
        log(name, colors.red, `Error al iniciar: ${err.message}`);
    });

    processes.push({ name, proc });
    return proc;
}

// ============================================
// MANEJO DE SEÑALES
// ============================================
function cleanup() {
    console.log('\n');
    log('MAIN', colors.yellow, 'Deteniendo todos los procesos...');

    processes.forEach(({ name, proc }) => {
        try {
            proc.kill('SIGTERM');
            log(name, colors.yellow, 'Detenido');
        } catch (err) {
            log(name, colors.red, `Error al detener: ${err.message}`);
        }
    });

    setTimeout(() => {
        log('MAIN', colors.green, '¡Hasta luego!');
        process.exit(0);
    }, 1000);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// ============================================
// INICIO
// ============================================
console.clear();
console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   ${colors.bright}${colors.cyan}🤖 SISTEMA DE TRADING BOT v2.0${colors.reset}                      ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

log('MAIN', colors.green, 'Iniciando sistema completo...\n');

// Iniciar los tres procesos
setTimeout(() => {
    startProcess('BOT     ', 'bot.js', colors.cyan);
}, 500);

setTimeout(() => {
    startProcess('TRACKER ', 'performance_tracker.js', colors.magenta);
}, 1500);

setTimeout(() => {
    startProcess('SERVER  ', 'server.js', colors.green);
}, 2500);

setTimeout(() => {
    console.log('\n');
    log('MAIN', colors.green, '✓ Todos los procesos iniciados');
    log('MAIN', colors.cyan, '✓ Bot de señales activo');
    log('MAIN', colors.magenta, '✓ Tracker de desempeño activo');
    log('MAIN', colors.green, '✓ Dashboard disponible en http://localhost:3000');
    console.log('\n');
    log('MAIN', colors.yellow, 'Presiona Ctrl+C para detener todos los procesos');
    console.log('\n');
}, 3500);
