import { WIDTH, HEIGHT, directions, legalMoves, applyMove } from './engine.js';

// Limits are deliberately small enough for a phone. The mandatory first pass
// evaluates every legal move (and its real terminal result); deeper, incomplete
// iterations never replace the last complete iteration.
const LEVELS = Object.freeze({
  low: Object.freeze({ chance: .30, maxDepth: 3, maxNodes: 1200, timeLimitMs: 70 }),
  medium: Object.freeze({ chance: .20, maxDepth: 4, maxNodes: 4500, timeLimitMs: 180 }),
  high: Object.freeze({ chance: .10, maxDepth: 5, maxNodes: 12000, timeLimitMs: 420 }),
});
const VALUE = Object.freeze({ L: 0, D: 300, C: 250, P: 100, H: 330, S: 330 });
const MATE = 100000;
const MATE_BOUND = 90000;
const INFINITY = 1000000;
const STOP = Symbol('search limit');
const clock = () => globalThis.performance?.now?.() ?? Date.now();

function boundedNumber(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value)) : fallback;
}

function resultScore(state, ply) {
  if (state.result.winner === null) return 0;
  return state.result.winner === state.turn ? MATE - ply : -MATE + ply;
}

function evaluate(state) {
  const attacks = [new Uint8Array(WIDTH * HEIGHT), new Uint8Array(WIDTH * HEIGHT)];
  let score = 0;
  for (let square = 0; square < state.board.length; square++) {
    const piece = state.board[square];
    if (!piece) continue;
    const sign = piece.owner === 0 ? 1 : -1;
    const x = square % WIDTH;
    const y = Math.floor(square / WIDTH);
    const progress = piece.owner === 0 ? HEIGHT - 1 - y : y;
    const center = 2 - Math.abs(x - 2);
    let positional = 0;
    if (piece.type !== 'L') {
      positional = center * 4 + progress * (piece.type === 'P' ? 5 : 2);
    }
    score += sign * (VALUE[piece.type] + positional);
    for (const [dx, dy] of directions(piece.type, piece.owner)) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT) attacks[piece.owner][ny * WIDTH + nx]++;
    }
  }
  for (let owner = 0; owner < 2; owner++) {
    const sign = owner === 0 ? 1 : -1;
    for (const type of ['D', 'C', 'P']) score += sign * state.hands[owner][type] * (VALUE[type] + 10);
    for (const count of attacks[owner]) if (count) score += sign * 2;
  }
  for (let square = 0; square < state.board.length; square++) {
    const piece = state.board[square];
    if (!piece) continue;
    const sign = piece.owner === 0 ? 1 : -1;
    if (piece.type === 'L') {
      // Check is a threat, not a terminal result. Only the rules engine decides
      // mate, including legal replies to drops and promotion choices.
      if (attacks[1 - piece.owner][square]) score -= sign * 45;
      continue;
    }
    if (attacks[1 - piece.owner][square]) {
      score -= sign * Math.round(VALUE[piece.type] * (attacks[piece.owner][square] ? .05 : .22));
    }
  }
  return (state.turn === 0 ? score : -score);
}

function moveOrder(state, move) {
  const captured = state.board[move.to];
  let order = captured ? VALUE[captured.type] * 10 : 0;
  if (move.promote) order += 700;
  if (move.from !== null) order -= VALUE[state.board[move.from].type] / 20;
  else order -= 10;
  return order;
}

