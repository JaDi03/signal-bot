// ============================================
// VARIABLES GLOBALES
// ============================================
let allSignals = [];
let stats = {};
let charts = {};

// ============================================
// FETCH DE DATOS
// ============================================
async function fetchData() {
    try {
        // Obtener señales
        const signalsResponse = await fetch('/api/signals');
        const signalsData = await signalsResponse.json();
        allSignals = signalsData.data || [];

        // Obtener estadísticas
        const statsResponse = await fetch('/api/stats');
        const statsData = await statsResponse.json();
        stats = statsData.data || {};

        // Actualizar UI
        updateMetrics();
        updateActiveSignals();
        updateSignalsTable();
        updateCharts();
        updateLastUpdate();

    } catch (err) {
        console.error('Error fetching data:', err);
    }
}

// ============================================
// ACTUALIZAR MÉTRICAS
// ============================================
function updateMetrics() {
    document.getElementById('winRate').textContent = `${stats.winRate || 0}%`;

    const pnl = parseFloat(stats.totalPnL || 0);
    const pnlElement = document.getElementById('totalPnL');
    pnlElement.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
    pnlElement.style.color = pnl >= 0 ? '#4caf50' : '#f44336';

    document.getElementById('profitFactor').textContent = parseFloat(stats.profitFactor || 0).toFixed(2);
    document.getElementById('totalTrades').textContent = `${stats.closedSignals || 0}/${stats.totalSignals || 0}`;
}

// ============================================
// ACTUALIZAR SEÑALES ACTIVAS
// ============================================
function updateActiveSignals() {
    const tbody = document.getElementById('activeSignalsBody');
    const activeSignals = allSignals.filter(s => s.Status === 'OPEN');

    if (activeSignals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="no-data">No hay señales activas</td></tr>';
        return;
    }

    tbody.innerHTML = activeSignals.map(signal => {
        const entry = parseFloat(signal.Entry_Price);
        const tp = parseFloat(signal.TP);
        const sl = parseFloat(signal.SL);

        // Calcular PnL flotante (placeholder - necesitaría precio actual)
        const floatingPnL = 0; // Se actualizaría con precio en tiempo real

        const timestamp = new Date(signal.Timestamp);
        const now = new Date();
        const duration = Math.floor((now - timestamp) / 1000 / 60); // minutos
        const hours = Math.floor(duration / 60);
        const minutes = duration % 60;

        return `
            <tr>
                <td><strong>${signal.Symbol}</strong></td>
                <td><span class="signal-${signal.Signal.toLowerCase()}">${signal.Signal}</span></td>
                <td>${signal.Strategy}</td>
                <td>$${entry.toFixed(2)}</td>
                <td>$${tp.toFixed(2)}</td>
                <td>$${sl.toFixed(2)}</td>
                <td><strong>${signal.Score}/100</strong></td>
                <td class="${floatingPnL >= 0 ? 'pnl-positive' : 'pnl-negative'}">
                    ${floatingPnL >= 0 ? '+' : ''}${floatingPnL.toFixed(2)}%
                </td>
                <td>${hours}h ${minutes}m</td>
            </tr>
        `;
    }).join('');
}

// ============================================
// ACTUALIZAR TABLA DE SEÑALES
// ============================================
function updateSignalsTable() {
    const tbody = document.getElementById('signalsBody');

    if (allSignals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="no-data">No hay señales registradas</td></tr>';
        return;
    }

    // Aplicar filtros
    let filteredSignals = [...allSignals];

    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    if (searchTerm) {
        filteredSignals = filteredSignals.filter(s =>
            s.Symbol.toLowerCase().includes(searchTerm)
        );
    }

    const statusFilter = document.getElementById('statusFilter').value;
    if (statusFilter) {
        filteredSignals = filteredSignals.filter(s => s.Status === statusFilter);
    }

    const signalTypeFilter = document.getElementById('signalTypeFilter').value;
    if (signalTypeFilter) {
        filteredSignals = filteredSignals.filter(s => s.Signal === signalTypeFilter);
    }

    // Ordenar por fecha (más reciente primero)
    filteredSignals.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));

    tbody.innerHTML = filteredSignals.map(signal => {
        const timestamp = new Date(signal.Timestamp).toLocaleString();
        const entry = parseFloat(signal.Entry_Price);
        const exit = signal.Exit_Price ? parseFloat(signal.Exit_Price) : null;
        const pnlPercent = signal.PnL_Percent ? parseFloat(signal.PnL_Percent) : null;
        const pnlUSDT = signal.PnL_USDT ? parseFloat(signal.PnL_USDT) : null;

        let statusBadge = '';
        if (signal.Status === 'OPEN') {
            statusBadge = '<span class="status-badge status-open">Abierta</span>';
        } else if (signal.Status === 'TP_HIT') {
            statusBadge = '<span class="status-badge status-tp">TP ✓</span>';
        } else if (signal.Status === 'SL_HIT') {
            statusBadge = '<span class="status-badge status-sl">SL ✗</span>';
        }

        return `
            <tr>
                <td>${timestamp}</td>
                <td><strong>${signal.Symbol}</strong></td>
                <td><span class="signal-${signal.Signal.toLowerCase()}">${signal.Signal}</span></td>
                <td>${signal.Strategy}</td>
                <td>${signal.Regime}</td>
                <td>$${entry.toFixed(2)}</td>
                <td>${exit ? '$' + exit.toFixed(2) : '-'}</td>
                <td class="${pnlPercent !== null ? (pnlPercent >= 0 ? 'pnl-positive' : 'pnl-negative') : ''}">
                    ${pnlPercent !== null ? (pnlPercent >= 0 ? '+' : '') + pnlPercent.toFixed(2) + '%' : '-'}
                </td>
                <td class="${pnlUSDT !== null ? (pnlUSDT >= 0 ? 'pnl-positive' : 'pnl-negative') : ''}">
                    ${pnlUSDT !== null ? (pnlUSDT >= 0 ? '+' : '') + '$' + pnlUSDT.toFixed(2) : '-'}
                </td>
                <td><strong>${signal.Score}/100</strong></td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join('');
}

// ============================================
// ACTUALIZAR GRÁFICOS
// ============================================
function updateCharts() {
    updateEquityChart();
    updateSymbolChart();
    updateStrategyChart();
    updatePnLDistChart();
}

function updateEquityChart() {
    const ctx = document.getElementById('equityChart').getContext('2d');

    // Calcular equity acumulado
    const closedSignals = allSignals.filter(s => s.Status === 'TP_HIT' || s.Status === 'SL_HIT');
    closedSignals.sort((a, b) => new Date(a.Exit_Time) - new Date(b.Exit_Time));

    let equity = 0;
    const equityData = closedSignals.map(s => {
        equity += parseFloat(s.PnL_USDT || 0);
        return equity;
    });

    const labels = closedSignals.map((s, i) => `#${i + 1}`);

    if (charts.equity) charts.equity.destroy();

    charts.equity = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Equity (USDT)',
                data: equityData,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#8b92a7' }
                },
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#8b92a7' }
                }
            }
        }
    });
}

