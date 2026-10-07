'use strict';

/* ================== Облачная база: вход через Google + Firestore ==================
   Каждая запись хранится отдельным документом: stores/main/{customers|games|sales|expenses}/{id}.
   При save() отправляются только изменённые и удалённые записи, поэтому правки
   с телефона и компьютера не затирают друг друга. Кто может читать и писать,
   решают правила Firestore (firestore.rules), а не этот код. */

const Cloud = (() => {
  const SDK_VERSION = '12.19.0';
  const COLS = ['customers', 'games', 'sales', 'expenses'];
  const LOCAL_BACKUP_KEY = 'gamesteek-db-v1-before-cloud';
  const cfg = window.FIREBASE_CONFIG;
  const enabled = !!(cfg && cfg.apiKey);

  let fs = null, store = null, user = null;
  let synced = null; // { коллекция: Map(id -> JSON записи в облаке) }
  let unsubscribe = [];

  const $ = id => document.getElementById(id);
  // Ключи сортируем, чтобы порядок полей из Firestore не считался изменением
  const canon = o => JSON.stringify(o, Object.keys(o).sort());

  /* ---------- Экран входа и статус ---------- */

  function showGate(mode, message = '') {
    document.body.classList.add('gated');
    $('auth').hidden = false;
    $('auth-text').textContent = message || {
      loading: 'Загрузка…',
      login: 'Войдите, чтобы открыть базу',
      denied: `У аккаунта ${user?.email || ''} нет доступа к этой базе`,
    }[mode] || '';
    $('auth-login').hidden = mode !== 'login';
    $('auth-logout').hidden = mode !== 'denied';
    $('auth-retry').hidden = mode !== 'error';
  }

  function hideGate() {
    $('auth').hidden = true;
    document.body.classList.remove('gated');
  }

  function setStatus(state) {
    const el = $('sync');
    const map = {
      ok: ['● Синхронизировано', 'ok'],
      saving: ['● Сохраняется…', 'saving'],
      offline: ['● Офлайн — сохранится позже', 'offline'],
      error: ['● Ошибка синхронизации', 'error'],
    };
    const [text, cls] = map[state] || ['', ''];
    el.textContent = text;
    el.className = 'sync ' + cls;
    el.hidden = !text;
  }

  function renderCard() {
    const on = enabled && user && synced;
    $('storage-text').textContent = on
      ? 'Данные хранятся в облаке Google (Firebase) и одинаковы на всех устройствах, где вы вошли. Резервная копия всё равно не помешает.'
      : 'Все записи сохраняются в этом браузере (localStorage). Если открыть сайт с другого устройства или очистить данные браузера — база будет пустой. Регулярно делайте резервную копию.';
    $('cloud-status').innerHTML = !enabled
      ? 'Не настроена. Сейчас у каждого устройства своя база. Инструкция по включению — в файле README.md репозитория.'
      : on ? `Включена. Вы вошли как <b>${esc(user.email)}</b>.` : 'Включена, вход не выполнен.';
    $('cloud-logout').hidden = !on;
  }

  /* ---------- Запуск ---------- */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('не удалось загрузить ' + src));
      document.head.append(s);
    });
  }

  async function init() {
    renderCard();
    if (!enabled) return;
    showGate('loading');
    try {
      if (!window.firebase) {
        for (const m of ['app', 'auth', 'firestore']) {
          await loadScript(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-${m}-compat.js`);
        }
      }
    } catch (e) {
      showGate('error', 'Нет связи с сервером Google. Проверьте интернет и обновите страницу.');
      return;
    }
    firebase.initializeApp(cfg);
    fs = firebase.firestore();
    // Офлайн-кэш: база открывается и правится без интернета, изменения уйдут при появлении связи
    try { await fs.enablePersistence({ synchronizeTabs: true }); } catch (e) { console.warn('Офлайн-режим недоступен', e); }
    store = fs.collection('stores').doc('main');
    firebase.auth().onAuthStateChanged(onAuth);
  }

  async function onAuth(u) {
    unsubscribe.forEach(f => f());
    unsubscribe = [];
    synced = null;
    user = u;
    renderCard();
    if (!u) { setStatus(''); showGate('login'); return; }

    showGate('loading', 'Загружаем базу…');
    try {
      const snaps = await Promise.all(COLS.map(c => store.collection(c).get()));
      const cloudEmpty = snaps.every(s => s.empty);
      const localCount = COLS.reduce((a, c) => a + db[c].length, 0);
      synced = {};
      COLS.forEach((c, i) => { synced[c] = new Map(snaps[i].docs.map(d => [d.id, canon(d.data())])); });

      hideGate();
      if (cloudEmpty && localCount &&
          confirm(`В облаке пока пусто. Загрузить туда данные с этого устройства (${localCount} записей)?`)) {
        push();
        toast('Данные загружены в облако');
      } else {
        // Локальная база этого устройства заменяется облачной — сохраним её копию на всякий случай
        if (localCount && !localStorage.getItem(LOCAL_BACKUP_KEY)) {
          try { localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(db)); } catch {}
        }
        COLS.forEach((c, i) => { db[c] = snaps[i].docs.map(d => d.data()); });
        persistLocal();
      }
      render();
      renderCard();
      listen();
      setStatus(navigator.onLine ? 'ok' : 'offline');
    } catch (e) {
      console.error(e);
      if (e.code === 'permission-denied') showGate('denied');
      else showGate('error', 'Ошибка загрузки базы: ' + e.message);
    }
  }

  function listen() {
    unsubscribe = COLS.map(c => store.collection(c).onSnapshot({ includeMetadataChanges: true }, snap => {
      db[c] = snap.docs.map(d => d.data());
      synced[c] = new Map(snap.docs.map(d => [d.id, canon(d.data())]));
      persistLocal();
      if (!snap.metadata.hasPendingWrites || snap.docChanges().length) render();
      setStatus(snap.metadata.hasPendingWrites ? (navigator.onLine ? 'saving' : 'offline') : snap.metadata.fromCache && !navigator.onLine ? 'offline' : 'ok');
    }, err => {
      console.error(err);
      setStatus('error');
      if (err.code === 'permission-denied') showGate('denied');
    }));
  }

  function persistLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch {}
  }

  /* ---------- Отправка изменений ---------- */

  function push() {
    if (!synced || !store) return;
    const ops = [];
    COLS.forEach(c => {
      const seen = new Set();
      db[c].forEach(r => {
        seen.add(r.id);
        const clean = JSON.parse(JSON.stringify(r)); // Firestore не принимает undefined
        const json = canon(clean);
        if (synced[c].get(r.id) !== json) { ops.push({ c, id: r.id, data: clean }); synced[c].set(r.id, json); }
      });
      [...synced[c].keys()].forEach(id => {
        if (!seen.has(id)) { ops.push({ c, id, del: true }); synced[c].delete(id); }
      });
    });
    // В одном пакете Firestore не больше 500 операций
    for (let i = 0; i < ops.length; i += 450) {
      const batch = fs.batch();
      ops.slice(i, i + 450).forEach(op => {
        const ref = store.collection(op.c).doc(op.id);
        op.del ? batch.delete(ref) : batch.set(ref, op.data);
      });
      batch.commit().catch(e => {
        console.error(e);
        setStatus('error');
        toast('Не удалось сохранить в облако: ' + e.message);
      });
    }
  }

  /* ---------- Кнопки ---------- */

  async function login() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await firebase.auth().signInWithPopup(provider);
    } catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        await firebase.auth().signInWithRedirect(provider);
      } else if (e.code === 'auth/unauthorized-domain') {
        showGate('login', `Домен ${location.hostname} не добавлен в Firebase: Authentication → Settings → Authorized domains.`);
      } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        showGate('login', 'Не удалось войти: ' + e.message);
      }
    }
  }

  async function logout() {
    if (!confirm('Выйти из аккаунта? Данные останутся в облаке, с этого устройства они будут скрыты до следующего входа.')) return;
    unsubscribe.forEach(f => f());
    unsubscribe = [];
    synced = null;
    // Не оставляем копию базы на устройстве после выхода
    db = emptyDb();
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    render();
    try { await fs.terminate(); await fs.clearPersistence(); } catch (e) { console.warn(e); }
    await firebase.auth().signOut();
    location.reload();
  }

  $('auth-login').addEventListener('click', login);
  $('auth-logout').addEventListener('click', () => firebase.auth().signOut());
  $('auth-retry').addEventListener('click', () => location.reload());
  $('cloud-logout').addEventListener('click', logout);
  addEventListener('online', () => synced && setStatus('ok'));
  addEventListener('offline', () => synced && setStatus('offline'));

  init();
  return { push, get active() { return !!synced; } };
})();