function search(state, depth, alpha, beta, ply, context) {
  if (context.nodes >= context.maxNodes) {
    context.limit = 'nodes';
    throw STOP;
  }
  if (context.now() >= context.deadline) {
    context.limit = 'time';
    throw STOP;
  }
  context.nodes++;
  if (state.result) return resultScore(state, ply);
  if (depth === 0) return evaluate(state);
  const moves = legalMoves(state).slice().sort((a, b) => moveOrder(state, b) - moveOrder(state, a));
  // Valid engine states already carry this terminal result. This also makes
  // chooseMove useful for rule-test positions without manufacturing a move.
  if (!moves.length) return -MATE + ply;
  let best = -INFINITY;
  for (const move of moves) {
    // There is intentionally no board-only transposition cache: applyMove
    // carries the whole immutable repetition/check history into every branch.
    const child = applyMove(state, move);
    const score = -search(child, depth - 1, -beta, -alpha, ply + 1, context);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Legal iterative-deepening search. options permits deterministic tests and
 * benchmarking: random, maxDepth, maxNodes, timeLimitMs, now, includeAnalysis.
 * The time limit is checked between indivisible engine operations; the initial
 * all-move safety pass always completes. budget reports the effective node cap.
 */
export function chooseMove(state, level = 'medium', options = {}) {
  options ||= {};
  if (!state || !Array.isArray(state.board)) throw new TypeError('Invalid AI position');
  level = Object.hasOwn(LEVELS, level) ? level : 'medium';
  const config = LEVELS[level];
  const now = typeof options.now === 'function' ? options.now : clock;
  const started = now();
  const maxDepth = Math.floor(boundedNumber(options.maxDepth, config.maxDepth, 1, 12));
  const requestedNodes = Math.floor(boundedNumber(options.maxNodes, config.maxNodes, 1, 200000));
  const timeLimitMs = boundedNumber(options.timeLimitMs, config.timeLimitMs, 0, 10000);
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const response = (move, depth, mistake, context, score, analysis) => ({
    move: move ? { ...move } : null,
    depth,
    mistake,
    nodes: context.nodes,
    elapsedMs: Math.max(0, now() - started),
    score: score || 0,
    level,
    limit: context.limit,
    budget: { maxDepth, maxNodes: context.maxNodes, timeLimitMs },
    ...(options.includeAnalysis ? { analysis } : {}),
  });
  if (state.result) {
    return response(null, 0, false, { nodes: 0, maxNodes: requestedNodes, limit: 'terminal' }, resultScore(state, 0), []);
  }
  const moves = legalMoves(state);
  if (!moves.length) {
    return response(null, 0, false, { nodes: 1, maxNodes: requestedNodes, limit: 'terminal' }, -MATE, []);
  }
  const context = {
    nodes: 1,
    maxNodes: Math.max(requestedNodes, moves.length + 1),
    deadline: started + timeLimitMs,
    now,
    limit: 'depth',
  };
  // Every candidate is checked even with a zero time budget. This prevents a
  // difficulty mistake from selecting an immediately losing perpetual check.
  const roots = moves.map((move, index) => {
    const child = applyMove(state, move);
    context.nodes++;
    const score = child.result ? -resultScore(child, 1) : -evaluate(child);
    return {
      move, child, index, score,
      knownLoss: score <= -MATE_BOUND,
      proofScore: Math.abs(score) >= MATE_BOUND ? score : null,
    };
  });
  let depth = 1;
  let completed = roots.map(root => ({ root, score: root.score }));
  for (let nextDepth = 2; nextDepth <= maxDepth; nextDepth++) {
    const ordered = completed.slice().sort((a, b) => b.score - a.score || a.root.index - b.root.index);
    const iteration = [];
    try {
      for (const { root } of ordered) {
        // Full windows at the root give exact, comparable inferior-candidate
        // scores, rather than treating an alpha/beta bound as an evaluation.
        const score = -search(root.child, nextDepth - 1, -INFINITY, INFINITY, 1, context);
        if (score <= -MATE_BOUND) root.knownLoss = true;
        if (Math.abs(score) >= MATE_BOUND) root.proofScore = score;
        iteration.push({ root, score });
      }
      completed = iteration;
      depth = nextDepth;
      if (iteration.some(entry => entry.score >= MATE_BOUND)) {
        context.limit = 'solved';
        break;
      }
    } catch (error) {
      if (error !== STOP) throw error;
      break;
    }
  }
  // Proofs from a completed subtree remain valid even when another subtree
  // interrupts that iteration. Never pick such a known loss if an alternative
  // remains; the older full iteration still orders the other moves fairly.
  const ranked = completed.map(entry => ({
    ...entry, score: entry.root.proofScore ?? entry.score,
  })).sort((a, b) => b.score - a.score || a.root.index - b.root.index);
  const safe = ranked.filter(entry => !entry.root.knownLoss);
  const available = safe.length ? safe : ranked;
  const best = available[0];
  const inferior = safe.filter(entry => entry.score < best.score);
  let chosen = best;
  let mistake = false;
  if (inferior.length && random() < config.chance) {
    const draw = boundedNumber(random(), 0, 0, 1 - Number.EPSILON);
    chosen = inferior[Math.floor(draw * inferior.length)];
    mistake = true;
  }
  const analysis = ranked.map(({ root, score }) => ({
    move: { ...root.move }, score: score || 0, knownLoss: root.knownLoss,
    terminal: root.child.result?.reason ?? null,
  }));
  return response(chosen.root.move, depth, mistake, context, chosen.score, analysis);
}
