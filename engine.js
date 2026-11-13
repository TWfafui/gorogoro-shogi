// Goro-Goro Dobutsu Shogi. Owner 0 faces up; owner 1 faces down.
export const WIDTH = 5;
export const HEIGHT = 6;
export const HAND_TYPES = Object.freeze(['D', 'C', 'P']);
const SQUARES = WIDTH * HEIGHT;
const DOG = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[0,1]];
const MOVEMENT = {
  L:[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]],
  D:DOG, H:DOG, S:DOG,
  C:[[-1,-1],[0,-1],[1,-1],[-1,1],[1,1]],
  P:[[0,-1]],
};
const piece = (type, owner) => Object.freeze({type,owner});
const row = square => Math.floor(square / WIDTH);
const validSquare = square => Number.isInteger(square) && square >= 0 && square < SQUARES;
const inZone = (square, owner) => owner === 0 ? row(square) < 2 : row(square) >= HEIGHT - 2;
const lastRank = owner => owner === 0 ? 0 : HEIGHT - 1;
const baseType = type => type === 'H' ? 'P' : type === 'S' ? 'C' : type;

export function directions(type, owner) {
  return (MOVEMENT[type] || []).map(([dx,dy]) => [dx,owner === 1 ? -dy : dy]);
}

export function positionKey(state) {
  return `${state.board.map(p => p ? `${p.owner}${p.type}` : '--').join('')}/${state.hands.map(h => HAND_TYPES.map(t => h[t]).join(',')).join('/')}/${state.turn}`;
}

function freezeState(state) {
  // Untouched pieces, hands, and history entries are shared across branches.
  for (const p of state.board) if (p && !Object.isFrozen(p)) Object.freeze(p);
  Object.freeze(state.board);
  state.hands.forEach(Object.freeze);
  Object.freeze(state.hands);
  if (state.lastMove) Object.freeze(state.lastMove);
  if (state.result) Object.freeze(state.result);
  Object.freeze(state.history.positions);
  for (const entry of state.history.moves) if (!Object.isFrozen(entry)) Object.freeze(entry);
  Object.freeze(state.history.moves);
  Object.freeze(state.history);
  return Object.freeze(state);
}

export function newGame(first = 0) {
  if (first !== 0 && first !== 1) throw new Error('First player must be 0 or 1.');
  const board = Array(SQUARES).fill(null);
  for (const owner of [0,1]) {
    const home = owner === 0 ? HEIGHT - 1 : 0;
    ['C','D','L','D','C'].forEach((type,x) => { board[home * WIDTH + x] = piece(type,owner); });
    const chicks = owner === 0 ? 3 : 2;
    for (const x of [1,2,3]) board[chicks * WIDTH + x] = piece('P',owner);
  }
  const state = {board,hands:[{D:0,C:0,P:0},{D:0,C:0,P:0}],turn:first,
    result:null,ply:0,lastMove:null,history:{positions:[],moves:[]}};
  state.history.positions.push(positionKey(state));
  return freezeState(state);
}

export function isAttacked(state, square, byOwner) {
  if (!validSquare(square)) return false;
  const x = square % WIDTH, y = row(square);
  for (let from = 0; from < SQUARES; from++) {
    const p = state.board[from];
    if (!p || p.owner !== byOwner) continue;
    const dx = x - from % WIDTH, dy = (y - row(from)) * (byOwner === 1 ? -1 : 1);
    if ((MOVEMENT[p.type] || []).some(d => d[0] === dx && d[1] === dy)) return true;
  }
  return false;
}

export function isInCheck(state, owner = state.turn) {
  const lion = state.board.findIndex(p => p?.owner === owner && p.type === 'L');
  return lion < 0 || isAttacked(state,lion,1-owner);
}

export function sameMove(a,b) {
  return !!a && !!b && a.from === b.from && a.to === b.to &&
    a.drop === b.drop && (a.promote === true) === (b.promote === true);
}

function canonicalMove(move) {
  return move.from === null ? {from:null,to:move.to,drop:move.drop} :
    move.promote === true ? {from:move.from,to:move.to,promote:true} : {from:move.from,to:move.to};
}

// Apply only the board/hand effects. Legality and game history are handled by
// the caller, so king-safety and checkmate probes never recurse through history.
function boardAfter(state,move) {
  const owner = state.turn, board = state.board.slice(), hands = state.hands.slice();
  const captured = board[move.to];
  if (move.from === null || captured) hands[owner] = {...hands[owner]};
  if (move.from === null) {
    board[move.to] = piece(move.drop,owner);
    hands[owner][move.drop]--;
  } else {
    const moving = board[move.from];
    board[move.from] = null;
    board[move.to] = move.promote === true ? piece(moving.type === 'C' ? 'S' : 'H',owner) : moving;
    if (captured) hands[owner][baseType(captured.type)]++;
  }
  return {board,hands,turn:1-owner};
}

