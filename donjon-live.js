(() => {
  "use strict";
  const URL = "https://tgkhgafkqvritsgdapcz.supabase.co";
  const KEY = "sb_publishable_GhmpioVNsGFgHtJsaGXqsg__P3DRtpA";
  const client = window.supabase?.createClient(URL, KEY);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const $ = id => document.getElementById(id);
  const lobby = $("donjonLobby");
  const status = $("donjonLiveStatus");
  const roomInput = $("donjonCodeInput");
  const roomDisplay = $("donjonCodeDisplay");
  const roomDisplayWrap = $("donjonCodeDisplayWrap");
  const presence = $("donjonPresence");
  const badge = $("donjonLiveBadge");
  let engine;
  let role = "";
  let code = "";
  let token = "";
  let hostRole = "";
  let version = 0;
  let ready = false;
  let pollTimer = null;
  let polling = false;
  let busy = false;
  let pushing = false;
  let dirty = false;
  let pushTimer = null;
  let remoteDispatch = false;
  let actionInProgress = false;
  let lastViewVersion = -1;
  let pushIdle = Promise.resolve();
  const ownIndex = () => role === "J1" ? 0 : 1;
  const isHost = () => role && role === hostRole;
  const hex = count => Array.from(crypto.getRandomValues(new Uint8Array(count)), n => n.toString(16).padStart(2, "0")).join("");
  const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), n => alphabet[n % alphabet.length]).join("");
  const tokenKey = (c, r) => `donjon-token:${c}:${r}`;

  function say(message, error = false) {
    status.textContent = message;
    status.classList.toggle("is-error", error);
  }
  function refreshLobby() {
    const connected = Boolean(code);
    lobby.hidden = connected && ready;
    roomDisplayWrap.hidden = !connected;
    roomDisplay.textContent = code;
    presence.textContent = !connected ? "" : ready ? "Deux héros. Un Donjon." : `Code ${code} · l’autre arrive…`;
    badge.textContent = !connected ? "En attente" : ready ? engine?.readyLabel() || `${role === "J1" ? "A" : "C"} · liés` : "L’autre arrive…";
    document.documentElement.classList.toggle("donjon-live-ready", connected && ready);
    if (connected && ready && !busy) say("À deux, dans la même salle.");
  }
  function args(extra = {}) {
    return {
      p_code: code, p_role: role, p_token: token,
      p_create: false, p_expected_version: null,
      p_snapshot: null, p_action: null, p_clear_action_id: null,
      ...extra
    };
  }
  async function exchange(extra = {}) {
    if (!client) throw new Error("Connexion Supabase indisponible");
    const { data, error } = await client.rpc("donjon_exchange", args(extra));
    if (error) throw error;
    return data;
  }
  function handle(data) {
    const wasReady = ready;
    hostRole = data.host_role;
    ready = Boolean(data.ready);
    if (typeof data.version === "number") version = Math.max(version, data.version);
    if (!isHost() && data.snapshot && Object.keys(data.snapshot).length && data.version > lastViewVersion) {
      engine.apply(data.snapshot, false);
      lastViewVersion = data.version;
    }
    if (isHost() && data.pending_action && !actionInProgress) {
      void executeRemote(data.pending_action);
    }
    if (wasReady !== ready || ready) refreshLobby();
  }
  function fail(error) {
    const message = String(error?.message || error);
    if (message.includes("room_expired")) say("Partie terminée après 24 h. Lancez-en une nouvelle.", true);
    else if (message.includes("room_missing")) say("Code introuvable. L’autre doit lancer la partie d’abord.", true);
    else if (message.includes("role_taken")) say("Ce héros est déjà pris sur l’autre téléphone.", true);
    else if (message.includes("room_taken")) say("Code déjà pris. On en essaie un autre.", true);
    else if (message.includes("action_pending")) say("Ton action est en route…");
    else say("Connexion instable. On retente…", true);
  }
  async function connect(nextCode, nextRole, create = false) {
    if (busy) return false;
    const normalized = String(nextCode || "").trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(normalized) || !["J1", "J2"].includes(nextRole)) {
      say("Choisis A ou C, puis saisis les 8 caractères du code.", true);
      return false;
    }
    busy = true;
    const old = { code, role, token };
    code = normalized;
    role = nextRole;
    token = create ? hex(24) : localStorage.getItem(tokenKey(code, role)) || hex(24);
    say("Le portail s’ouvre…");
    try {
      const data = await exchange({ p_create: create });
      hostRole = data.host_role;
      version = Number(data.version || 0);
      ready = Boolean(data.ready);
      localStorage.setItem(tokenKey(code, role), token);
      sessionStorage.setItem("donjon-session", JSON.stringify({ code, role }));
      roomInput.value = code;
      lobby.querySelectorAll("[data-donjon-role]").forEach(button => button.classList.toggle("selected", button.dataset.donjonRole === role));
      if (isHost() && data.snapshot && Object.keys(data.snapshot).length) engine.apply(data.snapshot, true);
      else if (isHost()) await push();
      else handle(data);
      clearInterval(pollTimer);
      pollTimer = setInterval(() => void poll(), 1200);
      refreshLobby();
      return true;
    } catch (error) {
      fail(error);
      code = old.code;
      role = old.role;
      token = old.token;
      return false;
    } finally {
      busy = false;
    }
  }
  async function create() {
    const selected = lobby.querySelector("[data-donjon-role].selected")?.dataset.donjonRole;
    if (!selected) { say("Choisis ton héros : A ou C.", true); return; }
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await connect(newCode(), selected, true)) return;
      if (!status.textContent.includes("Code déjà pris")) return;
    }
  }
  async function join() {
    const selected = lobby.querySelector("[data-donjon-role].selected")?.dataset.donjonRole;
    if (!selected) { say("Choisis ton héros : A ou C.", true); return; }
    await connect(roomInput.value, selected, false);
  }
  async function push(clearActionId = null) {
    if (!isHost() || !code) return;
    if (pushing) {
      dirty = true;
      if (clearActionId) { await pushIdle; return push(clearActionId); }
      return;
    }
    pushing = true;
    let resolveIdle;
    pushIdle = new Promise(resolve => { resolveIdle = resolve; });
    dirty = false;
    try {
      const snapshot = engine.capture();
      const data = await exchange({ p_expected_version: version, p_snapshot: snapshot, p_clear_action_id: clearActionId });
      handle(data);
    } catch (error) {
      fail(error);
      if (String(error.message).includes("stale_version")) {
        const data = await exchange();
        version = Number(data.version);
      }
      dirty = true;
    } finally {
      pushing = false;
      resolveIdle();
      if (dirty) schedulePush();
    }
  }
  function schedulePush() {
    if (!isHost() || actionInProgress || !code) return;
    dirty = true;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void push(), 170);
  }
  function descriptor(target) {
    if (target.id === "restart") return { id: hex(8), control: "restart" };
    return { id: hex(8), data: Object.fromEntries(Object.entries(target.dataset).filter(([key]) => ["action", "door", "weapon", "weaponPlayer", "choice", "value", "owner", "shop", "item"].includes(key))) };
  }
  function findTarget(action) {
    if (action.control === "restart") return $("restart");
    const entries = Object.entries(action.data || {});
    if (!entries.length) return null;
    return [...document.querySelectorAll("#setup button,#game button")].find(button => entries.every(([key, value]) => button.dataset[key] === value)) || null;
  }
  async function executeRemote(action) {
    actionInProgress = true;
    try {
      const target = findTarget(action);
      const otherRole = role === "J1" ? "J2" : "J1";
      if (target && !target.disabled && engine.canAct(otherRole, target) && ready) {
        if (engine.pairAction(target)) {
          engine.markReady(otherRole);
          if (engine.bothReady()) {
            engine.clearReady();
            remoteDispatch = true;
            try { target.click(); } finally { remoteDispatch = false; }
          }
        } else {
          remoteDispatch = true;
          try { target.click(); } finally { remoteDispatch = false; }
        }
      }
      clearTimeout(pushTimer);
      await push(action.id);
    } finally {
      actionInProgress = false;
      if (dirty) schedulePush();
    }
  }
  async function sendAction(target) {
    if (busy) return;
    busy = true;
    say("Action envoyée…");
    try {
      const data = await exchange({ p_action: descriptor(target) });
      handle(data);
    } catch (error) { fail(error); }
    finally { busy = false; }
  }
  async function poll() {
    if (!code || polling) return;
    polling = true;
    try { handle(await exchange()); }
    catch (error) { fail(error); ready = false; refreshLobby(); }
    finally { polling = false; }
  }
  document.addEventListener("click", event => {
    const target = event.target.closest("#restart,#setup button,#game button");
    if (!target || remoteDispatch) return;
    if (!code || !ready || !engine.canAct(role, target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      say(!ready ? "Attends l’autre héros." : "C’est à l’autre de jouer.");
      return;
    }
    if (isHost() && engine.pairAction(target)) {
      engine.markReady(role);
      if (!engine.bothReady()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        say("Prêt ! L’autre héros lance son dé à son tour.");
        refreshLobby();
        schedulePush();
        return;
      }
      engine.clearReady();
    }
    if (!isHost() && target.matches('.door[data-door]') && window.donjonHandleDoorTap) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.donjonHandleDoorTap(target);
      return;
    }
    if (!isHost()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void sendAction(target);
    }
  }, true);

  lobby.querySelectorAll("[data-donjon-role]").forEach(button => button.addEventListener("click", () => {
    lobby.querySelectorAll("[data-donjon-role]").forEach(item => item.classList.toggle("selected", item === button));
    say(button.dataset.donjonRole === "J1" ? "A choisi." : "C choisi.");
  }));
  $("donjonCreate").addEventListener("click", () => void create());
  $("donjonJoin").addEventListener("click", () => void join());
  roomInput.addEventListener("keydown", event => { if (event.key === "Enter") void join(); });
  $("donjonCopy").addEventListener("click", async () => {
    const url = new URL(location.href);
    url.searchParams.set("room", code);
    try { await navigator.clipboard.writeText(url.href); say("Lien copié. Envoie-le à l’autre héros."); }
    catch { say(`Donne-lui le code ${code}.`); }
  });
  window.donjonLive = {
    start(callbacks) {
      engine = callbacks;
      const observer = new MutationObserver(records => {
        if (records.every(record => {
          const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
          return element?.closest?.("#challengeTimer,#challengeClock,.enemy-art");
        })) return;
        schedulePush();
      });
      observer.observe($("setup"), { subtree: true, childList: true, attributes: true, characterData: true });
      observer.observe($("game"), { subtree: true, childList: true, attributes: true, characterData: true });
      observer.observe($("restart"), { attributes: true });
      const saved = JSON.parse(sessionStorage.getItem("donjon-session") || "null");
      const invited = new URLSearchParams(location.search).get("room")?.toUpperCase();
      if (invited) roomInput.value = invited;
      if (saved && (!invited || invited === saved.code) && saved.code && saved.role) {
        lobby.querySelector(`[data-donjon-role="${saved.role}"]`)?.click();
        void connect(saved.code, saved.role, false);
      }
    },
    get role() { return role; },
    get hostRole() { return hostRole; },
    get ready() { return ready; },
    get isHost() { return isHost(); }
  };
})();
