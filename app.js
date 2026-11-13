import {legalMoves,directions,isInCheck} from './engine.js';
import {GameSession} from './session.js';
import {buildMoveRecord} from './notation.js';
import {RULE_PAGE_COUNT,renderRulesPage} from './rules-pages.js';
import {recordDate,recordOutcome,recordTitle,playerIdentity,validateNote,createRecordExport} from './record-export.js';
import {parseRecordImport} from './record-import.js';

const $=selector=>document.querySelector(selector);
const names={L:'獅子',D:'狗',C:'貓',P:'小雞',H:'母雞',S:'強化貓'};
const images={L:'lion',D:'dog',C:'cat',P:'chick',H:'hen',S:'super-cat'};
const levels={low:'簡單',medium:'普通',high:'困難'};
const levelDescriptions={low:'適合棋類遊戲新手',medium:'玩過象棋或西洋棋',high:'我是將棋高手玩家'};
const STORE='gorogoro-shogi-v1';
const OFFLINE_CACHE='gorogoro-shogi-v2';
let saved=null,storageOK=true;
try{saved=JSON.parse(localStorage.getItem(STORE));}catch{storageOK=false;}
const session=new GameSession(saved);
const preferences={showHints:saved?.preferences?.showHints!==false,highlightLast:saved?.preferences?.highlightLast!==false};
let setupDefaults={...session.config};
let selected=null,thinking=false,worker=null,taskId=0,toastTimer,offlineReady=false;
let recordSource=null,recordEntries=[];
let importRequest=0;

