// Deterministic, browser-free checks for the ten realms and the card economy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = html.indexOf('<script>\n(() => {');
const end = html.lastIndexOf('</script>');
assert(start >= 0 && end > start, 'game script exists');
let script = html.slice(start + '<script>\n'.length, end);
const listener = script.indexOf("  $('setup').addEventListener('click'");
assert(listener >= 0, 'event-listener boundary exists');
script = script.slice(0, listener) + `
  let doorTapTimer=null,doorTapIndex=null;
  function clearDoorTap(){}
  render=()=>{};
  paintScene=()=>{};
  globalThis.audit={state,wheelSegments,wheelLabels,zoneBosses,difficulties,monsters,monsterPools,
    prepareDoors,openDoor,probeDoor,drawBoosterCards,grantBooster,slotRarities,
    selectBoosterCard,placeBoosterCard,finishDeckTurn,readyForFinal,monsterHearts};
})();`;

const classList = { add(){}, remove(){} };
const door = () => ({disabled:false,classList});
const nodes = {
  game:{classList},stage:{classList},
  choiceZone:{querySelectorAll:() => [door(),door(),door()]}
};
const sandbox = {
  document:{getElementById:id => nodes[id] || {classList}},
  window:{matchMedia:() => ({matches:true}),donjonLive:{role:'J1'}},
  setTimeout:fn => {fn();return 1},clearTimeout(){},
  setInterval(){return 1},clearInterval(){},
  console
};
vm.runInNewContext(script, sandbox, {filename:'index.html'});
const a = sandbox.audit;
const player = name => ({name,max:3,hp:3,rooms:0,detours:0,weapon:'sword',items:[],bag:[],
  boosters:[],hand:[],slots:[null,null,null,null],outfit:null,focus:0,doorMalus:0,
  returningDoor:null,guard:0,power:0,lastStand:false,potionReceived:true,keyDropped:false,
  eraseKey:false,monsterGoal:2,pendingEncounter:null,finalEntered:false,finalWon:false});
const reset = zone => {
  a.state.players=[player('Agathène'),player('Clémentis')];
  a.state.active=0;a.state.roomCap=4;a.state.difficulty=zone;a.state.phase='doors';
  a.state.doorSet=[];a.state.doorProbe=null;a.state.boosterTurn=0;
};

assert.equal(a.wheelSegments.length, 10);
assert.equal(new Set(a.wheelSegments).size, 10);
assert.equal(a.wheelLabels.length, 10);
assert.equal(new Set(a.monsters.map(monster => monster.id)).size, a.monsters.length);
for (const zone of a.wheelSegments) {
  assert(a.difficulties[zone]?.surprises.length, `${zone}: events`);
  assert(a.zoneBosses[zone]?.id, `${zone}: boss`);
  reset(zone);
  for (let trial=0;trial<60;trial++) {
    a.prepareDoors();
    assert.equal(a.state.doorSet.length,3,`${zone}: three doors`);
    assert(a.state.doorSet.every(door => door.type && door.look),`${zone}: usable doors`);
  }
  a.state.doorSet=[{type:'enemy',look:'oak'}];
  a.openDoor(0);
  assert.equal(a.state.phase,'combat-ready',`${zone}: combat starts`);
  assert(a.state.enemy?.monster?.id,`${zone}: monster exists`);
  reset(zone);
  a.state.players[0].rooms=1;a.state.players[0].detours=2;
  a.state.players[1].rooms=1;a.state.players[1].detours=2;
  a.prepareDoors();
  assert.equal(a.state.phase,'final-doors',`${zone}: final is reachable`);
  assert(a.state.doorSet.every(door => door.type==='final'),`${zone}: final exits`);
  a.openDoor(0);
  assert.equal(a.state.phase,'final-ready',`${zone}: boss starts`);
}

reset('normal');
a.state.doorSet=[{type:'hole',look:'oak'}];a.openDoor(0);
assert.equal(a.state.phase,'event');
assert.equal(a.state.players[0].hp,2);
assert.equal(a.state.players[1].hp,2);
assert.equal(a.state.players[0].detours,1);
assert.equal(a.state.players[1].detours,1);
reset('normal');
a.prepareDoors();a.probeDoor(0);
assert.equal(a.state.doorProbe.index,0);
assert([0,1].includes(a.state.players[0].doorMalus));

const artSandbox={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'creature-art.js'),'utf8'),artSandbox);
for (const monster of a.monsters) {
  const markup=artSandbox.window.DonjonArt.monster(monster.id,monster.name);
  assert(markup.includes('viewBox="0 0 512 512"'),`${monster.id}: clipped art`);
  assert(markup.includes('assets/monsters-'),`${monster.id}: atlas`);
}
for (const zone of a.wheelSegments) {
  const boss=a.zoneBosses[zone];
  assert(artSandbox.window.DonjonArt.monster(boss.id,boss.name).includes('assets/monsters-'),`${zone}: boss art`);
}

reset('castle');
let empty=0,full=0,curse=0;
for (let i=0;i<1000;i++) {
  const cards=a.drawBoosterCards({id:i+1,source:i%4?'combat':'boss'},i%2);
  assert(cards.length>=0 && cards.length<=5,'booster: zero to five cards');
  assert(cards.every(card => ['common','rare','legendary'].includes(card.rarity)));
  assert(cards.every(card => ['outfit','pink','relic','curse'].includes(card.kind)));
  if(!cards.length)empty++;
  if(cards.length===5)full++;
  curse+=cards.filter(card => card.kind==='curse').length;
}
assert(empty>0 && full>0 && curse>0,'all booster outcomes can occur');
assert.equal(a.slotRarities.join(','),'common,common,rare,legendary');
assert(a.monsterHearts(1,1).includes('Monstre : 1 point de vie sur 1'));
a.state.phase='deck-build';a.state.deckTurn=0;
a.state.players[0].hand=[{id:'rare',name:'Rare',rarity:'rare'}];
a.selectBoosterCard(0);a.placeBoosterCard(0);
assert.equal(a.state.players[0].hand.length,1,'wrong rarity rejected');
a.placeBoosterCard(2);
assert.equal(a.state.players[0].slots[2].id,'rare','matching rarity accepted');
console.log(`OK: ${a.wheelSegments.length} donjons, portes et boss; ${a.monsters.length} créatures; 1 000 boosters; emplacements de rareté.`);
