import {newGame, applyMove} from './engine.js';

const DEFAULT_CONFIG = Object.freeze({mode:'pvp',level:'medium',first:0});
const ARCHIVE_LIMIT = 7;
const EMPTY_METADATA = Object.freeze({id:null,completedAt:null,completedLocal:null,timeZone:null});
const clone = value => JSON.parse(JSON.stringify(value));

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function equal(a,b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a), otherKeys = Object.keys(b);
  return keys.length === otherKeys.length && keys.every(key => Object.hasOwn(b,key) && equal(a[key],b[key]));
}

function configuration(value = DEFAULT_CONFIG, requireComplete = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid game configuration.');
  const config = requireComplete ? {mode:value.mode,level:value.level,first:value.first} :
    {mode:value.mode ?? 'pvp',level:value.level ?? 'medium',first:value.first ?? 0};
  if (!['pvp','com'].includes(config.mode) || !['low','medium','high'].includes(config.level) || ![0,1].includes(config.first)) {
    throw new Error('Invalid game configuration.');
  }
  return Object.freeze(config);
}

function validMove(move) {
  if (!move || typeof move !== 'object' || Array.isArray(move) ||
      !Object.keys(move).every(key => ['from','to','drop','promote'].includes(key)) ||
      !Number.isInteger(move.to) || move.to < 0 || move.to >= 30 ||
      (move.promote !== undefined && typeof move.promote !== 'boolean')) return false;
  return move.from === null ? ['D','C','P'].includes(move.drop) && move.promote !== true :
    Number.isInteger(move.from) && move.from >= 0 && move.from < 30 && move.drop === undefined;
}

function canonicalMove(move) {
  return move.from === null ? {from:null,to:move.to,drop:move.drop} :
    {from:move.from,to:move.to,...(move.promote === true ? {promote:true} : {})};
}

function validResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  if (result.reason === 'repetition') return result.winner === null;
  if (![0,1].includes(result.winner)) return false;
  if (result.reason === 'resign') return [0,1].includes(result.resignedBy) && result.winner === 1-result.resignedBy;
  if (result.reason === 'perpetual-check') return result.perpetualBy === undefined ||
    ([0,1].includes(result.perpetualBy) && result.winner === 1-result.perpetualBy);
  return ['checkmate','no-moves'].includes(result.reason);
}

function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id); }

function metadata(saved = {}) {
  return {
    id:validId(saved.id) ? saved.id : null,
    completedAt:typeof saved.completedAt === 'string' && Number.isFinite(Date.parse(saved.completedAt)) ? saved.completedAt : null,
    completedLocal:typeof saved.completedLocal === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(saved.completedLocal) ? saved.completedLocal : null,
    timeZone:typeof saved.timeZone === 'string' && saved.timeZone.length > 0 && saved.timeZone.length <= 100 ? saved.timeZone : null,
  };
}

function record(config,states,details = EMPTY_METADATA) {
  // Always save the canonical opening. In particular, a zero-move resignation
  // must never become a custom terminal starting position.
  return freeze({config,baseState:newGame(config.first),
    moves:states.slice(1).map(state => canonicalMove(state.lastMove)),
    result:clone(states.at(-1).result),...metadata(details)});
}

/** Rebuild history from legal moves; no saved history is ever trusted. */
export function restoreRecord(saved,mustBeFinished = false) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) ||
      !Array.isArray(saved.moves) || saved.moves.length > 10000 || !saved.moves.every(validMove)) {
    throw new Error('Invalid saved game.');
  }
  const config = configuration(saved.config,true);
  const opening = newGame(config.first);
  if (!equal(saved.baseState,opening)) throw new Error('The saved game must start at the standard opening.');
  const states = [freeze(opening)];
  for (const move of saved.moves) {
    if (states.at(-1).result) throw new Error('A finished game cannot contain more moves.');
    states.push(freeze(applyMove(states.at(-1),canonicalMove(move))));
  }
  const final = states.at(-1);
  if (saved.result === null) {
    if (final.result) throw new Error('A terminal result cannot be removed.');
  } else {
    if (!validResult(saved.result)) throw new Error('Invalid saved result.');
    if (saved.result.reason === 'resign') {
      const result = {winner:saved.result.winner,reason:'resign',resignedBy:saved.result.resignedBy};
      if (!equal(saved.result,result) || final.result || result.resignedBy !== (config.mode === 'com' ? 0 : final.turn)) {
        throw new Error('Invalid saved resignation.');
      }
      // Resignation replaces the final snapshot; it is not an additional ply.
      states[states.length-1] = freeze({...final,result});
    } else if (!equal(saved.result,final.result)) {
      throw new Error('The saved result does not match its moves.');
    }
  }
  if (mustBeFinished && !states.at(-1).result) throw new Error('A review must contain a finished game.');
  return freeze({config,states,record:record(config,states,saved)});
}

