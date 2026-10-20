const assert = require('node:assert/strict');
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const random = require('node:crypto').randomBytes;
const code = Array.from(random(8), n => alphabet[n % alphabet.length]).join('');
const token = () => random(24).toString('hex');
const host = token();
const guest = token();
const endpoint = 'https://tgkhgafkqvritsgdapcz.supabase.co/rest/v1/rpc/donjon_exchange';
const key = 'sb_publishable_GhmpioVNsGFgHtJsaGXqsg__P3DRtpA';
async function call(role, deviceToken, extra = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key },
    body: JSON.stringify({
      p_code: code, p_role: role, p_token: deviceToken,
      p_create: false, p_expected_version: null,
      p_snapshot: null, p_action: null, p_clear_action_id: null,
      ...extra
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${body.message}`);
  return body;
}
(async () => {
  let a = await call('J1', host, { p_create: true });
  assert.equal(a.version, 0);
  let c = await call('J2', guest);
  assert.equal(c.ready, true);
  a = await call('J1', host, { p_expected_version: 0, p_snapshot: { gameState: { phase: 'setup', active: 0 }, view: { setup: 'test' } } });
  assert.equal(a.version, 1);
  const action = { id: random(8).toString('hex'), data: { weapon: 'sword', weaponPlayer: '1' } };
  c = await call('J2', guest, { p_action: action });
  assert.equal(c.pending_action, null);
  a = await call('J1', host);
  assert.equal(a.pending_action.id, action.id);
  a = await call('J1', host, { p_expected_version: 1, p_snapshot: { gameState: { phase: 'setup', active: 0, weaponPicks: ['axe', 'sword'] }, view: { setup: 'test2' } }, p_clear_action_id: action.id });
  assert.equal(a.version, 2);
  assert.equal(a.pending_action, null);
  c = await call('J2', guest);
  assert.deepEqual(c.snapshot.gameState.weaponPicks, ['axe', 'sword']);
  console.log('Donjon Supabase: création, jonction, action, synchro et contrôle de version OK');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