function save(){
  try{localStorage.setItem(STORE,JSON.stringify({...session.exportSave(),preferences}));storageOK=true;}
  catch{storageOK=false;}
  $('#storage-warning').hidden=storageOK;
}
function player(owner,config=session.displayConfig){return owner===0?'1P':config.mode==='com'?'AI':'2P';}
function coordinate(i){return 'ABCDE'[i%5]+(Math.floor(i/5)+1);}
function canSelect(){return session.canMove&&!thinking&&!session.isComputerTurn&&!$('#sheet').open;}
function notify(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2800);}
function pieceMarkup(piece,isSelected){
  // The art stays in the center; every movement dot occupies the outer rim.
  return `<span class="piece owner-${piece.owner}${isSelected?' is-selected':''}"><img src="./assets/${images[piece.type]}.svg" alt="" draggable="false">${directions(piece.type,0).map(([dx,dy])=>`<i class="direction-dot dx${dx} dy${dy}" aria-hidden="true"></i>`).join('')}</span>`;
}
function renderHand(owner){
  const state=session.displayState,active=canSelect()&&state.turn===owner;
  return ['D','C','P'].filter(type=>state.hands[owner][type]>0).map(type=>`<button class="hand-piece${selected?.drop===type&&active?' selected':''}" data-hand="${type}" data-owner="${owner}" aria-label="${player(owner)}持駒：${names[type]} ${state.hands[owner][type]}隻" aria-pressed="${Boolean(selected?.drop===type&&active)}" ${active?'':'disabled'}><img src="./assets/${images[type]}.svg" alt=""><span class="count">${state.hands[owner][type]}</span></button>`).join('')||'<span class="hand-empty">沒有持駒</span>';
}
function renderPlayer(target,owner){
  const state=session.displayState,config=session.displayConfig;
  const active=session.screen==='play'&&!state.result&&state.turn===owner;
  const row=$(target);
  row.classList.toggle('active-turn',active);
  row.setAttribute('role','group');
  row.setAttribute('aria-label',`${player(owner)}${active?'，目前回合':''}`);
  row.setAttribute('aria-current',active?'true':'false');
  row.innerHTML=`<div class="player-label ${owner===1?'sky':''}"><span class="team-dot">${player(owner,config)}</span><div><strong>${player(owner,config)}</strong><small>${owner===config.first?'先手':'後手'}</small></div></div><div class="hand" role="group" aria-label="${player(owner)}持駒">${renderHand(owner)}</div>`;
}
function render(){
  const home=session.screen==='home',review=session.screen==='review';
  const state=session.displayState,config=session.displayConfig;
  $('#home-screen').hidden=!home;$('#game-screen').hidden=home;
  document.body.dataset.screen=session.screen;
  $('#app').classList.toggle('home',home);$('#app').classList.toggle('playing',!home);$('#app').classList.toggle('review-draft',review);
  $('#app-footer').hidden=!home;
  $('#resume-game').hidden=!session.hasGame||Boolean(session.state.result);
  $('#game-tools').hidden=review;$('#review-controls').hidden=!review;
  $('#move-record').hidden=!review;
  if(home){recordSource=null;recordEntries=[];$('#move-list').innerHTML='';}
  $('#game-badge').textContent=config.mode==='com'?`挑戰電腦 · ${levels[config.level]}難度`:'雙人對弈';
  const moves=canSelect()?legalMoves(state):[];
  const targets=selected&&preferences.showHints?moves.filter(move=>selected.drop?move.drop===selected.drop:move.from===selected.from):[];
  $('#board').innerHTML=Array.from({length:30},(_,i)=>{
    const piece=state.board[i],target=targets.some(move=>move.to===i),isSelected=selected?.from===i&&!selected.drop;
    const zone=Math.floor(i/5)<2?'sky-zone':Math.floor(i/5)>3?'land-zone':'';
    const last=preferences.highlightLast&&state.lastMove&&(state.lastMove.to===i||state.lastMove.from===i);
    return `<button class="cell ${zone}${piece?' has-piece':''}${target?' target':''}${last?' last-move':''}" data-square="${i}" aria-label="${coordinate(i)} ${zone==='sky-zone'?'天空陣地，':zone==='land-zone'?'森林陣地，':''}${piece?player(piece.owner)+'的'+names[piece.type]:'空格'}${target?'，可以移動到這裡':''}${review?'，回顧模式':''}" aria-pressed="${Boolean(isSelected)}" ${review||home||state.result||!canSelect()?'disabled':''}>${piece?pieceMarkup(piece,isSelected):''}</button>`;
  }).join('');
  renderPlayer('#player-top',1);renderPlayer('#player-bottom',0);
  $('#turn-banner').classList.toggle('sky',state.turn===1&&!review);$('#turn-banner').classList.toggle('thinking',thinking&&!review);
  $('#move-counter').textContent=`第 ${state.ply} 手`;
  $('#turn-title').textContent=review?'棋局回顧':state.result?(state.result.winner===null?'這一局，平分秋色':`${player(state.result.winner)}獲勝！`):thinking?'電腦正在思考…':`輪到 ${player(state.turn)}`;
  let subtitle='點選動物，再點目的地';
  if(review)subtitle=session.isImportedReview?'暫存棋譜，回到首頁後清除':'回顧模式，僅供查看，不能落子';
  else if(state.result)subtitle='可回顧上一局，或開始新的一局';
  else if(thinking)subtitle='請稍候';
  else if(selected?.drop)subtitle=`將${names[selected.drop]}放入空格`;
  else if(selected)subtitle='選擇目的地，再點一次棋子可取消';
  else if(isInCheck(state,state.turn))subtitle='獅子被將軍，要先解將';
  $('#turn-subtitle').textContent=subtitle;
  const threatened=!state.result&&isInCheck(state,state.turn);
  const note=!review&&threatened?'獅子被將軍，請先解將':null;
  $('#board-note').hidden=!note;
  $('#board-note').innerHTML=note?`<span class="note-symbol" aria-hidden="true">${threatened&&!review?'!':'•'}</span><span>${note}</span>`:'';
  $('#undo').disabled=!session.canUndo;
  $('#resign').disabled=!session.canResign;
  if(review){
    const index=session.reviewIndex,last=session.reviewLength-1;
    $('#review-first').disabled=index===0;$('#review-prev').disabled=index===0;
    $('#review-next').disabled=index===last;$('#review-last').disabled=index===last;
    const total=session.reviewGame.baseState.ply+session.reviewGame.moves.length;
    $('#review-position').textContent=`${state.ply===0?'開局':'第 '+state.ply+' 手'} / ${total} 手`;
    $('#review-first').setAttribute('aria-label',session.reviewGame.baseState.ply===0?'回到開局':'回到記錄起點');
    renderMoveRecord();
  }
  if(review)scrollCurrentMove();
}
function renderMoveRecord(){
  if(recordSource!==session.reviewGame){recordSource=session.reviewGame;recordEntries=buildMoveRecord(recordSource);}
  const first=session.displayConfig.first;
  $('#record-side-key').textContent=`先手${player(first,session.displayConfig)}大寫 · 後手小寫`;
  const list=$('#move-list'),scroll=list.scrollTop;
  list.innerHTML=recordEntries.filter(entry=>entry.index>0).map(entry=>`<li><button data-review-index="${entry.index}" class="record-step ${entry.side||''}${entry.index===session.reviewIndex?' current':''}" aria-current="${entry.index===session.reviewIndex?'step':'false'}" aria-label="${entry.label}"><span class="record-number">${entry.ply}</span><span class="record-notation">${entry.notation}</span></button></li>`).join('');
  list.scrollTop=scroll;
}
function scrollCurrentMove(){
  const list=$('#move-list'),current=list.querySelector('[aria-current="step"]');
  if(session.reviewIndex===0){list.scrollTop=0;return;}
  if(!current||!list.clientHeight)return;
  const view=list.getBoundingClientRect(),row=current.getBoundingClientRect();
  if(row.top<view.top)list.scrollTop-=view.top-row.top;
  else if(row.bottom>view.bottom)list.scrollTop+=row.bottom-view.bottom;
}
$('#move-list').addEventListener('click',event=>{
  const item=event.target.closest('[data-review-index]');
  if(session.screen!=='review'||!item)return;
  const index=Number(item.dataset.reviewIndex);
  if(!Number.isInteger(index)||index<0||index>=session.reviewLength)return;
  if(session.reviewAt(index)){render();$('#move-list').querySelector('[aria-current="step"]')?.focus?.({preventScroll:true});}
});
$('#notation-help').onclick=()=>showSheet(`<h2>怎麼讀棋譜？</h2><p>先手用大寫、後手用小寫，依這局實際的先後手區分。</p><table class="ai-table"><tbody>${[['L','獅子'],['D','狗'],['C','貓'],['P','小雞'],['H','母雞'],['S','強化貓']].map(([symbol,name])=>`<tr><td>${symbol} / ${symbol.toLowerCase()}</td><td>${name}</td></tr>`).join('')}</tbody></table><p>座標 a–e 對應 A–E，排數為1–6。<br><code>Dc6-c5</code>：狗從 C6 移到 C5<br><code>Pc4xc3</code>：小雞移到 C3 並吃子<br><code>P*b3</code>：打入小雞到 B3<br><code>Pb3-b2+</code>：小雞移到 B2 並升級</p><p>每手左側是手數，右側是棋步；點選任一手查看盤面。上方的 |‹ 回到第0手，›| 跳到最後一手。</p>`);
window.addEventListener('resize',()=>{if(session.screen==='review')scrollCurrentMove();});
window.visualViewport?.addEventListener('resize',()=>{if(session.screen==='review')scrollCurrentMove();});
function stopComputer(){taskId++;worker?.terminate();worker=null;thinking=false;}
function perform(move,source='human',revision=session.revision){
  if(!session.canMove)return false;
  try{
    if(!session.move(move,source,revision))return false;
    selected=null;save();render();
    if(session.state.result)showResult();else maybeComputer();
    return true;
  }catch(error){notify('這一步無法移動，請重新選擇。');console.error(error);return false;}
}
function chooseHumanMove(choices){
  if(choices.length===1){perform(choices[0]);return;}
  const promotion=choices.find(move=>move.promote===true),unchanged=choices.find(move=>!move.promote);
  if(!promotion||!unchanged){perform(choices[0]);return;}
  const revision=session.revision,type=session.state.board[promotion.from].type;
  const upgraded=type==='P'?'H':'S';
  showSheet(`<h2>要讓${names[type]}升級嗎？</h2><p>升級後，走法會和狗相同。</p><div class="promotion-choices"><button id="promote-yes" class="promotion-choice button-primary"><img src="./assets/${images[upgraded]}.svg" alt=""><span>升級成${names[upgraded]}</span></button><button id="promote-no" class="promotion-choice button-secondary"><img src="./assets/${images[type]}.svg" alt=""><span>保持${names[type]}</span></button></div>`);
  const confirm=move=>{if(revision!==session.revision||!session.canMove)return;closeSheet();perform(move,'human',revision);};
  $('#promote-yes').onclick=()=>confirm(promotion);
  $('#promote-no').onclick=()=>confirm(unchanged);
}
$('#board').addEventListener('click',event=>{
  const cell=event.target.closest('[data-square]');
  if(!cell||!canSelect())return;
  const to=Number(cell.dataset.square),piece=session.state.board[to],moves=legalMoves(session.state);
  if(selected){const choices=moves.filter(move=>move.to===to&&(selected.drop?move.drop===selected.drop:move.from===selected.from));if(choices.length){chooseHumanMove(choices);return;}}
  selected=piece?.owner===session.state.turn?(selected?.from===to&&!selected.drop?null:{from:to}):null;
  render();
});
$('.tabletop').addEventListener('click',event=>{
  const element=event.target.closest('[data-hand]');
  if(!element||element.disabled||!canSelect()||Number(element.dataset.owner)!==session.state.turn)return;
  selected=selected?.drop===element.dataset.hand?null:{drop:element.dataset.hand};render();
});
function maybeComputer(){
  if(!session.isComputerTurn||thinking||$('#sheet').open)return;
  thinking=true;render();const id=++taskId,revision=session.revision;
  try{
    worker=new Worker('./ai-worker.js',{type:'module'});
    worker.onmessage=({data})=>{
      // Both the UI request and the live session must still be current.
      if(id!==taskId||revision!==session.revision||!session.isComputerTurn)return;
      worker?.terminate();worker=null;thinking=false;
      if(data.id!==id||data.error||!data.move){render();notify('電腦思考中斷，點選回合提示重試。');return;}
      perform(data.move,'computer',revision);
    };
    worker.onerror=error=>{if(id!==taskId)return;stopComputer();render();notify('電腦未能載入，點選回合提示重試。');console.error(error);};
    worker.postMessage({id,state:session.state,level:session.config.level});
  }catch(error){stopComputer();render();notify('電腦未能啟動，請重新整理。');console.error(error);}
}
$('#turn-banner').onclick=()=>{if(session.screen==='play'&&session.state.result)showResult();else maybeComputer();};
function showSheet(content,variant=''){
  $('#sheet').classList.toggle('history-sheet',variant==='history');
  importRequest++;
  stopComputer();render();$('#sheet-content').innerHTML=content;
  if(!$('#sheet').open)$('#sheet').showModal();
}
function closeSheet(){importRequest++;$('#sheet').close();}
$('#sheet-close').onclick=closeSheet;
$('#sheet').addEventListener('close',()=>{importRequest++;render();maybeComputer();});
$('#sheet').addEventListener('cancel',()=>{importRequest++;});
$('#sheet').addEventListener('click',event=>{
  if(event.target!==$('#sheet'))return;const bounds=event.target.getBoundingClientRect();
  if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)closeSheet();
});
function goHome(){stopComputer();session.home();selected=null;save();closeSheet();render();window.scrollTo?.({top:0,behavior:'auto'});}
function enterReview(id){stopComputer();selected=null;if(!session.enterReview(id))return;closeSheet();render();window.scrollTo?.({top:0,behavior:'auto'});}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function showHistory(){
  const games=session.archive;
  showSheet(`<div class="history-heading"><h2>棋局回顧</h2><button id="import-record" class="history-import"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/></svg>匯入棋譜</button></div><p id="import-status" class="field-help" role="status" hidden></p><p id="import-error" class="field-error" role="alert" hidden></p><p>保留最近七場已完成棋局，較新的排在上方。</p>${games.length?`<ul class="history-list">${games.map((game,index)=>`<li class="history-item"><button id="history-open-${index}" class="history-open" aria-label="回顧 ${escapeHtml(recordTitle(game))}"><span class="history-date">${escapeHtml(recordDate(game))}</span><strong>${escapeHtml(recordOutcome(game))}</strong></button><button id="history-delete-${index}" class="history-delete" aria-label="刪除 ${escapeHtml(recordTitle(game))}"><span aria-hidden="true">×</span></button></li>`).join('')}</ul>`:'<p class="history-empty">還沒有已完成的棋局。<br>完成一局或認輸後，就會出現在這裡。</p>'}`,'history');
  $('#import-record').onclick=()=>{importRequest++;$('#import-error').hidden=true;$('#import-status').hidden=true;const input=$('#record-import-file');input.value='';input.click();};
  games.forEach((game,index)=>{
    $('#history-open-'+index).onclick=()=>enterReview(game.id);
    $('#history-delete-'+index).onclick=()=>showDeleteRecord(game.id);
  });
}
function showDeleteRecord(id){
  const game=session.archive.find(game=>game.id===id);
  if(!game){showHistory();return;}
  showSheet(`<h2>是否要刪除紀錄</h2><p class="confirm-details">${escapeHtml(recordTitle(game))}</p><div class="dialog-actions"><button id="confirm-delete" class="button-primary">刪除</button><button id="cancel-delete" class="button-secondary">取消</button></div>`);
  $('#confirm-delete').onclick=()=>{if(session.deleteGame(id))save();showHistory();};
  $('#cancel-delete').onclick=showHistory;
}
$('#record-import-file').addEventListener('cancel',()=>{
  importRequest++;const status=$('#import-status');if(status)status.hidden=true;
});
$('#record-import-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';
  const button=$('#import-record');
  if(!file||!button||session.screen!=='home'||!$('#sheet').open)return;
  const request=++importRequest,revision=session.revision;
  const current=()=>request===importRequest&&revision===session.revision&&session.screen==='home'&&$('#sheet').open&&$('#import-record')===button;
  const fail=message=>{if(!current())return;$('#import-status').hidden=true;const error=$('#import-error');error.textContent=message;error.hidden=false;};
  $('#import-error').hidden=true;
  if(!/\.txt$/i.test(file.name||'')){fail('請選擇 TXT 格式的棋譜檔案。');return;}
  if(file.size>1024*1024){fail('檔案過大，請選擇1MB以內的 TXT 棋譜。');return;}
  $('#import-status').textContent='正在讀取棋譜…';$('#import-status').hidden=false;
  let text;
  try{text=await file.text();}catch{fail('無法讀取檔案，請重新選擇。');return;}
  if(!current())return;
  let game;
  try{game=parseRecordImport(text);}catch(error){fail(error?.message||'棋譜內容不正確，無法匯入。');return;}
  if(!current())return;
  if(!session.enterImportedReview(game)){fail('棋譜內容不正確，無法匯入。');return;}
  stopComputer();selected=null;closeSheet();render();window.scrollTo?.({top:0,behavior:'auto'});
});
function showResign(){
  if(!session.canResign)return;
  const revision=session.revision,loser=session.config.mode==='com'?0:session.state.turn;
  showSheet(`<h2>確定要投降嗎？</h2><p class="confirm-details">${player(loser,session.config)}認輸，${player(1-loser,session.config)}獲勝。</p><div class="dialog-actions"><button id="confirm-resign" class="button-primary">確認投降</button><button id="cancel-resign" class="button-secondary">取消</button></div>`);
  $('#confirm-resign').onclick=()=>{
    if(revision!==session.revision||!session.resign())return;
    selected=null;save();render();showResult();
  };
  $('#cancel-resign').onclick=closeSheet;
}
function showExport(){
  const game=session.reviewGame;
  if(session.screen!=='review'||!game)return;
  const first=game.config.first,identity=owner=>playerIdentity(owner,game.config);
  showSheet(`<h2>匯出棋譜</h2><dl class="export-summary"><dt>棋局日期</dt><dd>${escapeHtml(recordDate(game))}</dd><dt>先後手與<br>勝負結果</dt><dd>先手：${identity(first)}<br>後手：${identity(1-first)}<br>結果：${escapeHtml(recordOutcome(game))}</dd></dl><label class="export-note" for="export-note">備註（選填）<input id="export-note" type="text" maxlength="40" autocomplete="off" aria-describedby="export-help export-count export-error"></label><p id="export-help" class="field-help">最多20字，只接受中英文字、數字與空白。</p><span id="export-count" class="export-count" aria-live="polite">0 / 20</span><p id="export-error" class="field-error" role="status" hidden></p><div class="dialog-actions"><button id="export-save" class="button-primary">存檔</button><button id="export-cancel" class="button-secondary">取消</button></div>`);
  const input=$('#export-note'),error=$('#export-error'),button=$('#export-save');
  const validate=()=>{
    const value=input.value||'',check=validateNote(value);
    $('#export-count').textContent=`${Array.from(value).length} / 20`;
    input.setAttribute('aria-invalid',String(!check.valid));
    error.textContent=check.error||'';error.hidden=check.valid;button.disabled=!check.valid;
    return check;
  };
  input.oninput=validate;
  $('#export-cancel').onclick=closeSheet;
  button.onclick=()=>{
    const check=validate();if(!check.valid)return;
    let url;
    try{
      const exported=createRecordExport(game,check.note);
      const blob=new Blob(['\uFEFF',exported.text],{type:'text/plain;charset=utf-8'});
      url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');anchor.href=url;anchor.download=exported.filename;
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      closeSheet();notify('已匯出棋譜，請查看下載項目。');
    }catch(error){if(url)URL.revokeObjectURL(url);notify('無法匯出棋譜，請再試一次。');console.error(error);}
  };
  validate();
}
$('#resign').onclick=showResign;
$('#export-record').onclick=showExport;
$('#go-home').onclick=goHome;
$('#resume-game').onclick=()=>{stopComputer();session.resume();selected=null;render();window.scrollTo?.({top:0,behavior:'auto'});maybeComputer();};
$('#home-history').onclick=showHistory;
$('#exit-review').onclick=()=>{stopComputer();session.exitReview();selected=null;render();window.scrollTo?.({top:0,behavior:'auto'});};
for(const [id,index] of [['review-first',()=>0],['review-prev',()=>session.reviewIndex-1],['review-next',()=>session.reviewIndex+1],['review-last',()=>session.reviewLength-1]]){
  $('#'+id).onclick=()=>{session.reviewAt(index());render();};
}
function beginGame(mode,level,first){stopComputer();session.start({mode,level,first});setupDefaults={...session.config};selected=null;save();closeSheet();render();window.scrollTo?.({top:0,behavior:'auto'});maybeComputer();}
function newGameSheet(mode=session.config.mode){
  let first=setupDefaults.first,level=setupDefaults.level;
  showSheet(`<h2>${mode==='com'?'挑戰電腦':'雙人對弈'}</h2><h3>選擇先手</h3><div class="first-picker"><button data-first="0" class="${first===0?'active':''}" aria-pressed="${first===0}">1P</button><button data-first="1" class="${first===1?'active':''}" aria-pressed="${first===1}">${mode==='com'?'AI':'2P'}</button></div>${mode==='com'?`<h3>電腦難度</h3><div class="level-picker" role="group" aria-label="新局電腦難度">${['low','medium','high'].map(value=>`<button data-setup-level="${value}" class="${value===level?'active':''}" aria-pressed="${value===level}"><strong>${levels[value]}</strong><small>${levelDescriptions[value]}</small></button>`).join('')}</div><p class="setup-note">遊戲開始後，無法變更難度</p><details class="ai-explain"><summary>電腦難度詳細說明</summary><p>電腦會逐步往後思考，難度越高，搜尋越深入。每回合以約30%／20%／10%的機率選擇較差的棋步，但會排除搜尋範圍內已知會輸的走法。實際搜尋深度依局面與裝置速度調整；沒有合適的較差步時，採取最佳走法。</p></details>`:''}${session.hasGame&&!session.state.result?'<p class="setup-note">開始新局會取代目前尚未完成的對局。</p>':''}<button id="confirm-new" class="button-primary">開始下棋 →</button><button id="cancel-new" class="button-secondary">取消</button>`);
  document.querySelectorAll('[data-first]').forEach(element=>element.onclick=()=>{first=Number(element.dataset.first);document.querySelectorAll('[data-first]').forEach(button=>{const active=Number(button.dataset.first)===first;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});});
  document.querySelectorAll('[data-setup-level]').forEach(element=>element.onclick=()=>{level=element.dataset.setupLevel;document.querySelectorAll('[data-setup-level]').forEach(button=>{const active=button.dataset.setupLevel===level;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});});
  $('#confirm-new').onclick=()=>beginGame(mode,level,first);$('#cancel-new').onclick=closeSheet;
}
$('#new-game').onclick=()=>newGameSheet();
document.querySelectorAll('[data-mode]').forEach(element=>element.onclick=()=>newGameSheet(element.dataset.mode));
function undoMove(){if(!session.canUndo)return;stopComputer();if(session.undo()){selected=null;save();render();closeSheet();maybeComputer();notify(session.config.mode==='com'?'已退回你上一步之前':'已退回上一步');}}
$('#undo').onclick=undoMove;
function showResult(){
  if(session.screen!=='play'||!session.state.result)return;
  const result=session.state.result;
  const reasons={resign:`${player(result.resignedBy,session.config)}認輸`,checkmate:'將死！對方的獅子無法脫離攻擊',repetition:'相同局面出現四次，這局是和棋','perpetual-check':`${player(1-result.winner,session.config)}持續將軍造成四次重複，判負`,'no-moves':'對方已沒有合法棋步'};
  showSheet(`<div class="result-wrap"><img class="result-animal" src="./assets/${result.winner===null?'chick':'lion'}.svg" alt=""><h2>${result.winner===null?'這一局，平分秋色':`${player(result.winner)}獲勝！`}</h2><div class="result-reason">${result.reason==='resign'?'<span class="result-kind">主動投降</span>':''}${reasons[result.reason]}</div><button id="play-again" class="button-primary">再來一局 →</button><button id="review-board" class="button-secondary">回顧上一局</button></div>`);
  $('#play-again').onclick=()=>newGameSheet();$('#review-board').onclick=()=>enterReview();
}
function showSettings(){
  const config=session.displayConfig;
  showSheet(`<h2>設定</h2><div class="settings-list"><label class="setting-row"><span>顯示可走位置<small>點選棋子後，標示可前往的格子</small></span><input id="setting-hints" type="checkbox" ${preferences.showHints?'checked':''}></label><label class="setting-row"><span>標示上一手<small>在棋盤上標示最近移動的位置</small></span><input id="setting-last" type="checkbox" ${preferences.highlightLast?'checked':''}></label><button class="setting-row" id="settings-rules"><span>遊戲規則</span><span aria-hidden="true">›</span></button><button class="setting-row" id="settings-offline"><span>離線遊玩<small>${offlineReady?'檔案已就緒':'查看準備方式'}</small></span><span aria-hidden="true">›</span></button></div>${session.hasGame&&config.mode==='com'?`<p>本局電腦難度：${levels[config.level]}<br>難度僅能在開啟新局時設定</p>`:''}<button class="button-primary" id="settings-done">完成</button>`);
  $('#setting-hints').onchange=event=>{preferences.showHints=event.target.checked;save();render();};
  $('#setting-last').onchange=event=>{preferences.highlightLast=event.target.checked;save();render();};
  $('#settings-rules').onclick=showRules;$('#settings-offline').onclick=showOffline;$('#settings-done').onclick=closeSheet;
}
$('#settings-open').onclick=showSettings;$('#home-settings').onclick=showSettings;
function showRules(page=0){
  const index=Number.isFinite(page)?Math.max(0,Math.min(RULE_PAGE_COUNT-1,Math.trunc(page))):0;
  showSheet(`${renderRulesPage(index)}<nav class="rules-pagination" aria-label="規則翻頁"><button id="rules-prev" class="button-secondary" ${index===0?'disabled':''}>上一頁</button><span id="rules-page-number" role="status" aria-live="polite">${index+1} / ${RULE_PAGE_COUNT}</span>${index===RULE_PAGE_COUNT-1?'<button id="rules-done" class="button-primary">開始玩</button>':'<button id="rules-next" class="button-primary">下一頁</button>'}</nav>`);
  $('#rules-prev').onclick=()=>showRules(index-1);
  if(index<RULE_PAGE_COUNT-1)$('#rules-next').onclick=()=>showRules(index+1);
  else $('#rules-done').onclick=closeSheet;
  $('#sheet').scrollTop=0;
  $('#rules-title')?.focus?.({preventScroll:true});
}
$('#home-rules').onclick=()=>showRules(0);

