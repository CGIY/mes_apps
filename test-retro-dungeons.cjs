const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(`${__dirname}/index.html`, 'utf8');
const live = fs.readFileSync(`${__dirname}/donjon-live.js`, 'utf8');
const start = html.indexOf('<script>\n(() => {');
const end = html.lastIndexOf('</script>');
assert(start >= 0 && end > start);
let script = html.slice(start + '<script>\n'.length, end);
const listener = script.indexOf("  $('setup').addEventListener('click'");
assert(listener >= 0);
script = script.slice(0, listener) + `
  render=()=>{};
  paintScene=()=>{};
  globalThis.audit={state,wheelSegments,difficulties,zoneBosses,prepareDoors,renderDoors,probeDoor,openDoor};
})();`;

const classes = () => ({add(){},remove(){}});
const doors = Array.from({length:3}, () => ({disabled:false,classList:classes()}));
const nodes = {
  game:{classList:classes()},stage:{classList:classes()},overlay:{hidden:true},
  choiceZone:{hidden:false,innerHTML:'',querySelectorAll:() => doors},
  caption:{hidden:false},captionTitle:{textContent:''},captionCopy:{textContent:''}
};
const sandbox = {
  document:{getElementById:id => nodes[id] || {classList:classes()}},
  window:{donjonLive:{role:'J1'},matchMedia:() => ({matches:true})},
  setTimeout(){return 1},clearTimeout(){},setInterval(){return 1},clearInterval(){},console
};
vm.runInNewContext(script, sandbox, {filename:'index.html'});
const a = sandbox.audit;
const player = name => ({name,max:3,hp:3,rooms:0,detours:0,weapon:'sword',items:[],bag:[],
  outfit:null,focus:0,doorMalus:0,returningDoor:null,guard:0,power:0,lastStand:false,
  potionReceived:true,keyDropped:false,eraseKey:false,coins:0,monsterGoal:2,pendingEncounter:null,
  finalEntered:false,finalWon:false});
function reset(zone){
  a.state.players=[player('Agathène'),player('Clémentis')];
  a.state.active=0;a.state.roomCap=4;a.state.difficulty=zone;a.state.phase='doors';
  a.state.doorSet=[];a.state.doorProbe=null;
}

assert.equal(a.wheelSegments.length,10);
assert.equal(new Set(a.wheelSegments).size,10);
for(const zone of a.wheelSegments){
  assert(a.difficulties[zone]?.surprises.length,`${zone}: events`);
  assert(a.zoneBosses[zone]?.id,`${zone}: boss`);
  reset(zone);
  for(let trial=0;trial<30;trial++){
    a.prepareDoors();
    assert.equal(a.state.doorSet.length,3,`${zone}: three doors`);
    assert(a.state.doorSet.every(door => door.type && door.look),`${zone}: usable doors`);
  }
}

reset('normal');
a.state.doorSet=[{type:'enemy',look:'oak'},{type:'cache',look:'stone'},{type:'curse',look:'iron'}];
a.renderDoors();
assert.equal((nodes.choiceZone.innerHTML.match(/data-action="open-door"/g)||[]).length,3);
assert.equal((nodes.choiceZone.innerHTML.match(/data-action="knock-door"/g)||[]).length,3);
assert.equal((nodes.choiceZone.innerHTML.match(/class="door-portal"/g)||[]).length,3);
assert(html.includes('.door-peek{') && html.includes('min-height:44px'),'peek button has a touch target');
assert(html.includes('.choice-zone .door-portal:nth-child(2) .glint'),'door animation stagger follows aligned portals');
assert(!html.includes('donjonHandleDoorTap'),'no double-tap door handling');
assert(!live.includes('donjonHandleDoorTap'),'remote taps use direct button actions');
a.probeDoor(0);
a.renderDoors();
assert.equal(a.state.doorProbe.index,0);
assert.equal((nodes.choiceZone.innerHTML.match(/data-action="open-door"/g)||[]).length,3);
assert.equal((nodes.choiceZone.innerHTML.match(/data-action="knock-door"/g)||[]).length,0);
assert(nodes.captionCopy.textContent.includes('Choisis ta porte.'),'peeking does not force the probed door');
a.openDoor(1);
assert.equal(a.state.phase,'opening','a different door can open immediately after peeking');

const animatedSelectors={
  sanctuary:'.theme-sanctuary .atmosphere-layer:after',
  returning:'.theme-returning .air-mote',
  lighthouse:'.theme-lighthouse .ground-mist',
  theatre:'.theme-theatre .atmosphere-layer:before'
};
for(const [zone,selector] of Object.entries(animatedSelectors)){
  assert(html.includes(selector),`${zone}: distinct animated atmosphere`);
}
assert(html.includes('@media(prefers-reduced-motion:reduce)'), 'reduced motion supported');
console.log('OK: 10 donjons, portes à boutons, choix libre après indice et ambiances animées.');