function updateSymbolChart() {
    const ctx = document.getElementById('symbolChart').getContext('2d');

    const symbols = Object.keys(stats.bySymbol || {});
    const winRates = symbols.map(symbol => {
        const data = stats.bySymbol[symbol];
        return (data.wins / data.total) * 100;
    });

    if (charts.symbol) charts.symbol.destroy();

    charts.symbol = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: symbols,
            datasets: [{
                label: 'Win Rate (%)',
                data: winRates,
                backgroundColor: symbols.map((_, i) =>
                    `hsla(${240 + i * 30}, 70%, 60%, 0.8)`
                ),
                borderColor: symbols.map((_, i) =>
                    `hsla(${240 + i * 30}, 70%, 60%, 1)`
                ),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#8b92a7' }
                },
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#8b92a7' }
                }
            }
        }
    });
}

function updateStrategyChart() {
    const ctx = document.getElementById('strategyChart').getContext('2d');

    const strategies = Object.keys(stats.byStrategy || {});
    const winRates = strategies.map(strategy => {
        const data = stats.byStrategy[strategy];
        return (data.wins / data.total) * 100;
    });

    if (charts.strategy) charts.strategy.destroy();

    charts.strategy = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: strategies,
            datasets: [{
                data: winRates,
                backgroundColor: [
                    'rgba(102, 126, 234, 0.8)',
                    'rgba(118, 75, 162, 0.8)',
                    'rgba(237, 100, 166, 0.8)'
                ],
                borderColor: [
                    'rgba(102, 126, 234, 1)',
                    'rgba(118, 75, 162, 1)',
                    'rgba(237, 100, 166, 1)'
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#8b92a7' }
                }
            }
        }
    });
}

function updatePnLDistChart() {
    const ctx = document.getElementById('pnlDistChart').getContext('2d');

    const closedSignals = allSignals.filter(s => s.Status === 'TP_HIT' || s.Status === 'SL_HIT');
    const pnls = closedSignals.map(s => parseFloat(s.PnL_Percent || 0));

    // Crear bins para histograma
    const bins = [-5, -3, -1, 0, 1, 3, 5, 10];
    const counts = new Array(bins.length - 1).fill(0);

    pnls.forEach(pnl => {
        for (let i = 0; i < bins.length - 1; i++) {
            if (pnl >= bins[i] && pnl < bins[i + 1]) {
                counts[i]++;
                break;
            }
        }
    });

    const labels = bins.slice(0, -1).map((bin, i) => `${bin}% a ${bins[i + 1]}%`);

    if (charts.pnlDist) charts.pnlDist.destroy();

    charts.pnlDist = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Número de operaciones',
                data: counts,
                backgroundColor: counts.map((_, i) =>
                    i < 3 ? 'rgba(244, 67, 54, 0.8)' : 'rgba(76, 175, 80, 0.8)'
                ),
                borderColor: counts.map((_, i) =>
                    i < 3 ? 'rgba(244, 67, 54, 1)' : 'rgba(76, 175, 80, 1)'
                ),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#8b92a7', stepSize: 1 }
                },
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#8b92a7' }
                }
            }
        }
    });
}

// ============================================
// ACTUALIZAR ÚLTIMA ACTUALIZACIÓN
// ============================================
function updateLastUpdate() {
    document.getElementById('lastUpdate').textContent = new Date().toLocaleString();
}

// ============================================
// EVENT LISTENERS
// ============================================
document.getElementById('searchInput').addEventListener('input', updateSignalsTable);
document.getElementById('statusFilter').addEventListener('change', updateSignalsTable);
document.getElementById('signalTypeFilter').addEventListener('change', updateSignalsTable);

// ============================================
// INICIALIZACIÓN
// ============================================
fetchData();

// Auto-refresh cada 30 segundos
setInterval(fetchData, 30000);
