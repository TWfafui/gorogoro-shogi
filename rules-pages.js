import {directions} from './engine.js';

const ANIMALS = {
  L:{name:'獅子',image:'lion',action:'前後、左右、斜角，八個方向'},
  D:{name:'狗',image:'dog',action:'正前、斜前、左右和正後'},
  C:{name:'貓',image:'cat',action:'正前、斜前和斜後'},
  P:{name:'小雞',image:'chick',action:'只能向前走一格'},
  H:{name:'母雞',image:'hen',action:'和狗一樣，不能走斜後方'},
  S:{name:'強化貓',image:'super-cat',action:'和狗一樣，不能走斜後方'},
};

function movementDiagram(type) {
  const dots = directions(type,0).map(([dx,dy]) =>
    `<circle cx="${30+dx*20}" cy="${30+dy*20}" r="4.5" fill="#bd493d"/>`
  ).join('');
  return `<svg class="move-diagram" data-piece-type="${type}" viewBox="0 0 60 60" role="img" aria-labelledby="rules-direction-${type}">
    <title id="rules-direction-${type}">${ANIMALS[type].name}的可走方向，向上為前方：${ANIMALS[type].action}</title>
    <rect x="1" y="1" width="58" height="58" rx="6" fill="#e7ddc4" stroke="#a6926d"/>
    <rect x="23" y="23" width="14" height="14" rx="3" fill="#526943"/>
    ${dots}
  </svg>`;
}

function animalCard(type) {
  const animal = ANIMALS[type];
  return `<article class="rule-animal-card"><img src="./assets/${animal.image}.svg" alt=""><div class="rule-animal-text"><strong>${animal.name}</strong><span>${animal.action}</span></div>${movementDiagram(type)}</article>`;
}

const PAGES = [
  () => `<h2 id="rules-title" tabindex="-1">輪流走一隻動物</h2>
    <p class="rules-copy">棋盤有<strong>5 欄、6 排</strong>。雙方各有獅子 1 隻、狗 2 隻、貓 2 隻和小雞 3 隻。</p>
    <p class="rules-copy">兩人輪流走，每回合移動一隻自己的動物，<strong>只走一格</strong>。不能走到自己動物所在的格子。</p>
    <div class="rules-pieces">${['L','D','C'].map(animalCard).join('')}</div>
    <p class="rules-copy">紅點表示可走方向。圖中向上是前方；棋盤上方玩家的前方朝下。</p>`,
  () => `<h2 id="rules-title" tabindex="-1">小雞和貓會升級</h2>
    <div class="rules-pieces">${['P','H','S'].map(animalCard).join('')}</div>
    <p class="rules-copy">離自己最遠的<strong>兩排是敵陣</strong>。小雞或貓的一步，只要起點或終點在敵陣，就能選擇升級：小雞變母雞，貓變強化貓。</p>
    <p class="rules-copy">所以<strong>進入、在敵陣內移動，或離開敵陣</strong>都能選擇升級，也可以保持原樣。</p>
    <p class="rules-copy"><strong>小雞走到對方最後一排，必須升級</strong>；貓仍可選擇。升級後不能自己變回來。</p>`,
  () => `<h2 id="rules-title" tabindex="-1">吃子，請夥伴回來</h2>
    <p class="rules-copy">走到對方動物的格子，就能吃掉牠，讓牠成為你的<strong>持駒</strong>。母雞會變回小雞，強化貓會變回貓。</p>
    <p class="rules-copy">輪到你時，也可以把一隻持駒<strong>打入空格</strong>。這就是一回合，不能再移動別的動物。打入時不能升級，即使放在敵陣也一樣。</p>
    <p class="rules-copy">打入小雞有三個限制：</p>
    <ul class="rules-copy">
      <li>不能打在對方<strong>最後一排</strong>。</li>
      <li>同一縱欄已有自己的未升級小雞，就不能再打入小雞，這叫<strong>二小雞</strong>。自己的母雞和對方的小雞不算。</li>
      <li>不能打入小雞<strong>直接將死</strong>對方。盤上小雞移動造成將死，或打入狗、貓造成將死，都可以。</li>
    </ul>`,
  () => `<h2 id="rules-title" tabindex="-1">先讓獅子安全</h2>
    <p class="rules-copy">獅子正被對方攻擊，就是<strong>將軍</strong>。被將軍時，下一步<strong>一定要解將</strong>：讓獅子逃開、吃掉攻擊者，或用其他合法方法讓牠安全。</p>
    <p class="rules-copy">無論移動或打入，完成後都<strong>不能讓自己的獅子受攻擊</strong>。</p>
    <p class="rules-copy">被將軍，而且沒有任何合法解將步，就是<strong>將死</strong>。遊戲會立刻判對方獲勝，不必再吃掉獅子。</p>
    <p class="rules-copy">輪到的一方若沒有任何合法棋步，也會輸。獅子走到最遠一排不會獲勝；也可以按「認輸」結束對局。</p>`,
  () => `<h2 id="rules-title" tabindex="-1">同一局面出現四次</h2>
    <p class="rules-copy">同一局面<strong>第四次出現，通常是和棋</strong>。開局也算一次，不必連續出現。</p>
    <p class="rules-copy">「同一局面」要全部一樣：棋盤上的動物（種類、升級與屬於哪一方）、雙方持駒的種類和數量，以及輪到誰走。</p>
    <p class="rules-copy"><strong>連續將軍的例外：</strong>從這四次中的第一次之後，到第四次之間，涵蓋完整三次循環；如果同一方自己的每一步都在將軍，<strong>持續將軍的那一方會輸</strong>。</p>
    <p class="rules-copy">只要這段期間有一手沒有將軍，就不算這一方連續將軍。只看最後一次將軍，不能判負。</p>`,
];

export const RULE_PAGE_COUNT = PAGES.length;

/** Render one page; navigation belongs to the app. */
export function renderRulesPage(index = 0) {
  const page = typeof index === 'number' && Number.isFinite(index)
    ? Math.max(0,Math.min(RULE_PAGE_COUNT-1,Math.trunc(index))) : 0;
  return `<section class="rules-page" aria-label="遊戲規則，第${page+1}頁，共${RULE_PAGE_COUNT}頁">${PAGES[page]()}</section>`;
}