/** The live game and the review cursor never share a writable playback state. */
export class GameSession {
  #config = DEFAULT_CONFIG;
  #states = [freeze(newGame())];
  #screen = 'home';
  #revision = 0;
  #hasGame = false;
  #archive = Object.freeze([]);
  #gameMetadata = EMPTY_METADATA;
  #reviewGame = null;
  #importedReview = false;
  #reviewStates = [];
  #reviewIndex = 0;
  #now;
  #idCounter = 0;

  constructor(saved = null,{now = () => new Date()} = {}) {
    this.#now = now;
    // This game's version 1 is deliberately unrelated to the previous game's
    // schemas. Loading returns home and never starts computer work.
    if (saved?.format !== 'gorogoro-shogi' || saved.version !== 1) return;
    try {
      const game = restoreRecord(saved.game);
      this.#config = game.config;
      this.#states = [...game.states];
      this.#gameMetadata = freeze(metadata(game.record));
      this.#hasGame = true;
    } catch { /* A damaged live game must not hide valid archive entries. */ }
    const entries = [], ids = new Set();
    for (const entry of Array.isArray(saved.archive) ? saved.archive : []) {
      try {
        if (!validId(entry?.id) || ids.has(entry.id)) continue;
        const restored = restoreRecord(entry,true).record;
        entries.push(restored); ids.add(restored.id);
        if (entries.length === ARCHIVE_LIMIT) break;
      } catch { /* Keep other valid records when one entry is damaged. */ }
    }
    this.#archive = Object.freeze(entries);
    // Never reconstruct the archive from an ended live game: that would
    // resurrect an archive entry the player explicitly deleted.
  }

