// rl_agent.js - DQN con estado ampliado para trading pro
const tf = require('@tensorflow/tfjs');

class SimpleDQNAgent {
  constructor(stateSize = 20, actionSize = 3) {
    this.stateSize = stateSize; // Ahora 20 features para data completa
    this.actionSize = actionSize;
    this.gamma = 0.95;
    this.epsilon = 1.0;
    this.epsilonMin = 0.01;
    this.epsilonDecay = 0.995;
    this.memory = [];
    this.model = this.buildModel();
  }

  buildModel() {
    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 128, activation: 'relu', inputShape: [this.stateSize] })); // Más unidades para data compleja
    model.add(tf.layers.dense({ units: 128, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
    model.add(tf.layers.dense({ units: this.actionSize, activation: 'linear' }));
    model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });
    return model;
  }

  act(state) {
    if (Math.random() <= this.epsilon) {
      return Math.floor(Math.random() * this.actionSize);
    }
    return tf.tidy(() => {
      const qs = this.model.predict(tf.tensor2d([state]));
      return qs.argMax(1).dataSync()[0];
    });
  }

  remember(state, action, reward, nextState, done) {
    this.memory.push({ state, action, reward, nextState, done });
    if (this.memory.length > 2000) this.memory.shift();
  }

  async replay(batchSize = 32) {
    if (this.memory.length < batchSize) return;

    const batch = this.memory.sort(() => 0.5 - Math.random()).slice(0, batchSize);
    const states = tf.tensor2d(batch.map(m => m.state));
    const nextStates = tf.tensor2d(batch.map(m => m.nextState || m.state));

    const qValues = this.model.predict(states);
    const nextQValues = this.model.predict(nextStates);

    const qUpdate = qValues.arraySync();
    const nextQArray = nextQValues.arraySync();

    batch.forEach((mem, i) => {
      const target = mem.reward + (mem.done ? 0 : this.gamma * Math.max(...nextQArray[i]));
      qUpdate[i][mem.action] = target;
    });

    await this.model.fit(states, tf.tensor2d(qUpdate), { epochs: 1, verbose: 0 });

    if (this.epsilon > this.epsilonMin) this.epsilon *= this.epsilonDecay;

    states.dispose();
    nextStates.dispose();
    qValues.dispose();
    nextQValues.dispose();
  }

  async save() {
    await this.model.save('file://./rl_model_pro');
    console.log('[RL 🤖] Modelo profesional guardado en ./rl_model_pro/');
  }
}

// Función para extraer estado COMPLETO (20 features para decisión pro)
function extractState(ind, regime, signal, liquidityMap, obDetector, gapDetector) {
  // Normalizar todo a 0-1 o valores razonables
  const state = [
    // Momentum (4)
    ind.rsi / 100,
    ind.rsiPrev / 100,
    ind.macdHistogram / 100,
    ind.macdHistogramPrev / 100,

    // Tendencia (5)
    ind.adx / 50,
    ind.pdi / 50,
    ind.mdi / 50,
    (ind.close > ind.ema50 ? 1 : 0), // Bullish EMA50
    (ind.close > ind.ema200 ? 1 : 0), // Bullish EMA200

    // Volatilidad (3)
    ind.bbWidth,
    ind.atr / ind.close, // ATR normalizado por precio
    ind.volumeRatio,

    // Régimen (1, one-hot like)
    regime.regime === 'TRENDING' ? 1 : (regime.regime === 'RANGING' ? 0.5 : (regime.regime === 'BREAKOUT' ? 0.8 : 0)),

    // SMC (5)
    (liquidityMap.above.length > 0 ? liquidityMap.above[0].strength / 100 : 0), // Liquidity above strength
    (liquidityMap.below.length > 0 ? liquidityMap.below[0].strength / 100 : 0), // Liquidity below
    (obDetector.bullish.length > 0 ? obDetector.bullish[0].strength / 100 : 0), // Bullish OB strength
    (obDetector.bearish.length > 0 ? obDetector.bearish[0].strength / 100 : 0), // Bearish OB
    (gapDetector.bullish.length + gapDetector.bearish.length) / 10, // Gaps total (cap 1.0)

    // Señal (2)
    signal.score / 100,
    signal.rr / 10  // RR cap 1.0
  ];

  // Imprimir para depuración
  console.log('[RL 🤖] Estado completo (20 features):', state.map(v => v.toFixed(2)).join(', '));
  
  return state;
}

module.exports = { SimpleDQNAgent, extractState };