function checkOffline(reg){return new Promise(resolve=>{const readyWorker=reg.active;if(!readyWorker){offlineReady=false;updateOfflineStatus();resolve(false);return;}const channel=new MessageChannel();const finish=ready=>{clearTimeout(timer);offlineReady=ready;updateOfflineStatus();channel.port1.close();resolve(ready);};const timer=setTimeout(()=>finish(false),4000);channel.port1.onmessage=event=>{if(event.data?.type==='CACHE_STATUS')finish(Boolean(event.data.ready)&&event.data.version===OFFLINE_CACHE);};readyWorker.postMessage({type:'CACHE_STATUS'},[channel.port2]);});}
function updateOfflineStatus(){
  const element=$('#offline-status');
  element.classList.toggle('ready',offlineReady);
  element.querySelector('.status-dot').textContent=offlineReady?'✓':'!';
  element.querySelector('span:last-child').textContent='離線遊玩';
  const description=offlineReady?'離線遊玩：已就緒，可離線對弈':'離線遊玩：尚未就緒，點選查看準備方式';
  element.setAttribute('aria-label',description);
  element.setAttribute('title',description);
}
function showOffline(){showSheet(`<h2>${offlineReady?'現在可以離線遊玩':'準備離線遊玩'}</h2><p>${offlineReady?'遊戲檔案與三種電腦難度已儲存在這個瀏覽器，離線也能繼續遊玩。':'請保持網路連線並重新整理，等待遊戲檔案完整儲存。若瀏覽器不支援離線快取，請改用最新版 Safari 或 Chrome。'}</p><h3>加入手機主畫面</h3><p>iPhone：Safari 的分享選單 → 加入主畫面。<br>Android：Chrome 選單 → 安裝應用程式／加到主畫面。</p><p>加入後，請從主畫面開啟一次，確認「離線遊玩」亮起綠燈 ✓。出發前可以開啟飛航模式試玩。清除瀏覽器資料或系統回收儲存空間後，需要重新連網準備。</p><p>棋局只保存在這台裝置的瀏覽器中。使用一般瀏覽模式，可讓旅途中更容易接續進度。</p><button id="offline-check" class="button-primary">重新檢查離線狀態</button>`);$('#offline-check').onclick=async()=>{closeSheet();if('serviceWorker'in navigator){const reg=await navigator.serviceWorker.getRegistration();if(reg)await checkOffline(reg);}notify(offlineReady?'離線檔案已備妥，可開飛航模式試玩。':'尚未完成，請連網後重新整理。');};}

$('#offline-status').onclick=showOffline;
window.addEventListener('online',updateOfflineStatus);window.addEventListener('offline',updateOfflineStatus);
async function prepareOffline(){
  if(!('serviceWorker'in navigator)){updateOfflineStatus();return;}
  try{
    const reg=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    const check=()=>checkOffline(reg);
    const watch=installing=>installing?.addEventListener('statechange',()=>{if(installing.state==='activated')check();});
    // Observe upgrades before waiting: an old active worker can already be ready.
    navigator.serviceWorker.addEventListener('controllerchange',check);
    reg.addEventListener('updatefound',()=>watch(reg.installing));
    watch(reg.installing);
    await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Offline installation timed out')),20000))]);
    await check();
  }catch(error){console.error('Offline preparation failed',error);offlineReady=false;updateOfflineStatus();}
}
save();render();prepareOffline();
