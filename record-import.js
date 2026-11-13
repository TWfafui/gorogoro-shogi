import {newGame,applyMove} from './engine.js';
import {moveNotation} from './notation.js';
import {recordDate,recordOutcome,playerIdentity,validateNote} from './record-export.js';
import {restoreRecord} from './session.js';

const TITLE = 'ごろごろどうぶつしょうぎ · Goro-Goro Dobutsu Shogi';
const LEGEND = '先手大寫，後手小寫；x 吃子，* 打入，+ 升級。';
const LEVELS = {簡單:'low',普通:'medium',困難:'high'};
const REASONS = {將死:'checkmate',對方已沒有合法棋步:'no-moves',相同局面出現四次:'repetition',
  '持續將軍造成四次重複，將軍方判負':'perpetual-check',主動認輸:'resign'};
const MAX_BYTES = 1024*1024,MAX_MOVES = 10000;
const square = value => (Number(value[1])-1)*5+'abcde'.indexOf(value[0]);

function moveFromNotation(value) {
  const drop = /^([DCPdcp])\*([abcde][1-6])$/.exec(value);
  if (drop) return {from:null,to:square(drop[2]),drop:drop[1].toUpperCase()};
  const move = /^([LDCPHSldcphs])([abcde][1-6])([-x])([abcde][1-6])(\+)?$/.exec(value);
  if (!move) throw new Error('棋步記法不正確。');
  return {from:square(move[2]),to:square(move[4]),...(move[5] ? {promote:true} : {})};
}

/** Validate an own-format, complete game without changing browser storage. */
export function parseRecordImport(text) {
  if (typeof text !== 'string' || !text.length) throw new Error('棋譜檔案沒有內容。');
  if (text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('棋譜檔案過大，請選擇1MB以內的TXT檔。');
  const normalized = text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  if (/[\r\u0000\uFFFD]/.test(normalized)) throw new Error('棋譜文字編碼不正確，請使用匯出的TXT檔。');
  const lines = normalized.split('\n');
  while (lines.at(-1) === '') lines.pop();
  let index = 0;
  const take = () => lines[index++];
  const expect = value => {if (take() !== value) throw new Error('棋譜內容不完整或格式不正確。');};
  const field = prefix => {
    const line = take();
    if (typeof line !== 'string' || !line.startsWith(prefix)) throw new Error('棋譜內容不完整或格式不正確。');
    return line.slice(prefix.length);
  };
  expect('GOROGORO-SHOGI TXT v1');expect(TITLE);
  const date = field('棋局日期：');
  if (date !== '日期不詳' && recordDate({completedLocal:date}) !== date) throw new Error('棋局日期不正確。');
  let timeZone = null;
  if (lines[index]?.startsWith('完局時區：')) {
    timeZone = field('完局時區：');
    if (!/^[A-Za-z0-9_+\-/:. ]{1,80}$/.test(timeZone)) throw new Error('棋局時區不正確。');
  }
  const modeName = field('對弈模式：');
  const mode = modeName === '挑戰電腦' ? 'com' : modeName === '雙人對弈' ? 'pvp' : null;
  if (!mode) throw new Error('對弈模式不正確。');
  const levelName = field('難度設定：');
  if (!Object.hasOwn(LEVELS,levelName)) throw new Error('電腦難度不正確。');
  const firstDescription = field('先手：'),secondDescription = field('後手：');
  const first = firstDescription === '1P 森林隊' ? 0 : 1;
  const config = {mode,level:LEVELS[levelName],first};
  const description = owner => `${playerIdentity(owner,config)} ${owner===0?'森林隊':'天空隊'}`;
  if (firstDescription !== description(first) || secondDescription !== description(1-first)) throw new Error('先後手或玩家資料不正確。');
  const summary = field('結果：'),reasonName = field('結束方式：');
  if (!Object.hasOwn(REASONS,reasonName)) throw new Error('棋局結束方式不正確。');
  const reason = REASONS[reasonName];
  let resignedIdentity = null;
  if (reason === 'resign') resignedIdentity = field('認輸：');
  let note = '';
  if (lines[index]?.startsWith('備註：')) {
    const checked = validateNote(field('備註：'));
    if (!checked.valid) throw new Error(checked.error);
    note = checked.note;
  }
  expect('');expect('棋譜');expect(LEGEND);expect('開局');
  const baseState = newGame(first),moves = [];
  let state = baseState;
  while (index < lines.length && lines[index] !== '') {
    const ply = moves.length+1;
    if (moves.length >= MAX_MOVES) throw new Error('棋譜超過可匯入的手數。');
    const match = /^([1-9]\d*)\. (.+)$/.exec(take());
    if (!match || Number(match[1]) !== ply) throw new Error(`第${ply}手：棋步編號不連續或格式不正確。`);
    if (state.result) throw new Error(`第${ply}手：棋局已結束，不能再落子。`);
    try {
      const move = moveFromNotation(match[2]);
      // Replaying the canonical engine verifies piece, owner case, captures,
      // promotion choice, all drop restrictions, and repetition history.
      if (moveNotation(state,move,first) !== match[2]) throw new Error('棋子、先後手或吃子升級記號不符。');
      state = applyMove(state,move);
      moves.push(move);
    } catch (error) {
      throw new Error(`第${ply}手：${error.message === 'Illegal move.' ? '這一步不符合走法規則。' : error.message}`);
    }
  }
  expect('');expect(`終局：${summary}`);
  let result;
  if (reason === 'resign') {
    if (state.result) throw new Error('認輸結果與棋步的勝負不一致。');
    const resignedBy = mode === 'com' ? 0 : state.turn,identity = playerIdentity(resignedBy,config);
    if (resignedIdentity !== `${identity}認輸`) throw new Error('認輸玩家與棋步的輪序不一致。');
    expect(`${identity}認輸`);
    result = {winner:1-resignedBy,reason,resignedBy};
  } else {
    if (!state.result || state.result.reason !== reason) throw new Error('棋局結果與實際棋步不一致。');
    result = {...state.result};
  }
  if (index !== lines.length) throw new Error('棋譜含有無法辨識的額外內容。');
  const record = {id:'imported-record',config,baseState,moves,result,completedAt:null,
    completedLocal:date==='日期不詳'?null:date,timeZone};
  if (recordOutcome(record) !== summary) throw new Error('勝負結果與先後手或實際棋步不一致。');
  return {...restoreRecord(record,true).record,note};
}