function structurallyLegal(state,move) {
  if (!move || !validSquare(move.to) || (move.promote !== undefined && typeof move.promote !== 'boolean')) return false;
  const owner = state.turn, target = state.board[move.to];
  if (move.from === null) {
    if (!HAND_TYPES.includes(move.drop) || move.promote === true || target || !(state.hands[owner][move.drop] > 0)) return false;
    if (move.drop === 'P') {
      if (row(move.to) === lastRank(owner)) return false;
      const file = move.to % WIDTH;
      for (let y = 0; y < HEIGHT; y++) {
        const p = state.board[y * WIDTH + file];
        if (p?.owner === owner && p.type === 'P') return false;
      }
    }
    return true;
  }
  if (!validSquare(move.from) || move.drop !== undefined || target?.owner === owner || target?.type === 'L') return false;
  const moving = state.board[move.from];
  if (!moving || moving.owner !== owner) return false;
  const dx = move.to % WIDTH - move.from % WIDTH;
  const dy = (row(move.to) - row(move.from)) * (owner === 1 ? -1 : 1);
  if (!(MOVEMENT[moving.type] || []).some(d => d[0] === dx && d[1] === dy)) return false;
  const promotable = (moving.type === 'P' || moving.type === 'C') && (inZone(move.from,owner) || inZone(move.to,owner));
  if (move.promote === true && !promotable) return false;
  if (moving.type === 'P' && row(move.to) === lastRank(owner) && move.promote !== true) return false;
  return true;
}

function legalBoardAfter(state,move) {
  if (!structurallyLegal(state,move)) return null;
  const next = boardAfter(state,move);
  if (isInCheck(next,state.turn)) return null;
  if (move.from === null && move.drop === 'P' && isInCheck(next,next.turn)) {
    // A chick checks from an adjacent square. A drop cannot interpose between
    // those squares or capture it; only board moves can answer that check.
    // Checking board replies is therefore complete, without recursive drop-
    // mate probes (even if both players have many pieces in hand).
    if (!collectMoves(next,true,true).length) return null;
  }
  return next;
}

function collectMoves(state,stopAfterOne = false,boardOnly = false) {
  const moves = [];
  const add = move => {
    if (!legalBoardAfter(state,move)) return false;
    moves.push(move);
    return stopAfterOne;
  };
  for (let from = 0; from < SQUARES; from++) {
    const p = state.board[from];
    if (!p || p.owner !== state.turn) continue;
    const x = from % WIDTH, y = row(from);
    for (const [dx,dy] of MOVEMENT[p.type] || []) {
      const nx = x + dx, ny = y + dy * (p.owner === 1 ? -1 : 1);
      if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) continue;
      const to = ny * WIDTH + nx;
      const promotable = (p.type === 'P' || p.type === 'C') && (inZone(from,p.owner) || inZone(to,p.owner));
      if (!(p.type === 'P' && ny === lastRank(p.owner)) && add({from,to})) return moves;
      if (promotable && add({from,to,promote:true})) return moves;
    }
  }
  if (!boardOnly) for (const drop of HAND_TYPES) {
    if (!(state.hands[state.turn][drop] > 0)) continue;
    for (let to = 0; to < SQUARES; to++) {
      if (!state.board[to] && add({from:null,to,drop})) return moves;
    }
  }
  return moves;
}

export function legalMoves(state) {
  return state.result ? [] : collectMoves(state);
}

function repetitionResult(history,key) {
  const indices = [];
  for (let i = 0; i < history.positions.length; i++) if (history.positions[i] === key) indices.push(i);
  if (indices.length < 4) return null;
  const start = indices[indices.length - 4], end = indices[indices.length - 1];
  const always = [true,true], seen = [false,false];
  // Position index i is after i plies, so moves[start] is the first move
  // following the first of the four relevant occurrences.
  for (let i = start; i < end; i++) {
    const entry = history.moves[i];
    seen[entry.owner] = true;
    if (!entry.check) always[entry.owner] = false;
  }
  const checkers = [0,1].filter(owner => seen[owner] && always[owner]);
  if (checkers.length === 1) return {winner:1-checkers[0],reason:'perpetual-check',perpetualBy:checkers[0]};
  return {winner:null,reason:'repetition'};
}

export function applyMove(state,move) {
  if (state.result) throw new Error('The game has finished.');
  const nextBoard = legalBoardAfter(state,move);
  if (!nextBoard) throw new Error('Illegal move.');
  const check = isInCheck(nextBoard,nextBoard.turn), key = positionKey(nextBoard);
  const history = {
    positions:[...state.history.positions,key],
    moves:[...state.history.moves,Object.freeze({owner:state.turn,check})],
  };
  const next = {...nextBoard,result:repetitionResult(history,key),ply:state.ply+1,
    lastMove:canonicalMove(move),history};
  if (!next.result && !collectMoves(next,true).length) {
    next.result = {winner:state.turn,reason:check ? 'checkmate' : 'no-moves'};
  }
  return freezeState(next);
}