  get screen() { return this.#screen; }
  get revision() { return this.#revision; }
  get config() { return this.#config; }
  get state() { return this.#states.at(-1); }
  get displayState() { return this.#screen === 'review' ? this.#reviewStates[this.#reviewIndex] : this.state; }
  get displayConfig() { return this.#screen === 'review' ? this.#reviewGame.config : this.#config; }
  get hasGame() { return this.#hasGame; }
  get archive() { return this.#archive; }
  get reviewGame() { return this.#reviewGame; }
  get isImportedReview() { return this.#screen === 'review' && this.#importedReview; }
  get hasLastGame() { return this.#archive.length > 0; }
  get lastGame() { return this.#archive[0] ?? null; }
  get canMove() { return this.#screen === 'play' && this.#hasGame && !this.state.result; }
  get canResign() { return this.canMove; }
  get isComputerTurn() { return this.canMove && this.#config.mode === 'com' && this.state.turn === 1; }
  get moveCount() { return this.#states.length-1; }
  get reviewIndex() { return this.#reviewIndex; }
  get reviewLength() { return this.#reviewStates.length; }
  get canUndo() {
    if (!this.canMove || this.#states.length < 2) return false;
    return !(this.#config.mode === 'com' && this.#states.length === 2 && this.#states[0].turn === 1);
  }

  #clearReview() {
    this.#reviewGame = null;
    this.#importedReview = false;
    this.#reviewStates = [];
    this.#reviewIndex = 0;
  }

  #complete() {
    const date = this.#now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('Invalid completion time.');
    const pad = value => String(value).padStart(2,'0');
    const completedAt = date.toISOString();
    const completedLocal = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    let timeZone = null;
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* Preserve the local date even without a zone name. */ }
    const id = globalThis.crypto?.randomUUID?.() || `game-${date.getTime().toString(36)}-${++this.#idCounter}-${Math.random().toString(36).slice(2,10)}`;
    this.#gameMetadata = freeze({id,completedAt,completedLocal,timeZone});
    this.#archive = Object.freeze([record(this.#config,this.#states,this.#gameMetadata),...this.#archive].slice(0,ARCHIVE_LIMIT));
  }

  start(config = this.#config) {
    const nextConfig = configuration(config);
    const opening = freeze(newGame(nextConfig.first));
    this.#config = nextConfig;
    this.#states = [opening];
    this.#gameMetadata = EMPTY_METADATA;
    this.#hasGame = true;
    this.#screen = 'play';
    this.#clearReview();
    this.#revision++;
    return true;
  }

  move(move,source = 'human',expectedRevision = this.#revision) {
    if (!this.canMove || expectedRevision !== this.#revision || !['human','computer'].includes(source) ||
        (source === 'computer') !== this.isComputerTurn || !validMove(move)) return false;
    let next;
    try { next = freeze(applyMove(this.state,canonicalMove(move))); }
    catch { return false; }
    this.#states.push(next);
    this.#revision++;
    if (next.result) this.#complete();
    return true;
  }

  resign(expectedRevision = this.#revision) {
    if (!this.canResign || expectedRevision !== this.#revision) return false;
    const resignedBy = this.#config.mode === 'com' ? 0 : this.state.turn;
    this.#states[this.#states.length-1] = freeze({...this.state,result:{winner:1-resignedBy,reason:'resign',resignedBy}});
    this.#revision++;
    this.#complete();
    return true;
  }

  home() {
    this.#screen = 'home';
    this.#clearReview();
    this.#revision++;
    return true;
  }

  resume() {
    if (!this.#hasGame) return false;
    this.#screen = 'play';
    this.#clearReview();
    this.#revision++;
    return true;
  }

  enterReview(id = this.lastGame?.id) {
    const game = this.#archive.find(entry => entry.id === id);
    if (!game) return false;
    this.#reviewStates = restoreRecord(game,true).states;
    this.#reviewGame = game;
    this.#importedReview = false;
    this.#reviewIndex = this.#reviewStates.length-1;
    this.#screen = 'review';
    this.#revision++;
    return true;
  }

  enterImportedReview(saved) {
    if (this.#screen !== 'home') return false;
    let imported;
    try { imported = restoreRecord(saved,true); }
    catch { return false; }
    // Imported records exist only for this playback and never enter the live
    // game, browser save, or seven-game archive.
    this.#reviewStates = imported.states;
    this.#reviewGame = imported.record;
    this.#importedReview = true;
    this.#reviewIndex = this.#reviewStates.length-1;
    this.#screen = 'review';
    this.#revision++;
    return true;
  }

  deleteGame(id) {
    if (!this.#archive.some(game => game.id === id)) return false;
    this.#archive = Object.freeze(this.#archive.filter(game => game.id !== id));
    if (!this.#importedReview && this.#reviewGame?.id === id) {
      this.#screen = 'home';
      this.#clearReview();
    }
    this.#revision++;
    return true;
  }

  reviewAt(index) {
    if (this.#screen !== 'review' || !Number.isFinite(index)) return false;
    this.#reviewIndex = Math.max(0,Math.min(this.#reviewStates.length-1,Math.trunc(index)));
    return true;
  }

  exitReview() {
    if (this.#screen !== 'review') return false;
    return this.home();
  }

  undo() {
    if (!this.canUndo) return false;
    this.#states.pop();
    if (this.#config.mode === 'com' && this.state.turn === 1 && this.#states.length > 1) this.#states.pop();
    this.#revision++;
    return true;
  }

  exportSave() {
    return freeze(clone({format:'gorogoro-shogi',version:1,
      game:this.#hasGame ? record(this.#config,this.#states,this.#gameMetadata) : null,archive:this.#archive}));
  }
}
