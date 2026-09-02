/* =====================================================================
 * 单词短文 · 把今天的词串成故事  (PWA)
 * 上传学习截图 → 可配置的多模态大模型识图提取单词 → 生成英文短文+中文翻译
 * ===================================================================== */
(function () {
  'use strict';

  const STORE_KEY = 'cet4essay_cfg_v1';
  const HIST_KEY = 'cet4essay_hist_v1';
  const MARK_KEY = 'cet4essay_mark_v1';
  const WORDS_KEY = 'cet4essay_words_v1';
  const BANK_KEY = 'cet4essay_bank_v1';

  /* ---------- Supabase（账号 + 云同步） ---------- */
  const SUPABASE_URL = 'https://khdkhvujzdndjsspakos.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_oWXxOuDkNppn43Ld5KDKRQ_z_knOwdC';
  let supabase = null;
  let session = null;
  let authUserId = null;
  if (typeof window !== 'undefined' && typeof window.supabase !== 'undefined') {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  /* ---------- 当天识别的词（供短文用） ---------- */
  let todayWords = loadWords();
  function loadWords() {
    try { return JSON.parse(localStorage.getItem(WORDS_KEY) || '[]'); } catch (e) { /* ignore */ }
    return [];
  }
  function saveWords(w) {
    try { localStorage.setItem(WORDS_KEY, JSON.stringify(w)); } catch (e) { /* ignore */ }
  }

  /* ---------- 词库（词+释义+记忆状态，供复习/游戏用） ---------- */
  let wordBank = loadWordBank();
  function loadWordBank() {
    try {
      const arr = JSON.parse(localStorage.getItem(BANK_KEY) || '[]');
      return arr.map((it) => (typeof it === 'string'
        ? { word: it, meaning: '', addedAt: Date.now(), state: { ivl: 0, ease: 2.5, due: 0, reps: 0, lapses: 0 } }
        : it));
    } catch (e) { /* ignore */ }
    return [];
  }
  function saveWordBank() {
    try { localStorage.setItem(BANK_KEY, JSON.stringify(wordBank)); } catch (e) { /* ignore */ }
  }
  function findWord(w) {
    return wordBank.find((x) => x.word === w);
  }

  /* ---------- 手动标红的生词集合（持久化） ---------- */
  let markedWords = loadMarked();
  function loadMarked() {
    try {
      const raw = localStorage.getItem(MARK_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return new Set();
  }
  function saveMarked() {
    try { localStorage.setItem(MARK_KEY, JSON.stringify(Array.from(markedWords))); } catch (e) { /* ignore */ }
  }

  /* ---------- 预设模型模板（两套：识图 vision + 写文 write） ---------- */
  const PRESETS = {
    vision: {
      glm: { baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash' },
      deepseek: { baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-flash-vision-exp' },
      doubao: { baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-0-lite-260215' }
    },
    write: {
      deepseek: { baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' },
      glm: { baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' }
    }
  };

  // 本地种子配置（js/config.js 由用户本地提供，含 key，不入库）
  const seed = (typeof window !== 'undefined' && window.CONFIG_SEED) || {};

  const DEFAULTS = {
    vision: {
      baseURL: PRESETS.vision.glm.baseURL,
      model: PRESETS.vision.glm.model,
      key: seed.visionKey || ''
    },
    write: {
      baseURL: PRESETS.write.deepseek.baseURL,
      model: PRESETS.write.deepseek.model,
      key: seed.writeKey || ''
    }
  };

  let cfg = load();

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);

  /* ---------- 配置读写 ---------- */
  function load() {
    const base = {
      vision: Object.assign({}, DEFAULTS.vision),
      write: Object.assign({}, DEFAULTS.write)
    };
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.baseURL !== undefined) {
          // 旧版平铺结构 → 迁移为 vision 配置
          base.vision = { baseURL: s.baseURL, model: s.model, key: s.key || base.vision.key };
          base.write = { baseURL: DEFAULTS.write.baseURL, model: DEFAULTS.write.model, key: s.key || base.write.key };
        } else {
          if (s.vision) base.vision = Object.assign({}, base.vision, s.vision);
          if (s.write) base.write = Object.assign({}, base.write, s.write);
        }
      }
    } catch (e) { /* ignore */ }
    return base;
  }
  function saveCfg() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }

  /* ---------- 视图 ---------- */
  let currentImages = [];   // dataURI 数组（支持多张截图）

  const VIEWS = ['view-workbench', 'view-identify', 'view-essay', 'view-game', 'view-words'];
  function showView(name) {
    VIEWS.forEach((v) => $(v).classList.toggle('hidden', v !== name));
    $('view-auth').classList.add('hidden');
    $('btn-back').classList.toggle('hidden', name === 'view-workbench');
    if (name === 'view-words') renderBank();
    if (name === 'view-essay') updateEssayInput();
    if (name === 'view-identify') { renderWordPool(); refreshIdentifyBtn(); }
    if (name === 'view-game') resetBattle();
    else stopBgm();
    window.scrollTo(0, 0);
  }
  function gotoCard(name) {
    if (name === 'identify' || name === 'essay' || name === 'game' || name === 'words') {
      showView('view-' + name);
    } else if (name === 'history') {
      openHistory();
    } else if (name === 'settings') {
      openSettings();
    }
  }

  /* ---------- 主题 ---------- */
  const THEME_KEY = 'cet4essay_theme_v1';
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = $('btn-theme');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0e0a18' : '#f5f7fa');
  }
  function loadTheme() {
    let t = 'light';
    try { t = localStorage.getItem(THEME_KEY) || 'light'; } catch (e) { /* ignore */ }
    applyTheme(t);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
  }

  /* ---------- 账号（Supabase） ---------- */
  function showAuth() {
    VIEWS.forEach((v) => $(v).classList.add('hidden'));
    $('view-auth').classList.remove('hidden');
    $('btn-back').classList.add('hidden');
    window.scrollTo(0, 0);
  }
  function authStatus(msg, isErr) {
    const el = $('auth-status');
    el.classList.remove('hidden');
    el.classList.toggle('error', !!isErr);
    el.textContent = msg;
  }
  async function doLogin() {
    if (!supabase) { authStatus('加载失败，请刷新重试', true); return; }
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    if (!email || !password) { authStatus('请填邮箱和密码', true); return; }
    authStatus('登录中…');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { authStatus('登录失败：' + (error.message || '账号或密码错误'), true); return; }
    session = data.session;
    authUserId = data.user.id;
    authStatus('登录成功，正在同步数据…');
    await syncFromCloud();
    enterApp();
  }
  async function doSignup() {
    if (!supabase) { authStatus('加载失败，请刷新重试', true); return; }
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    if (!email || !password) { authStatus('请填邮箱和密码', true); return; }
    if (password.length < 6) { authStatus('密码至少 6 位', true); return; }
    authStatus('注册中…');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { authStatus('注册失败：' + (error.message || '邮箱可能已注册'), true); return; }
    if (data.user && data.session) {
      session = data.session;
      authUserId = data.user.id;
      authStatus('注册成功，进入…');
      await enterApp();
    } else {
      authStatus('注册成功！请去邮箱点确认链接后再登录', false);
      $('btn-auth-login').textContent = '返回登录';
    }
  }
  function skipAuth() {
    authStatus('未登录，数据只存本机', false);
    setTimeout(() => enterApp(), 300);
  }

  function updateAuthInfo() {
    const el = $('auth-info');
    if (!el) return;
    el.textContent = (session && session.user && session.user.email) ? '已登录：' + session.user.email : '未登录（数据只存本机）';
  }
  async function doLogout() {
    if (supabase) { try { await supabase.auth.signOut(); } catch (e) { /* ignore */ } }
    session = null;
    authUserId = null;
    closeSettings();
    showAuth();
  }

  // 从云端拉取词库和历史，替换本地
  async function syncFromCloud() {
    if (!supabase || !authUserId) return;
    try {
      const { data: words, error: e1 } = await supabase.from('words').select('*');
      if (!e1 && words) {
        wordBank = words.map((r) => ({ word: r.word, meaning: r.meaning, state: r.state, addedAt: new Date(r.added_at).getTime(), _id: r.id }));
        saveWordBank();
        todayWords = words.map((r) => r.word);
        saveWords(todayWords);
      }
      const { data: essays, error: e2 } = await supabase.from('essays').select('*').order('created_at', { ascending: false }).limit(30);
      if (!e2 && essays) {
        const list = essays.map((r) => ({ date: r.created_at, words: r.words_line, segments: r.segments }));
        localStorage.setItem(HIST_KEY, JSON.stringify(list));
      }
    } catch (e) { /* ignore */ }
  }

  function enterApp() {
    renderWordPool();
    updateEssayInput();
    renderBank();
    showView('view-workbench');
  }

  async function init() {
    loadTheme();
    bind();
    loadHistory();
    syncCfgToUI();
    renderWordPool();
    updateEssayInput();
    renderBank();
    refreshIdentifyBtn();

    // 检查登录态
    if (supabase) {
      try {
        const { data } = await supabase.auth.getSession();
        if (data && data.session) {
          session = data.session;
          authUserId = data.session.user.id;
          showView('view-workbench');
          return;
        }
      } catch (e) { /* ignore */ }
    }
    // 未登录 → 登录页
    showAuth();
  }

  function syncCfgToUI() {
    $('cfg-vision-baseurl').value = cfg.vision.baseURL;
    $('cfg-vision-model').value = cfg.vision.model;
    $('cfg-vision-key').value = cfg.vision.key;
    $('cfg-write-baseurl').value = cfg.write.baseURL;
    $('cfg-write-model').value = cfg.write.model;
    $('cfg-write-key').value = cfg.write.key;
  }

  /* ---------- 图片处理 ---------- */
  // 压缩图片：多张截图直接传会让视觉 token 超限报 400，压缩到最长边 maxW 大幅降低 token
  function compressImage(dataURI, maxW, quality) {
    maxW = maxW || 800;
    quality = quality || 0.8;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.width, h = img.height;
        if (w <= maxW && h <= maxW) { resolve(dataURI); return; }
        const scale = maxW / Math.max(w, h);
        const nw = Math.round(w * scale), nh = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = nw; canvas.height = nh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, nw, nh);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(dataURI);
      img.src = dataURI;
    });
  }

  function handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) => /^image\//.test(f.type));
    if (!files.length) { alert('请选择图片'); return; }
    Promise.all(files.map((f) => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => compressImage(r.result).then(res, () => res(r.result));
      r.onerror = rej;
      r.readAsDataURL(f);
    }))).then((uris) => {
      currentImages = currentImages.concat(uris);
      renderPreview();
      $('file-input').value = '';
    }).catch(() => alert('读取图片失败'));
  }

  function renderPreview() {
    if (!currentImages.length) {
      $('preview-box').classList.add('hidden');
      $('upload-zone').classList.remove('hidden');
      refreshIdentifyBtn();
      return;
    }
    $('preview-box').classList.remove('hidden');
    $('upload-zone').classList.add('hidden');
    const grid = $('preview-grid');
    grid.innerHTML = '';
    currentImages.forEach((src, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'thumb-wrap';
      const img = document.createElement('img');
      img.src = src;
      img.className = 'thumb';
      const del = document.createElement('button');
      del.className = 'thumb-del';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        currentImages.splice(idx, 1);
        renderPreview();
      });
      wrap.appendChild(img);
      wrap.appendChild(del);
      grid.appendChild(wrap);
    });
    $('upload-text').textContent = '已选 ' + currentImages.length + ' 张，可继续添加或点「清空重选」';
    refreshIdentifyBtn();
  }

  function refreshGenerateBtn() {
    // 生成短文按钮：有词库 + 写文模型即可
    $('btn-generate').disabled = !(todayWords.length && cfg.write.key);
  }
  function refreshIdentifyBtn() {
    // 识词按钮：有截图 + 识图模型即可
    $('btn-identify').disabled = !(currentImages.length && cfg.vision.key);
  }

  /* ---------- 生成短文 ---------- */
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // 单词清单解析 → 用于渲染时兜底高亮
  function parseWordList(line) {
    if (!line) return [];
    return line.split(/[,，、;；]+/).map((s) => s.replace(/[*\s]+/g, '').trim()).filter(Boolean);
  }
  // 生成一个单词的常见屈折形式（用于匹配短文里的变形词）
  function inflect(word) {
    const w = word.toLowerCase();
    const set = new Set([w, w + 's', w + 'es', w + 'ed', w + 'd', w + 'ing']);
    if (w.endsWith('e')) {
      set.add(w.slice(0, -1) + 'ing');   // diagnose -> diagnosing
      set.add(w + 's');
    } else {
      set.add(w + 's');
      if (/([^aeiou])y$/.test(w)) { set.add(w.slice(0, -1) + 'ies'); set.add(w.slice(0, -1) + 'ied'); }
    }
    set.add(w + 'ly');
    return set;
  }
  function buildHighlightSet(words) {
    const set = new Set();
    words.forEach((w) => {
      const ww = w.toLowerCase();
      if (ww.length <= 2) return; // 跳过过短词，避免误伤
      inflect(ww).forEach((f) => set.add(f));
    });
    return set;
  }

  // 把短文渲染成 DOM：目标词(**word**)高亮加粗、所有英文单词可点击查词
  // highlightSet：兜底高亮集合（清单里的词及其屈折形式），即使模型漏加粗也补标
  function renderEssayDOM(text, highlightSet) {
    highlightSet = highlightSet || new Set();
    const frag = document.createDocumentFragment();
    const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)|([A-Za-z][A-Za-z'-]*)/g;
    let last = 0, m;
    while ((m = pattern.exec(text)) !== null) {
      if (m.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      if (m[1]) {
        // 目标词 → 高亮加粗（若已被手动标红则红色优先）
        const word = m[1].replace(/\*/g, '');
        const b = document.createElement('b');
        b.className = 'e-word ' + (markedWords.has(word.toLowerCase()) ? 'marked' : 'target');
        b.dataset.word = word;
        b.textContent = word;
        frag.appendChild(b);
      } else if (m[2]) {
        // 普通英文单词 → 可点击查词；命中目标词集合则高亮；已标红则红色优先
        const word = m[2];
        const marked = markedWords.has(word.toLowerCase());
        const isTarget = highlightSet.has(word.toLowerCase());
        const span = document.createElement('span');
        span.className = 'e-word' + (marked ? ' marked' : (isTarget ? ' target' : ''));
        span.dataset.word = word;
        span.textContent = word;
        frag.appendChild(span);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      frag.appendChild(document.createTextNode(text.slice(last)));
    }
    return frag;
  }
  // 历史摘要用：仅高亮加粗，不做点击查词
  function renderHighlightHtml(s) {
    return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }

  // 识图用 prompt：只提取单词清单
  const VISION_PROMPT = [
    '你是英语老师。请仔细识别图片中所有「正在学习的英文单词或词组」，忽略界面按钮、中文释义、菜单提示等非学习内容，只提取用户要背的英文单词本身，并还原原形（如 studies→study、diagnosed→diagnose）。',
    '只输出一份单词清单，词与词之间用英文逗号分隔，不要任何解释、不要编号、不要多余内容。']
    .join('\n');

  // 写短文用 prompt：根据清单生成短文
  function writeEssayPrompt(words) {
    return [
      '你是经验丰富的大学英语四级教师。请用下面这些英文单词写一篇【简短】的英文短文：',
      words,
      '',
      '要求：',
      '1. 总词数严格控制在 120~150 词，分成 3 个左右自然段，段与段之间用空行隔开。',
      '2. 尽量自然地多用上这些目标单词（不必强行每一个都用上），每个用到的目标单词都用 **两个星号** 加粗包起来，保持原形不要变形。',
      '3. 内容简洁连贯、贴合四级水平；除目标词之外，其它词汇一律用最简单常见的四级词，严禁生僻词、学术术语、文学性生词。',
      '4. 只输出英文短文，不要输出中文翻译、不要解释。'
    ].join('\n');
  }

  // 第一步：识图，提取单词清单
  async function callVision() {
    const url = cfg.vision.baseURL.replace(/\/+$/, '') + '/chat/completions';
    const content = currentImages.map((uri) => ({ type: 'image_url', image_url: { url: uri } }));
    content.push({ type: 'text', text: VISION_PROMPT });
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.vision.key },
      body: JSON.stringify({ model: cfg.vision.model, messages: [{ role: 'user', content }], temperature: 0.3, max_tokens: 800 })
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error('识图失败(' + resp.status + ')：' + t.slice(0, 150));
    }
    const data = await resp.json();
    const txt = (data.choices && data.choices[0].message && data.choices[0].message.content) || '';
    if (!txt.trim()) throw new Error('识图模型没返回单词');
    return txt.trim();
  }

  // 第二步：写短文
  async function callWrite(prompt) {
    const url = cfg.write.baseURL.replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.write.key },
      body: JSON.stringify({ model: cfg.write.model, messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 1500 })
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error('写文失败(' + resp.status + ')：' + t.slice(0, 150));
    }
    const data = await resp.json();
    return (data.choices && data.choices[0].message && data.choices[0].message.content) || '';
  }

  async function generate() {
    if (!todayWords.length) { alert('词库还是空的，先去「六眼 · 识词」上传截图录入单词'); return; }
    if (!cfg.write.key || !cfg.write.baseURL || !cfg.write.model) { openSettings(); alert('请先在设置里填好「写文模型」的 key'); return; }

    const status = $('gen-status');
    status.classList.remove('hidden');
    status.classList.remove('error');
    $('btn-generate').disabled = true;

    try {
      status.textContent = '正在根据词库生成短文…';
      const wordsLine = todayWords.join(', ');
      const essay = await callWrite(writeEssayPrompt(wordsLine));
      if (!essay.trim()) throw new Error('写文模型没返回短文');

      renderResult(wordsLine, essay);
      status.classList.add('hidden');
    } catch (e) {
      status.classList.add('error');
      status.textContent = '出错：' + e.message + '\n（可到设置里检查 key / 模型）';
    } finally {
      refreshGenerateBtn();
    }
  }

  // 识词：截图 → 识图 → 存词库
  // 批量查中文释义（一次调用，返回 { word: 释义 }）
  async function fetchMeanings(words) {
    if (!words.length) return {};
    const model = cfg.write.model;
    const prompt = '请给下面每个英文单词一个中文释义（最多3个常用义项，用分号隔开）。严格按"单词=释义"每行一个的格式输出，不要任何多余内容：\n' + words.join(', ');
    const url = cfg.write.baseURL.replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.write.key },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 800 })
    });
    if (!resp.ok) throw new Error('查释义失败(' + resp.status + ')');
    const data = await resp.json();
    const content = (data.choices && data.choices[0].message && data.choices[0].message.content) || '';
    const map = {};
    content.split('\n').forEach((line) => {
      const m = line.match(/^\s*([A-Za-z][A-Za-z\-'\s]*?)\s*[=＝:：]\s*(.+)\s*$/);
      if (m) map[m[1].trim().toLowerCase()] = m[2].trim();
    });
    return map;
  }

  // 遗忘曲线调度：答对 → 间隔拉长，答错 → 重置（简化 SM-2）
  function scheduleReview(w, correct) {
    const s = w.state || { ivl: 0, ease: 2.5, due: 0, reps: 0, lapses: 0 };
    if (correct) {
      s.reps = (s.reps || 0) + 1;
      s.lapses = 0;
      s.ease = Math.min(3.0, (s.ease || 2.5) + 0.1);
      s.ivl = s.ivl === 0 ? 1 : Math.round(s.ivl * s.ease);
    } else {
      s.reps = 0;
      s.lapses = (s.lapses || 0) + 1;
      s.ease = Math.max(1.3, (s.ease || 2.5) - 0.2);
      s.ivl = 0;
    }
    s.due = Date.now() + s.ivl * 86400000;
    w.state = s;
    return w;
  }

  /* ============ 音效（Web Audio 合成） ============ */
  let audioCtx = null;
  let soundEnabled = true;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  function beep(freq, dur, type, gain, when) {
    if (!soundEnabled || !audioCtx) return;
    const t = when || audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }
  function sfxHit() {         // 命中
    beep(880, 0.08, 'square', 0.25); beep(1320, 0.12, 'square', 0.2, audioCtx.currentTime + 0.03);
  }
  function sfxMiss() {        // 答错
    beep(200, 0.25, 'sawtooth', 0.22); beep(140, 0.3, 'sawtooth', 0.2, audioCtx.currentTime + 0.05);
  }
  function sfxCast() {        // 蓄力
    beep(300, 0.2, 'sawtooth', 0.15); beep(500, 0.25, 'sawtooth', 0.15, audioCtx.currentTime + 0.1);
  }
  function sfxUpgrade() {     // 术式升级
    beep(660, 0.1, 'square', 0.22); beep(880, 0.1, 'square', 0.22, audioCtx.currentTime + 0.07); beep(1100, 0.14, 'square', 0.24, audioCtx.currentTime + 0.14);
  }
  function sfxVoid() {        // 无量空处
    beep(520, 0.6, 'sine', 0.25); beep(780, 0.6, 'sine', 0.2, audioCtx.currentTime + 0.1); beep(1040, 0.6, 'sine', 0.18, audioCtx.currentTime + 0.2);
  }
  function sfxWin() {         // 胜利
    [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.16, 'square', 0.24, audioCtx.currentTime + i * 0.12));
  }
  function sfxLose() {        // 失败
    [392, 330, 262, 196].forEach((f, i) => beep(f, 0.22, 'sawtooth', 0.2, audioCtx.currentTime + i * 0.15));
  }

  /* ---------- 背景音乐（合成循环氛围乐） ---------- */
  let bgmTimer = null;
  let bgmOn = false;
  function bgmTick() {
    if (!bgmOn || !audioCtx) return;
    const t = audioCtx.currentTime;
    // 低沉的持续低音底（咒术回战的压抑氛围）
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 110;
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 1.4);
    // 每 4 拍一个高一点的音
    bgmTimer = setTimeout(() => {
      const o2 = audioCtx.createOscillator();
      const g2 = audioCtx.createGain();
      o2.type = 'sine';
      o2.frequency.value = 220;
      g2.gain.setValueAtTime(0.04, audioCtx.currentTime);
      g2.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.8);
      o2.connect(g2); g2.connect(audioCtx.destination);
      o2.start(); o2.stop(audioCtx.currentTime + 0.8);
      bgmTimer = setTimeout(bgmTick, 1000);
    }, 700);
  }
  function startBgm() {
    ensureAudio();
    if (!bgmOn) { bgmOn = true; bgmTick(); }
  }
  function stopBgm() { bgmOn = false; if (bgmTimer) clearTimeout(bgmTimer); }

  /* ============ 新宿决战 游戏 ============ */
  const TECHNIQUES = [
    { name: '苍', combo: 0, damage: 15 },
    { name: '赫', combo: 3, damage: 25 },
    { name: '茈', combo: 6, damage: 40 },
    { name: '无量空处', combo: 10, damage: 100 }
  ];
  const DIALOGUES = {
    cast: ['五条悟：术式顺转「苍」！', '五条悟：术式反转「赫」！', '五条悟：虚式「茈」！', '五条悟：领域展开——无量空处！'],
    hit: ['五条悟：就这？', '五条悟：还不够啊。', '五条悟：再让我刷会帅。', '宿傩：有意思…'],
    miss: ['宿傩：太慢了。', '宿傩：就这点本事？', '五条悟：啧，分心了。'],
    win: ['五条悟：你已经成长到这种地步了，老师为你骄傲。', '五条悟：赢了，就这水平？'],
    lose: ['宿傩：就你这点咒力，也敢挑战我？', '宿傩：太弱了。']
  };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  let battle = { playerHp: 100, enemyHp: 100, combo: 0, techIdx: 0, ended: false };

  function currentTech() {
    let idx = 0;
    for (let i = 0; i < TECHNIQUES.length; i++) {
      if (battle.combo >= TECHNIQUES[i].combo) idx = i;
    }
    return TECHNIQUES[idx];
  }

  function resetBattle() {
    battle = { playerHp: 100, enemyHp: 100, combo: 0, techIdx: 0, ended: false };
    renderBattle();
    $('battle-result').classList.add('hidden');
    $('battle-quiz').classList.add('hidden');
    $('btn-attack').classList.remove('hidden');
    setDialogue('五条悟：我的学生都在看着呢，可别丢人啊。');
    if (soundEnabled) startBgm();
  }

  function renderBattle() {
    $('hp-player').style.width = battle.playerHp + '%';
    $('hp-player-num').textContent = battle.playerHp;
    $('hp-enemy').style.width = battle.enemyHp + '%';
    $('hp-enemy-num').textContent = battle.enemyHp;
    $('combo-count').textContent = battle.combo;
    $('technique-label').textContent = '术式：' + currentTech().name;
  }

  function setDialogue(text) {
    $('battle-dialogue').textContent = text;
  }

  async function startAttack() {
    if (battle.ended) return;
    // 补查缺失的释义（防止出题时没有中文选项）
    const noMeaning = wordBank.filter((w) => !w.meaning).map((w) => w.word);
    if (noMeaning.length) {
      try {
        const meanings = await fetchMeanings(noMeaning);
        wordBank.forEach((w) => {
          if (!w.meaning && meanings[w.word.toLowerCase()]) w.meaning = meanings[w.word.toLowerCase()];
        });
        saveWordBank();
      } catch (e) { /* ignore */ }
    }
    const pool = wordBank.filter((w) => w.meaning);
    if (!pool.length) {
      alert('词库还是空的，先去「六眼 · 识词」录入单词');
      return;
    }
    ensureAudio();
    sfxCast();
    $('btn-attack').classList.add('hidden');
    $('battle-quiz').classList.remove('hidden');
    $('battle-feedback').classList.add('hidden');
    buildBattleQuestion();
    $('battle-quiz').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function buildBattleQuestion() {
    const pool = wordBank.filter((w) => w.meaning);
    battle.currentWord = pool[Math.floor(Math.random() * pool.length)];
    $('battle-word').textContent = battle.currentWord.word;
    const box = $('battle-options');
    box.innerHTML = '';
    const correct = battle.currentWord.meaning;
    const opts = [correct];
    let guard = 0;
    while (opts.length < 4 && guard < 300) {
      guard++;
      const r = pool[Math.floor(Math.random() * pool.length)];
      if (!r || r.meaning === correct || opts.indexOf(r.meaning) >= 0) continue;
      opts.push(r.meaning);
    }
    while (opts.length < 4) opts.push('（无此义项）');
    shuffle(opts);
    opts.forEach((o) => {
      const btn = document.createElement('button');
      btn.className = 'opt';
      btn.textContent = o;
      btn.addEventListener('click', () => answerBattle(btn, o, correct));
      box.appendChild(btn);
    });
  }

  function answerBattle(btn, chosen, correct) {
    const opts = document.querySelectorAll('#battle-options .opt');
    opts.forEach((o) => o.classList.add('disabled'));
    const isRight = chosen === correct;
    if (isRight) {
      btn.classList.add('right');
      sfxHit();
    } else {
      btn.classList.add('wrong');
      opts.forEach((o) => { if (o.textContent === correct) o.classList.add('right'); });
      sfxMiss();
    }
    $('battle-feedback').classList.remove('hidden');
    // 更新遗忘曲线
    scheduleReview(battle.currentWord, isRight);
    saveWordBank();
    cloudSyncWords();

    const tech = currentTech();
    $('battle-feedback').textContent = isRight ? '✅ ' + tech.name + ' 命中！' : '❌ 正确答案：' + correct;

    // 延迟结算，让玩家看到反馈
    setTimeout(() => {
      if (isRight) {
        const dmg = tech.damage;
        battle.enemyHp = Math.max(0, battle.enemyHp - dmg);
        battle.combo++;
        // 检查术式升级
        const next = currentTech();
        if (next.name !== tech.name) {
          sfxUpgrade();
          if (next.name === '无量空处') sfxVoid();
        }
        setDialogue(next.name + ' 命中！' + (next.name === '无量空处' ? '' : ' ' + pick(DIALOGUES.hit)));
        renderBattle();
        if (battle.enemyHp <= 0) { endBattle(true); return; }
      } else {
        battle.playerHp = Math.max(0, battle.playerHp - 12);
        battle.combo = 0;
        setDialogue(pick(DIALOGUES.miss));
        renderBattle();
        if (battle.playerHp <= 0) { endBattle(false); return; }
      }
      // 下一回合
      $('battle-quiz').classList.add('hidden');
      $('btn-attack').classList.remove('hidden');
    }, 700);
  }

  function endBattle(win) {
    battle.ended = true;
    $('battle-quiz').classList.add('hidden');
    $('btn-attack').classList.add('hidden');
    $('battle-result').classList.remove('hidden');
    if (win) {
      sfxWin();
      $('battle-emoji').textContent = '🏆';
      $('battle-title').textContent = '胜利';
      $('battle-text').textContent = pick(DIALOGUES.win);
      setDialogue(pick(DIALOGUES.win));
    } else {
      sfxLose();
      $('battle-emoji').textContent = '💀';
      $('battle-title').textContent = '失败';
      $('battle-text').textContent = pick(DIALOGUES.lose);
      setDialogue(pick(DIALOGUES.lose));
    }
    renderBattle();
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    $('btn-sound').textContent = soundEnabled ? '🔊 音效开' : '🔇 音效关';
    if (soundEnabled) { ensureAudio(); startBgm(); } else { stopBgm(); }
  }

  // 把一批词并入词库（已有则跳过，新词加内容并查释义）
  async function addToWordBank(words) {
    const newWords = words.filter((w) => !findWord(w));
    let meanings = {};
    if (newWords.length && cfg.write.key) {
      try { meanings = await fetchMeanings(newWords); } catch (e) { /* 释义失败则留空 */ }
    }
    const now = Date.now();
    newWords.forEach((w) => {
      wordBank.push({
        word: w,
        meaning: meanings[w.toLowerCase()] || '',
        addedAt: now,
        state: { ivl: 0, ease: 2.5, due: 0, reps: 0, lapses: 0 }
      });
    });
    saveWordBank();
    await cloudSyncWords();
  }

  // 词库同步到云端（登录后）
  async function cloudSyncWords() {
    if (!supabase || !authUserId) return;
    try {
      const rows = wordBank.map((w) => ({
        user_id: authUserId,
        word: w.word,
        meaning: w.meaning || '',
        state: w.state || { ivl: 0, ease: 2.5, due: 0, reps: 0, lapses: 0 }
      }));
      // 按 word 去重 upsert
      const { error } = await supabase.from('words').upsert(rows, { onConflict: 'user_id,word' });
      if (error) console.warn('词库同步失败', error.message);
    } catch (e) { /* ignore */ }
  }

  async function identifyWords() {
    if (!currentImages.length) return;
    if (!cfg.vision.key || !cfg.vision.baseURL || !cfg.vision.model) { openSettings(); alert('请先在设置里填好「识图模型」的 key'); return; }

    const status = $('identify-status');
    status.classList.remove('hidden');
    status.classList.remove('error');
    status.textContent = '六眼正在扫描截图中的单词…';
    $('btn-identify').disabled = true;

    try {
      const wordsLine = await callVision();
      const words = Array.from(new Set(parseWordList(wordsLine)));
      todayWords = words;
      saveWords(todayWords);
      // 并入词库 + 查释义
      status.textContent = '正在查询中文释义…';
      await addToWordBank(words);
      renderWordPool();
      updateEssayInput();
      renderBank();
      status.classList.remove('error');
      status.textContent = '已录入 ' + todayWords.length + ' 个词，可去生成短文或复习了 ✓';
      clearImages();
    } catch (e) {
      status.classList.add('error');
      status.textContent = '识别失败：' + e.message;
    } finally {
      refreshIdentifyBtn();
    }
  }

  // 清空截图和预览
  function clearImages() {
    currentImages = [];
    $('file-input').value = '';
    $('preview-grid').innerHTML = '';
    $('upload-text').textContent = '点这里，上传今天背单词的截图';
    renderPreview();
  }

  // 渲染词库列表
  function renderWordPool() {
    const card = $('word-pool-card');
    const box = $('word-pool');
    $('word-pool-count').textContent = todayWords.length;
    if (!todayWords.length) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    box.innerHTML = '';
    todayWords.forEach((w) => {
      const chip = document.createElement('span');
      chip.className = 'pool-chip';
      chip.textContent = w;
      box.appendChild(chip);
    });
  }

  // 更新短文入口的状态（词库字数）
  function updateEssayInput() {
    $('essay-word-count').textContent = todayWords.length;
    $('essay-empty-tip').style.display = todayWords.length ? 'none' : '';
    refreshGenerateBtn();
  }

  /* ---------- 词库复习 ---------- */
  function dueWords(limit) {
    const now = Date.now();
    return wordBank
      .filter((w) => (w.state && w.state.due) <= now || !w.meaning)
      .sort((a, b) => (a.state ? a.state.due : 0) - (b.state ? b.state.due : 0))
      .slice(0, limit || 100);
  }

  function renderBank() {
    $('bank-total').textContent = wordBank.length;
    $('bank-due').textContent = dueWords().length;
    $('bank-mastered').textContent = wordBank.filter((w) => w.state && w.state.ivl >= 7).length;
    $('bank-list-count').textContent = wordBank.length;
    const box = $('bank-list');
    box.innerHTML = '';
    if (!wordBank.length) {
      box.innerHTML = '<p class="sub" style="text-align:center;padding:16px">词库还是空的，先去「六眼 · 识词」录入单词。</p>';
      return;
    }
    wordBank.forEach((w) => {
      const row = document.createElement('div');
      row.className = 'bank-row';
      const left = document.createElement('div');
      left.className = 'bank-word';
      left.textContent = w.word;
      const right = document.createElement('div');
      right.className = 'bank-mean';
      right.textContent = w.meaning || '（无释义）';
      row.appendChild(left);
      row.appendChild(right);
      box.appendChild(row);
    });
  }

  /* 复习：四选一（已移除，复习交给游戏） */

  /* ---------- 分段解析：按空行切成英文段，翻译由前端逐段完成 ---------- */
  function parseParagraphs(raw) {
    return raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  }

  // 用写文模型翻译一段英文
  async function translateParagraph(en) {
    const model = cfg.write.model;
    // 去掉加粗标记再翻译，避免中文翻译里残留 **
    const cleanEn = en.replace(/\*\*/g, '');
    const prompt = '把下面这段英文翻译成自然流畅的中文，只输出翻译结果（纯中文，不要任何星号、不要解释、不要原文）：\n\n' + cleanEn;
    const url = cfg.write.baseURL.replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.write.key },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500
      })
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(resp.status + '：' + t.slice(0, 120));
    }
    const data = await resp.json();
    const content = (data.choices && data.choices[0].message && data.choices[0].message.content) || '';
    // 兜底：清理残留的星号
    return content.replace(/\*+/g, '');
  }

  function renderSegments(segments, highlightSet) {
    const box = $('essay-en');
    box.innerHTML = '';
    segments.forEach((seg) => {
      const para = document.createElement('div');
      para.className = 'para';

      const en = document.createElement('div');
      en.className = 'para-en';
      en.appendChild(renderEssayDOM(seg.en, highlightSet));
      para.appendChild(en);

      if (seg.cn) {
        const eye = document.createElement('button');
        eye.className = 'para-eye';
        const eyeImg = document.createElement('img');
        eyeImg.className = 'eye-icon';
        eyeImg.src = 'assets/icon-blindfold.png';
        eyeImg.alt = '';
        const eyeLabel = document.createElement('span');
        eyeLabel.textContent = '翻译';
        eye.appendChild(eyeImg);
        eye.appendChild(eyeLabel);
        const cn = document.createElement('div');
        cn.className = 'para-cn hidden-cn';
        cn.textContent = seg.cn;
        eye.addEventListener('click', () => {
          const hidden = cn.classList.contains('hidden-cn');
          cn.classList.toggle('hidden-cn', !hidden);
          eyeLabel.textContent = hidden ? '收起' : '翻译';
        });
        para.appendChild(eye);
        para.appendChild(cn);
      }
      box.appendChild(para);
    });
  }

  // 统计：识别/已用/未用的单词
  function analyzeUsage(words, paragraphs) {
    const allText = paragraphs.join(' ').toLowerCase().replace(/\*\*/g, '');
    const used = [], missed = [];
    words.forEach((w) => {
      if (w.length <= 2) { used.push(w); return; }
      const forms = inflect(w);
      const hit = Array.from(forms).some((f) => new RegExp('\\b' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(allText));
      (hit ? used : missed).push(w);
    });
    return { used, missed };
  }

  // 渲染单词使用统计到结果区
  function renderUsageChip(targetWords, paragraphs) {
    const usage = analyzeUsage(targetWords, paragraphs);
    const chip = $('words-chip');
    let html = '<div class="usage-line">📊 识别 <b>' + targetWords.length + '</b> 词 · 已用 <b class="u-ok">' + usage.used.length + '</b> 词 · 未用 <b class="u-miss">' + usage.missed.length + '</b> 词</div>';
    if (usage.missed.length) {
      html += '<div class="usage-miss">⚠️ 未用到的词：' + escapeHtml(usage.missed.join('、')) + '</div>';
    } else {
      html += '<div class="usage-miss ok">✅ 全部目标词都用上了</div>';
    }
    chip.innerHTML = html;
  }

  async function renderResult(wordsLine, essay) {
    // wordsLine：单词清单字符串；essay：分段英文（翻译由前端逐段完成）
    const body = (essay || '').trim();
    const paragraphs = parseParagraphs(body);
    const targetWords = parseWordList(wordsLine);
    const highlightSet = buildHighlightSet(targetWords);

    // 先渲染英文（中文默认隐藏、为空）
    const segments = paragraphs.map((en) => ({ en: en, cn: '' }));
    renderSegments(segments, highlightSet);
    renderUsageChip(targetWords, paragraphs);
    $('result-card').classList.remove('hidden');
    $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });

    // 并行翻译各段，完成后填入并保存
    try {
      const cns = await Promise.all(paragraphs.map((en) => translateParagraph(en)));
      segments.forEach((s, i) => { s.cn = (cns[i] || '').trim(); });
      renderSegments(segments, highlightSet);
      saveHistory(wordsLine, segments);
    } catch (e) {
      renderSegments(segments, highlightSet);
      saveHistory(wordsLine, segments);
    }
  }

  /* ---------- 复制 ---------- */
  function copyAll() {
    const lines = [];
    const words = $('words-chip').textContent;
    if (words) { lines.push(words, ''); }
    document.querySelectorAll('#essay-en .para').forEach((para) => {
      const en = para.querySelector('.para-en') ? para.querySelector('.para-en').innerText : '';
      const cn = para.querySelector('.para-cn') ? para.querySelector('.para-cn').textContent : '';
      if (en) lines.push(en);
      if (cn) lines.push('【译】' + cn);
      lines.push('');
    });
    const full = lines.join('\n').trim();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(full).then(() => toast('已复制全文 ✓'));
    } else {
      // 兜底
      const ta = document.createElement('textarea');
      ta.value = full;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('已复制全文 ✓');
    }
  }

  function toast(msg) {
    const el = $('gen-status');
    el.textContent = msg;
    el.classList.remove('hidden', 'error');
    setTimeout(() => el.classList.add('hidden'), 1800);
  }

  /* ---------- 点击查词 ---------- */
  let currentLookupWord = '';
  function updateMarkBtn() {
    const btn = $('btn-lookup-mark');
    if (!btn) return;
    const marked = currentLookupWord && markedWords.has(currentLookupWord.toLowerCase());
    btn.textContent = marked ? '★ 已标记（点击取消）' : '☆ 标记为生词';
    btn.classList.toggle('marked', !!marked);
    btn.dataset.word = currentLookupWord;
  }
  function showLookup(word, content) {
    currentLookupWord = word;
    $('lookup-word').textContent = word;
    $('lookup-body').textContent = content;
    $('lookup-mask').classList.remove('hidden');
    updateMarkBtn();
  }
  function closeLookup() {
    $('lookup-mask').classList.add('hidden');
  }
  // 标记/取消标记为生词，并把当前短文里该词染红/恢复
  function toggleMark() {
    const word = currentLookupWord;
    if (!word) return;
    const key = word.toLowerCase();
    if (markedWords.has(key)) {
      markedWords.delete(key);
    } else {
      markedWords.add(key);
    }
    saveMarked();
    updateMarkBtn();
    // 直接改当前短文 DOM 里所有匹配该词的单词
    document.querySelectorAll('#essay-en .e-word').forEach((el) => {
      if (el.dataset.word && el.dataset.word.toLowerCase() === key) {
        el.classList.toggle('marked', markedWords.has(key));
        if (markedWords.has(key)) el.classList.remove('target');
      }
    });
  }
  let lookupSeq = 0;
  async function lookupWord(word) {
    if (!word) return;
    if (!cfg.write.key || !cfg.write.baseURL) {
      $('lookup-mask').classList.add('hidden');
      openSettings();
      alert('请先在设置里填写「写文模型」的 API Key，才能点击查词');
      return;
    }
    const seq = ++lookupSeq;
    showLookup(word, '查询中…');
    const model = cfg.write.model;
    const prompt = [
      '请用中文准确简洁地解释这个英文单词或短语：' + word,
      '严格按以下格式输出：',
      '音标: /.../',
      '词性: n. / v. / adj. 等',
      '释义: 中文释义（最多列出4个常用义项，用分号隔开）',
      '例句: 一个简单英文例句',
      '翻译: 例句的中文翻译'
    ].join('\n');
    try {
      const url = cfg.write.baseURL.replace(/\/+$/, '') + '/chat/completions';
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.write.key },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 400
        })
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(resp.status + '：' + t.slice(0, 150));
      }
      const data = await resp.json();
      const content = (data.choices && data.choices[0].message && data.choices[0].message.content) || '';
      if (!content) throw new Error('模型未返回内容');
      if (seq === lookupSeq) $('lookup-body').textContent = content;
    } catch (e) {
      if (seq === lookupSeq) $('lookup-body').textContent = '查询失败：' + e.message;
    }
  }

  /* ---------- 历史记录 ---------- */
  function saveHistory(words, segments) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { /* ignore */ }
    list.unshift({
      date: new Date().toLocaleString('zh-CN'),
      words: words,
      segments: segments
    });
    list = list.slice(0, 30);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    // 同步到云端
    if (supabase && authUserId) {
      supabase.from('essays').insert({ user_id: authUserId, words_line: words, segments: segments }).then(() => {});
    }
  }

  function loadHistory() {
    const box = $('history-list');
    let list = [];
    try { list = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { /* ignore */ }
    if (!list.length) {
      box.innerHTML = '<div class="history-empty">还没有历史记录</div>';
      return;
    }
    box.innerHTML = '';
    list.forEach((item, index) => {
      const div = document.createElement('div');
      div.className = 'history-item';
      const d = document.createElement('div');
      d.className = 'h-date';
      d.textContent = item.date + (item.words ? ' · ' + item.words : '');
      const del = document.createElement('button');
      del.className = 'h-del';
      del.textContent = '删除';
      del.title = '删除这条';
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        deleteHistory(index);
      });
      d.appendChild(del);
      const e = document.createElement('div');
      e.className = 'h-excerpt';
      // 摘要：取各段英文，目标词高亮
      const segs = item.segments || [];
      const preview = segs.map((s) => s.en).join(' ');
      e.innerHTML = renderHighlightHtml(preview);
      div.appendChild(d);
      div.appendChild(e);
      div.addEventListener('click', () => {
        renderSegments(segs, buildHighlightSet(parseWordList(item.words)));
        renderUsageChip(parseWordList(item.words), segs.map((s) => s.en));
        $('result-card').classList.remove('hidden');
        $('history-mask').classList.add('hidden');
        $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      box.appendChild(div);
    });
  }

  function deleteHistory(index) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { return; }
    list.splice(index, 1);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    loadHistory();
  }

  /* ---------- 设置 ---------- */
  function openSettings() { $('settings-mask').classList.remove('hidden'); updateAuthInfo(); }
  function closeSettings() { $('settings-mask').classList.add('hidden'); }
  function openHistory() { loadHistory(); $('history-mask').classList.remove('hidden'); }
  function closeHistory() { $('history-mask').classList.add('hidden'); }

  function saveSettings() {
    cfg.vision.baseURL = $('cfg-vision-baseurl').value.trim();
    cfg.vision.model = $('cfg-vision-model').value.trim();
    cfg.vision.key = $('cfg-vision-key').value.trim();
    cfg.write.baseURL = $('cfg-write-baseurl').value.trim();
    cfg.write.model = $('cfg-write-model').value.trim();
    cfg.write.key = $('cfg-write-key').value.trim();
    saveCfg();
    refreshGenerateBtn();
    closeSettings();
    toast('设置已保存 ✓');
  }

  async function testConnection() {
    const baseURL = $('cfg-write-baseurl').value.trim();
    const model = $('cfg-write-model').value.trim();
    const key = $('cfg-write-key').value.trim();
    if (!baseURL || !model || !key) { alert('请先填全 baseURL、模型名和 key'); return; }
    const status = $('gen-status');
    status.classList.remove('hidden', 'error');
    status.textContent = '测试中…';
    try {
      const url = baseURL.replace(/\/+$/, '') + '/chat/completions';
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: '回复"ok"两个字' }],
          max_tokens: 8
        })
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(resp.status + ' ' + txt.slice(0, 120));
      }
      const data = await resp.json();
      const out = data.choices && data.choices[0].message.content;
      status.textContent = '连接成功 ✓ 模型回复：' + out;
    } catch (e) {
      status.classList.add('error');
      status.textContent = '连接失败：' + e.message;
    }
  }

  /* ---------- 事件 ---------- */
  function bind() {
    // 工作台卡片 + 返回 + 主题
    document.querySelectorAll('.wb-card[data-goto]').forEach((c) => {
      c.addEventListener('click', () => gotoCard(c.dataset.goto));
    });
    $('btn-back').addEventListener('click', () => showView('view-workbench'));
    $('btn-theme').addEventListener('click', toggleTheme);

    $('file-input').addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length) handleFiles(e.target.files);
    });
    // 账号
    $('btn-auth-login').addEventListener('click', doLogin);
    $('btn-auth-signup').addEventListener('click', doSignup);
    $('btn-auth-skip').addEventListener('click', skipAuth);
    $('btn-logout').addEventListener('click', doLogout);
    // 清空重选
    $('btn-remove').addEventListener('click', () => {
      currentImages = [];
      $('file-input').value = '';
      $('preview-grid').innerHTML = '';
      $('upload-text').textContent = '点这里，上传今天背单词的截图';
      renderPreview();
    });

    $('btn-generate').addEventListener('click', generate);
    $('btn-identify').addEventListener('click', identifyWords);
    // 游戏
    $('btn-attack').addEventListener('click', startAttack);
    $('btn-sound').addEventListener('click', toggleSound);
    $('btn-battle-again').addEventListener('click', resetBattle);
    // 短文页里的「去识词」按钮（不在工作台卡片里，需单独绑定）
    const gotoIdentify = $('btn-goto-identify');
    if (gotoIdentify) gotoIdentify.addEventListener('click', () => gotoCard('identify'));

    $('btn-settings').addEventListener('click', openSettings);
    $('btn-settings-close').addEventListener('click', closeSettings);
    $('settings-mask').addEventListener('click', (e) => {
      if (e.target === $('settings-mask')) closeSettings();
    });
    $('btn-save-cfg').addEventListener('click', saveSettings);
    $('btn-test').addEventListener('click', testConnection);

    $('btn-history').addEventListener('click', openHistory);
    $('btn-history-close').addEventListener('click', closeHistory);
    $('history-mask').addEventListener('click', (e) => {
      if (e.target === $('history-mask')) closeHistory();
    });

    $('btn-copy').addEventListener('click', copyAll);

    // 点击短文单词查词（事件委托）
    $('essay-en').addEventListener('click', (e) => {
      const el = e.target.closest('.e-word');
      if (el && el.dataset.word) lookupWord(el.dataset.word);
    });
    $('btn-lookup-close').addEventListener('click', closeLookup);
    $('btn-lookup-mark').addEventListener('click', toggleMark);
    $('lookup-mask').addEventListener('click', (e) => {
      if (e.target === $('lookup-mask')) closeLookup();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
