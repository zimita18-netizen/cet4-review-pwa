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
      let list = arr.map((it) => (typeof it === 'string'
        ? { word: it, meaning: '', addedAt: Date.now(), state: { ivl: 0, ease: 2.5, due: 0, reps: 0, lapses: 0 } }
        : it));
      // 去重：同词只保留第一条（合并释义）
      var seen = {};
      var deduped = [];
      list.forEach(function (it) {
        var key = (it.word || '').toLowerCase().trim();
        if (!key || seen[key]) return;
        seen[key] = true;
        // 清理释义：去掉所有英文（中文释义不该有英文单词）
        if (it.meaning) {
          it.meaning = it.meaning.replace(/[A-Za-z]+/g, '')
            .replace(/[；;]+\s*[；;]*/g, '；')
            .replace(/^[\s；;,.，。]+|[\s；;,.，。]+$/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        }
        deduped.push(it);
      });
      if (deduped.length !== list.length) {
        try { localStorage.setItem(BANK_KEY, JSON.stringify(deduped)); } catch (e) { /* ignore */ }
      }
      return deduped;
    } catch (e) { /* ignore */ }
    return [];
  }
  function saveWordBank() {
    var seen = {};
    var deduped = [];
    wordBank.forEach(function (it) {
      var key = (it.word || '').toLowerCase().trim();
      if (!key || seen[key]) return;
      seen[key] = true;
      deduped.push(it);
    });
    if (deduped.length !== wordBank.length) wordBank = deduped;
    try { localStorage.setItem(BANK_KEY, JSON.stringify(wordBank)); } catch (e) { /* ignore */ }
  }
  function findWord(w) {
    var lw = (w || '').toLowerCase().trim();
    return wordBank.find((x) => (x.word || '').toLowerCase().trim() === lw);
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
  var speedGame = null;
  var matchGame = null;
  var rainGame = null;

  const VIEWS = ['view-workbench', 'view-identify', 'view-essay', 'view-game', 'view-words'];
  function showView(name) {
    VIEWS.forEach((v) => $(v).classList.toggle('hidden', v !== name));
    $('view-auth').classList.add('hidden');
    $('btn-back').classList.toggle('hidden', name === 'view-workbench');
    if (name === 'view-words') renderBank();
    if (name === 'view-essay') updateEssayInput();
    if (name === 'view-identify') { renderWordPool(); refreshIdentifyBtn(); }
    if (name === 'view-game') showGameSelect();
    else stopBgm();
    if (name === 'view-workbench') updateWbBadges();
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

  function updateWbBadges() {
    var total = wordBank.length;
    var due = wordBank.filter(function (w) { return w.due && w.due <= Date.now(); }).length;
    var wins = parseInt(localStorage.getItem('cet4_battle_wins') || '0', 10);
    $('wb-badge-identify').textContent = total + ' 词';
    $('wb-badge-game').textContent = wins + ' 胜';
    $('wb-badge-words').textContent = due + ' 待复习';
    $('wb-badge-words').classList.toggle('badge-due', due > 0);
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
      status.innerHTML = '<span class="loading-ring"></span> 正在根据词库生成短文…';
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
      const m = line.match(/^\s*([A-Za-z][A-Za-z\-']*?)\s*[=＝:：]\s*(.+)\s*$/);
      if (!m) return;
      var word = m[1].trim().toLowerCase();
      var meaning = m[2].trim();
      // 清理：去掉释义中所有英文（中文释义不该有英文单词）
      meaning = meaning.replace(/[A-Za-z]+/g, '')
        .replace(/[；;]+\s*[；;]*/g, '；')
        .replace(/^[\s；;,.，。]+|[\s；;,.，。]+$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      // 必须包含中文才存
      if (/[\u4e00-\u9fff]/.test(meaning)) {
        map[word] = meaning;
      }
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
      s.due = Date.now() + s.ivl * 86400000;
    } else {
      s.reps = 0;
      s.lapses = (s.lapses || 0) + 1;
      s.ease = Math.max(1.3, (s.ease || 2.5) - 0.2);
      s.ivl = 0;
      // 答错 10 分钟后再复习，不立即 due（避免每局都刷到同样的词）
      s.due = Date.now() + 600000;
    }
    w.state = s;
    return w;
  }

  /* ============ 音效系统（真实音频文件 + Web Audio 补充） ============ */
  let audioCtx = null;
  let soundEnabled = true;

  // 音频文件池：每个音效预创建多个 Audio 实例，避免连续播放中断
  const SFX_POOL_SIZE = 4;
  const sfxPools = {};
  const SFX_MAP = {
    vacuum:       'assets/audio/vacuum_whoosh.mp3',        // 苍（蓝色吸引）
    laser:        'assets/audio/laser_shot.mp3',            // 苍（能量射击）
    shockwave:    'assets/audio/energy_shockwave.mp3',     // 赫（红色冲击）
    swordWhoosh:  'assets/audio/sword_whoosh.mp3',          // 斩击挥空
    magicSlice:   'assets/audio/magic_sword_slice.mp3',    // 解·斩击
    swordImpact:  'assets/audio/sword_impact.mp3',         // 命中
    fireExplosion:'assets/audio/fire_spell_explosion.mp3', // 开·火焰爆炸
    fireball:     'assets/audio/fireball_spell.mp3',       // 火
    magicMystery: 'assets/audio/magic_mystery_whoosh.mp3', // 茈/无量空处
    thunderHit:   'assets/audio/cinematic_thunder_hit.mp3',// 雷击/终极
    movieImpact:  'assets/audio/movie_impact.mp3'          // 终极命中
  };
  let bgmEl = null;

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  function initSfxPools() {
    if (Object.keys(sfxPools).length) return;
    Object.keys(SFX_MAP).forEach(function (name) {
      var pool = [];
      for (var i = 0; i < SFX_POOL_SIZE; i++) {
        var a = new Audio(SFX_MAP[name]);
        a.preload = 'auto';
        a.volume = 0.7;
        pool.push(a);
      }
      sfxPools[name] = pool;
    });
  }

  function playSample(name) {
    if (!soundEnabled) return;
    var pool = sfxPools[name];
    if (!pool) return;
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].paused || pool[i].ended) {
        pool[i].currentTime = 0;
        pool[i].play().catch(function () {});
        return;
      }
    }
    pool[0].currentTime = 0;
    pool[0].play().catch(function () {});
  }

  // Web Audio 合成补充（用于细节音）
  function beep(freq, dur, type, gain, when) {
    if (!soundEnabled || !audioCtx) return;
    var t = when || audioCtx.currentTime;
    var osc = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  // 术式音效：根据不同术式播放不同组合
  function sfxCast() {
    ensureAudio();
    initSfxPools();
    playSample('vacuum');
  }
  function sfxHit(techName) {
    if (techName === '苍') { playSample('laser'); playSample('swordImpact'); }
    else if (techName === '赫') { playSample('shockwave'); playSample('movieImpact'); }
    else if (techName === '茈') { playSample('magicMystery'); playSample('thunderHit'); }
    else if (techName === '无量空处') { playSample('magicMystery'); playSample('thunderHit'); playSample('movieImpact'); }
    else { playSample('swordImpact'); }
  }
  function sfxMiss() {
    playSample('swordWhoosh');
    beep(200, 0.2, 'sawtooth', 0.12);
  }
  function sfxUpgrade() {
    playSample('magicSlice');
    beep(880, 0.1, 'square', 0.15, audioCtx.currentTime + 0.07);
    beep(1100, 0.14, 'square', 0.17, audioCtx.currentTime + 0.14);
  }
  function sfxVoid() {
    playSample('magicMystery');
    playSample('thunderHit');
    playSample('movieImpact');
  }
  function sfxWin() {
    playSample('thunderHit');
    [523, 659, 784, 1047].forEach(function (f, i) { beep(f, 0.16, 'square', 0.18, audioCtx.currentTime + i * 0.12); });
  }
  function sfxLose() {
    playSample('fireExplosion');
    [392, 330, 262, 196].forEach(function (f, i) { beep(f, 0.22, 'sawtooth', 0.15, audioCtx.currentTime + i * 0.15); });
  }

  /* ---------- BGM（真实音频文件循环播放） ---------- */
  function startBgm() {
    ensureAudio();
    if (!bgmEl) {
      bgmEl = new Audio('assets/audio/bgm-battle-v1.mp3');
    bgmEl.loop = true;
    bgmEl.volume = 0.05;
    }
    if (soundEnabled) {
      bgmEl.play().catch(function () {});
    }
  }
  function stopBgm() {
    if (bgmEl) { bgmEl.pause(); }
  }

  /* ============ 新宿决战 游戏 ============ */
  const TECHNIQUES = [
    { name: '苍', combo: 0, damage: 12 },
    { name: '赫', combo: 4, damage: 20 },
    { name: '茈', combo: 8, damage: 35 },
    { name: '无量空处', combo: 14, damage: 60 }
  ];
  const DIALOGUES = {
    cast: [
      '五条悟：术式顺转「苍」。', '五条悟：术式反转「赫」。',
      '五条悟：虚式「茈」！', '五条悟：领域展开——无量空处。',
      '五条悟：这一击，可别移开视线。'
    ],
    hit: ['五条悟：就这？', '五条悟：还不够啊。', '五条悟：再让我刷会帅吧。', '宿傩：有意思…', '五条悟：你还是不行啊。'],
    miss: ['宿傩：太慢了。', '宿傩：就这点本事？', '宿傩：你才是挑战者。', '五条悟：啧，分心了。', '宿傩：让我看看你能撑到什么时候。'],
    lowhp_gojo: ['五条悟：还没结束呢。'],
    lowhp_sukuna: ['宿傩：这样才有意思。'],
    win: ['五条悟：这场胜负，已经定了。', '五条悟：你已经成长到了这种地步啊，老师为你感到骄傲。'],
    lose: ['宿傩：到此为止。', '宿傩：就你这点咒力，也敢挑战我？']
  };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
  }

  /* ===== 难度配置 ===== */
  const DIFFICULTIES = {
    easy:   { label: '轻松', time: 15, enemyHp: 150, enemyDmg: 8,  regen: 0, critRate: 0.15, rageThreshold: 999 },
    normal: { label: '标准', time: 10, enemyHp: 220, enemyDmg: 12, regen: 0, critRate: 0.10, rageThreshold: 4 },
    hard:   { label: '修罗', time: 7,  enemyHp: 300, enemyDmg: 16, regen: 5, critRate: 0.05, rageThreshold: 3 }
  };
  const STATS_KEY = 'cet4essay_battle_stats_v1';

  /* ===== 原声台词播放 ===== */
  const VOICE_CLIPS = {
    '苍': 'assets/audio/voice/gojo-blue.mp3',
    '赫': 'assets/audio/voice/gojo-red.mp3',
    '茈': 'assets/audio/voice/gojo-purple.mp3',
    '无量空处': 'assets/audio/voice/gojo-domain.mp3',
    'win': 'assets/audio/voice/gojo-win.mp3',
    'sukuna_atk': 'assets/audio/voice/sukuna-kai.mp3',
    'sukuna_laugh': 'assets/audio/voice/sukuna-laugh.mp3'
  };
  function playVoice(key) {
    // 台词已移除（用户反馈太吵）
    return;
  }

  let battle = null;
  let battleTimer = null;
  let battleTimeStart = 0;
  let battleQuestionCount = 0;

  function loadBattleStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveBattleStats(s) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  function getBattleStats() {
    var s = loadBattleStats();
    return {
      wins: s.wins || 0, losses: s.losses || 0,
      bestCombo: s.bestCombo || 0, totalCorrect: s.totalCorrect || 0, totalWrong: s.totalWrong || 0
    };
  }
  function updateBattleStats(win, combo, correct, wrong) {
    var s = getBattleStats();
    if (win) s.wins++; else s.losses++;
    s.bestCombo = Math.max(s.bestCombo, combo);
    s.totalCorrect += correct;
    s.totalWrong += wrong;
    saveBattleStats(s);
  }

  function currentTech() {
    var idx = 0;
    for (var i = 0; i < TECHNIQUES.length; i++) {
      if (battle.combo >= TECHNIQUES[i].combo) idx = i;
    }
    return TECHNIQUES[idx];
  }

 function getGameWordPool(usedList, count) {
    var pool = wordBank.filter(function (w) { return w.meaning; });
    if (!pool.length) return [];
    var used = usedList || [];
    var avail = pool.filter(function (w) { return used.indexOf(w.word.toLowerCase()) < 0; });
    if (!avail.length) avail = pool;
    var now = Date.now();
    var due = avail.filter(function (w) { return w.state && w.state.due && w.state.due <= now; });
    var notDue = avail.filter(function (w) { return !w.state || !w.state.due || w.state.due > now; });
    var src;
    if (due.length && (Math.random() < 0.7 || !notDue.length)) src = due;
    else src = notDue.length ? notDue : avail;
    var result = [];
    var guard = 0;
    while (result.length < count && src.length > 0 && guard < 200) {
      guard++;
      var idx = Math.floor(Math.random() * src.length);
      var w = src.splice(idx, 1)[0];
      result.push(w);
    }
    return result;
  }

  function buildOptions(word, count) {
    var pool = wordBank.filter(function (w) { return w.meaning; });
    return pickOptions(pool, word.meaning, 'meaning');
  }

  function applySm2(w, correct) {
    scheduleReview(w, correct);
    saveWordBank();
    cloudSyncWords();
  }

  function hideAllGameUI() {
    $('game-select').classList.add('hidden');
    $('battle-difficulty').classList.add('hidden');
    $('battle-arena').classList.add('hidden');
    $('battle-quiz').classList.add('hidden');
    $('battle-result').classList.add('hidden');
    $('speed-arena').classList.add('hidden');
    $('speed-result').classList.add('hidden');
    $('match-arena').classList.add('hidden');
    $('match-result').classList.add('hidden');
    $('rain-arena').classList.add('hidden');
    $('rain-result').classList.add('hidden');
  }

  function showGameSelect() {
    if (battle) battle.ended = true;
    if (speedGame) speedGame.active = false;
    if (matchGame) matchGame.active = false;
    if (rainGame) rainGame.active = false;
    hideAllGameUI();
    $('game-select').classList.remove('hidden');
    stopBgm();
    stopTimer();
    var wins = parseInt(localStorage.getItem('cet4_battle_wins') || '0', 10);
    var losses = parseInt(localStorage.getItem('cet4_battle_losses') || '0', 10);
    var speedBest = parseInt(localStorage.getItem('cet4_speed_best') || '0', 10);
    var rainBest = parseInt(localStorage.getItem('cet4_rain_best') || '0', 10);
    $('gc-score-battle').textContent = wins + '胜' + losses + '败';
    $('gc-score-speed').textContent = '最高' + speedBest;
    $('gc-score-rain').textContent = '最高' + rainBest;
  }

  function showDifficultyMenu() {
    $('game-select').classList.add('hidden');
    $('battle-difficulty').classList.remove('hidden');
    $('battle-arena').classList.add('hidden');
    $('battle-quiz').classList.add('hidden');
    $('battle-result').classList.add('hidden');
    stopBgm();
    stopTimer();
  }

  function startBattle(diff) {
    var d = DIFFICULTIES[diff];
    battle = {
      playerHp: 100, enemyHp: d.enemyHp, maxEnemyHp: d.enemyHp,
      combo: 0, ended: false, diff: diff,
      lowHpGojo: false, lowHpSukuna: false,
      correctCount: 0, wrongCount: 0, questionCount: 0,
      usedWords: [], sukunaRage: 0, rageActive: false
    };
    $('battle-diff-label').textContent = d.label;
    $('battle-difficulty').classList.add('hidden');
    $('battle-arena').classList.remove('hidden');
    $('battle-arena').classList.remove('screen-shake', 'screen-shake-strong');
    $('battle-result').classList.add('hidden');
    $('battle-dialogue').classList.remove('dialogue-lowhp');
    $('rage-label').textContent = '';
    setDialogue('五条悟：我的学生都在看着呢，再让我刷会帅吧。');
    if (soundEnabled) startBgm();
    var gojo = document.querySelector('.fighter-img.gojo-img');
    var sukuna = document.querySelector('.fighter-img.sukuna-img');
    if (gojo) gojo.classList.remove('anim-hit', 'anim-shake', 'anim-void');
    if (sukuna) sukuna.classList.remove('anim-hit', 'anim-shake', 'anim-void');
    var fx = $('battle-fx');
    if (fx) fx.className = 'battle-fx';
    renderBattle();
    nextQuestion();
  }

  function renderBattle() {
    $('hp-player').style.width = battle.playerHp + '%';
    $('hp-player-num').textContent = battle.playerHp;
    $('hp-enemy').style.width = battle.enemyHp + '%';
    $('hp-enemy-num').textContent = battle.enemyHp;
    $('combo-count').textContent = battle.combo;
    $('combo-count').classList.toggle('combo-hot', battle.combo >= 5);
    var tech = currentTech();
    $('technique-label').textContent = '术式：' + tech.name;

    // 连击进度条
    var nextTechCombo = null;
    for (var i = 0; i < TECHNIQUES.length; i++) {
      if (TECHNIQUES[i].combo > battle.combo) { nextTechCombo = TECHNIQUES[i]; break; }
    }
    var progFill = $('combo-progress-fill');
    if (progFill) {
      if (nextTechCombo) {
        var prevCombo = 0;
        for (var j = TECHNIQUES.length - 1; j >= 0; j--) {
          if (TECHNIQUES[j].combo <= battle.combo) { prevCombo = TECHNIQUES[j].combo; break; }
        }
        var pct = Math.min(100, ((battle.combo - prevCombo) / (nextTechCombo.combo - prevCombo)) * 100);
        progFill.style.width = pct + '%';
        progFill.classList.remove('maxed');
      } else {
        progFill.style.width = '100%';
        progFill.classList.add('maxed');
      }
    }

    // 宿傩怒气条
    var d = DIFFICULTIES[battle.diff];
    var rageFill = $('rage-fill');
    var rageLabel = $('rage-label');
    if (rageFill) {
      var ragePct = Math.min(100, (battle.sukunaRage / d.rageThreshold) * 100);
      rageFill.style.width = ragePct + '%';
      if (ragePct >= 100) rageFill.classList.add('full');
      else rageFill.classList.remove('full');
    }
    if (rageLabel) {
      rageLabel.textContent = battle.rageActive ? '⚡怒' : (battle.sukunaRage > 0 ? '怒+' + battle.sukunaRage : '');
    }

    if (battle.playerHp <= 30 && battle.playerHp > 0 && !battle.lowHpGojo) {
      battle.lowHpGojo = true;
      setDialogue(pick(DIALOGUES.lowhp_gojo));
      $('battle-dialogue').classList.add('dialogue-lowhp');
    }
    if (battle.enemyHp <= 30 && battle.enemyHp > 0 && !battle.lowHpSukuna) {
      battle.lowHpSukuna = true;
      setDialogue(pick(DIALOGUES.lowhp_sukuna));
      $('battle-dialogue').classList.add('dialogue-lowhp');
    }
  }

  function setDialogue(text) {
    var el = $('battle-dialogue');
    el.textContent = text;
    el.classList.remove('dialogue-flash');
    void el.offsetWidth;
    el.classList.add('dialogue-flash');
  }

  function screenShake(strong) {
    var arena = $('battle-arena');
    if (!arena) return;
    arena.classList.remove('screen-shake', 'screen-shake-strong');
    void arena.offsetWidth;
    arena.classList.add(strong ? 'screen-shake-strong' : 'screen-shake');
    setTimeout(function () {
      arena.classList.remove('screen-shake', 'screen-shake-strong');
    }, strong ? 600 : 350);
  }

  function playTechEffect(techName, isHit) {
    var fx = $('battle-fx');
    if (!fx) return;
    fx.className = 'battle-fx';
    void fx.offsetWidth;
    var gojo = document.querySelector('.fighter-img.gojo-img');
    var sukuna = document.querySelector('.fighter-img.sukuna-img');
    if (!isHit) {
      if (gojo) { gojo.classList.remove('anim-shake'); void gojo.offsetWidth; gojo.classList.add('anim-shake'); }
      fx.classList.add('fx-miss');
      screenShake(false);
      playVoice('sukuna_laugh');
      setTimeout(function () { fx.className = 'battle-fx'; }, 600);
      return;
    }
    if (sukuna) { sukuna.classList.remove('anim-hit'); void sukuna.offsetWidth; sukuna.classList.add('anim-hit'); }
    playVoice(techName);
    var techLabel = $('technique-label');
    if (techLabel) { techLabel.classList.add('tech-active'); setTimeout(function(){ techLabel.classList.remove('tech-active'); }, 600); }
    switch (techName) {
      case '苍':
        fx.classList.add('fx-blue');
        screenShake(false);
        break;
      case '赫':
        fx.classList.add('fx-red');
        screenShake(false);
        break;
      case '茈':
        fx.classList.add('fx-purple');
        screenShake(true);
        break;
      case '无量空处':
        fx.classList.add('fx-void');
        if (gojo) gojo.classList.add('anim-void');
        if (sukuna) sukuna.classList.add('anim-void');
        screenShake(true);
        break;
    }
    setTimeout(function () {
      fx.className = 'battle-fx';
      if (gojo) gojo.classList.remove('anim-void');
      if (sukuna) sukuna.classList.remove('anim-void');
    }, 1000);
  }

  function showDmgFloat(amount, isCrit, isPlayer) {
    var el = $('dmg-float');
    if (!el) return;
    el.className = 'dmg-float';
    void el.offsetWidth;
    el.textContent = isCrit ? '-' + amount + '!' : '-' + amount;
    el.classList.add(isCrit ? 'crit' : 'normal');
    el.classList.add(isPlayer ? 'on-player' : 'on-enemy');
    setTimeout(function () { el.className = 'dmg-float'; }, 900);
  }

  /* ===== 倒计时 ===== */
  function startTimer(seconds) {
    stopTimer();
    battleTimeStart = Date.now();
    var fill = $('quiz-timer-fill');
    if (fill) {
      fill.style.transition = 'none';
      fill.style.width = '100%';
      void fill.offsetWidth;
      fill.style.transition = 'width ' + seconds + 's linear';
      fill.style.width = '0%';
    }
    battleTimer = setTimeout(function () {
      if (!battle || battle.ended) return;
      var opts = document.querySelectorAll('#battle-options .opt');
      if (!opts.length) return;
      var correct = battle.correctAnswer || battle.currentWord.meaning;
      opts.forEach(function (o) {
        o.classList.add('disabled');
        if (o.textContent === correct) o.classList.add('right');
      });
      handleAnswer(false, correct);
    }, seconds * 1000);
  }
  function stopTimer() {
    if (battleTimer) { clearTimeout(battleTimer); battleTimer = null; }
    var fill = $('quiz-timer-fill');
    if (fill) { fill.style.transition = 'none'; fill.style.width = '0%'; }
  }

  /* ===== 优先出复习词（排除本回合已出过的词） ===== */
  function pickWordPool() {
    var pool = wordBank.filter(function (w) { return w.meaning; });
    if (!pool.length) return [];
    var used = (battle && battle.usedWords) || [];
    pool = pool.filter(function (w) { return used.indexOf(w.word) < 0; });
    // 词库全用完了，重置
    if (!pool.length) {
      if (battle) battle.usedWords = [];
      pool = wordBank.filter(function (w) { return w.meaning; });
      if (!pool.length) return [];
    }
    var now = Date.now();
    var due = pool.filter(function (w) { return w.state && w.state.due && w.state.due <= now; });
    var notDue = pool.filter(function (w) { return !w.state || !w.state.due || w.state.due > now; });
    if (due.length && (Math.random() < 0.7 || !notDue.length)) {
      return due;
    }
    return notDue.length ? notDue : pool;
  }

  function nextQuestion() {
    if (!battle || battle.ended) return;
    var pool = pickWordPool();
    if (!pool.length) {
      alert('词库还是空的，先去「六眼 · 识词」录入单词');
      showDifficultyMenu();
      return;
    }
    battle.questionCount++;
    $('battle-round').textContent = '第 ' + battle.questionCount + ' 回合';
    // 修罗难度每3题宿傩回血
    if (battle.diff === 'hard' && battle.questionCount > 1 && (battle.questionCount - 1) % 3 === 0) {
      var regen = DIFFICULTIES.hard.regen;
      battle.enemyHp = Math.min(battle.maxEnemyHp, battle.enemyHp + regen);
      setDialogue('宿傩：反转术式，恢复 ' + regen + ' 点。');
      renderBattle();
    }
    // 按难度选题型
    var types = ['en2cn'];
    if (battle.diff === 'normal' || battle.diff === 'hard') types.push('cn2en');
    if (battle.diff === 'hard') types.push('listen');
    // 宿傩怒气模式强制出难题
    if (battle.rageActive && types.length > 1) {
      types = types.filter(function (t) { return t !== 'en2cn'; });
      if (!types.length) types = ['en2cn'];
    }
    // 避免连续3次同题型
    var qType = types[Math.floor(Math.random() * types.length)];
    if (battle.lastType && types.length > 1) {
      if (qType === battle.lastType && (battle.typeStreak || 0) >= 2) {
        types.splice(types.indexOf(qType), 1);
        qType = types[Math.floor(Math.random() * types.length)];
      }
    }
    if (qType === battle.lastType) {
      battle.typeStreak = (battle.typeStreak || 0) + 1;
    } else {
      battle.typeStreak = 1;
    }
    battle.lastType = qType;

    $('battle-quiz').classList.remove('hidden');
    $('battle-feedback').classList.add('hidden');
    if (qType === 'en2cn') buildEnToCn(pool);
    else if (qType === 'cn2en') buildCnToEn(pool);
    else if (qType === 'listen') buildListen(pool);
    // 记录本回合已出过的词
    if (battle.currentWord && battle.usedWords.indexOf(battle.currentWord.word) < 0) {
      battle.usedWords.push(battle.currentWord.word);
    }
    var d = DIFFICULTIES[battle.diff];
    startTimer(d.time);
    $('battle-quiz').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // 题型1：英文→选中文
  function buildEnToCn(pool) {
    battle.qType = 'en2cn';
    battle.currentWord = pool[Math.floor(Math.random() * pool.length)];
    battle.correctAnswer = battle.currentWord.meaning;
    $('battle-word').innerHTML = '<span class="qword">' + escapeHtml(battle.currentWord.word) + '</span><span class="qhint">选择正确的中文释义</span>';
    var box = $('battle-options');
    box.innerHTML = '';
    var correct = battle.currentWord.meaning;
    var opts = pickOptions(pool, correct, 'meaning');
    opts.forEach(function (o) {
      var btn = makeOptBtn(o, o === correct);
      box.appendChild(btn);
    });
  }

  // 题型2：中文→选英文
  function buildCnToEn(pool) {
    battle.qType = 'cn2en';
    battle.currentWord = pool[Math.floor(Math.random() * pool.length)];
    battle.correctAnswer = battle.currentWord.word;
    $('battle-word').innerHTML = '<span class="qword">' + escapeHtml(battle.currentWord.meaning || '（无释义）') + '</span><span class="qhint">选择对应的英文单词</span>';
    var box = $('battle-options');
    box.innerHTML = '';
    var correct = battle.currentWord.word;
    var opts = pickOptions(pool, correct, 'word');
    opts.forEach(function (o) {
      var btn = makeOptBtn(o, o === correct);
      box.appendChild(btn);
    });
  }

  // 题型3：听音选词
  function buildListen(pool) {
    battle.qType = 'listen';
    battle.currentWord = pool[Math.floor(Math.random() * pool.length)];
    battle.correctAnswer = battle.currentWord.word;
    $('battle-word').innerHTML = '<button class="qplay" id="qplay">🔊 点击播放</button><span class="qhint">听发音，选出单词</span>';
    var playBtn = $('qplay');
    if (playBtn) {
      playBtn.addEventListener('click', function () { speakWord(battle.currentWord.word); });
    }
    setTimeout(function () { speakWord(battle.currentWord.word); }, 200);
    var box = $('battle-options');
    box.innerHTML = '';
    var correct = battle.currentWord.word;
    var opts = pickOptions(pool, correct, 'word');
    opts.forEach(function (o) {
      var btn = makeOptBtn(o, o === correct);
      box.appendChild(btn);
    });
  }

  function speakWord(word) {
    if (!('speechSynthesis' in window)) return;
    var u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.8;
    u.volume = 1;
    speechSynthesis.cancel();
    if (bgmEl) { bgmEl.pause(); }
    u.onend = function () {
      if (soundEnabled && bgmEl) bgmEl.play().catch(function () {});
    };
    u.onerror = function () {
      if (soundEnabled && bgmEl) bgmEl.play().catch(function () {});
    };
    speechSynthesis.speak(u);
  }

  function pickOptions(pool, correct, field) {
    var allPool = wordBank.filter(function (w) { return w.meaning; });
    var src = allPool.length >= 4 ? allPool : pool;
    var opts = [correct];
    var guard = 0;
    while (opts.length < 4 && guard < 300) {
      guard++;
      var r = src[Math.floor(Math.random() * src.length)];
      var val = r[field];
      if (!val || val === correct || opts.indexOf(val) >= 0) continue;
      opts.push(val);
    }
    while (opts.length < 4) opts.push('—');
    shuffle(opts);
    return opts;
  }

  function makeOptBtn(label, isCorrect) {
    var btn = document.createElement('button');
    btn.className = 'opt';
    btn.textContent = label;
    btn.addEventListener('click', function () {
      stopTimer();
      var opts2 = document.querySelectorAll('#battle-options .opt');
      opts2.forEach(function (opt) { opt.classList.add('disabled'); });
      if (isCorrect) { btn.classList.add('right'); }
      else {
        btn.classList.add('wrong');
        opts2.forEach(function (opt) { if (opt.textContent === label && isCorrect) opt.classList.add('right'); });
        opts2.forEach(function (opt) { if (opt.textContent === battle.correctAnswer) opt.classList.add('right'); });
      }
      handleAnswer(isCorrect, battle.correctAnswer);
    });
    return btn;
  }

  function handleAnswer(isRight, correct) {
    stopTimer();
    $('battle-feedback').classList.remove('hidden');
    scheduleReview(battle.currentWord, isRight);
    saveWordBank();
    cloudSyncWords();
    var tech = currentTech();
    var d = DIFFICULTIES[battle.diff];
    if (isRight) {
      battle.correctCount++;
      sfxHit(tech.name);
      playTechEffect(tech.name, true);
      var dmg = tech.damage;
      var isCrit = Math.random() < d.critRate;
      if (isCrit) {
        dmg = Math.round(dmg * 1.5);
        screenShake(true);
      }
      battle.enemyHp = Math.max(0, battle.enemyHp - dmg);
      battle.combo++;
      showDmgFloat(dmg, isCrit, false);
      var next = currentTech();
      if (next.name !== tech.name) {
        sfxUpgrade();
        if (next.name === '无量空处') sfxVoid();
      }
      if (next.name === '无量空处' && tech.name !== '无量空处') {
        setDialogue('五条悟：领域展开——无量空处。');
      } else {
        var hitLine = isCrit ? '暴击！' + next.name + ' 命中！' : next.name + ' 命中！';
        setDialogue(hitLine + (next.name === '无量空处' ? '' : ' ' + pick(DIALOGUES.hit)));
      }
      $('battle-feedback').textContent = (isCrit ? '💥 暴击！' : '✅ ') + tech.name + ' 命中！-' + dmg;
      // 答对清除怒气
      if (battle.sukunaRage > 0) battle.sukunaRage = Math.max(0, battle.sukunaRage - 1);
    } else {
      battle.wrongCount++;
      sfxMiss();
      playTechEffect('', false);
      var pDmg = d.enemyDmg;
      // 宿傩怒气累计
      battle.sukunaRage++;
      if (battle.sukunaRage >= d.rageThreshold && !battle.rageActive) {
        battle.rageActive = true;
        pDmg = Math.round(pDmg * 2);
        setDialogue('宿傩：领域展开——伏魔御厨子。');
        playVoice('sukuna_atk');
        screenShake(true);
        battle.sukunaRage = 0;
      } else if (battle.rageActive) {
        // 怒气持续期间伤害翻倍
        pDmg = Math.round(pDmg * 1.5);
      }
      battle.playerHp = Math.max(0, battle.playerHp - pDmg);
      battle.combo = 0;
      showDmgFloat(pDmg, false, true);
      if (!battle.rageActive) setDialogue(pick(DIALOGUES.miss));
      $('battle-feedback').textContent = '❌ 正确答案：' + correct + '（五条悟 -' + pDmg + (battle.rageActive ? ' 怒气!' : '') + '）';
      // 怒气持续 1 回合后结束
      if (battle.rageActive) {
        setTimeout(function () { battle.rageActive = false; renderBattle(); }, 100);
      }
    }
    renderBattle();
    if (battle.enemyHp <= 0) { endBattle(true); return; }
    if (battle.playerHp <= 0) { endBattle(false); return; }
    setTimeout(function () { nextQuestion(); }, 900);
  }

  function endBattle(win) {
    battle.ended = true;
    stopTimer();
    $('battle-quiz').classList.add('hidden');
    var result = $('battle-result');
    result.classList.remove('hidden');
    void result.offsetWidth;
    result.classList.add('show');
    if (win) {
      sfxWin();
      playVoice('win');
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
    // 战绩统计
    updateBattleStats(win, battle.combo, battle.correctCount, battle.wrongCount);
    var stats = getBattleStats();
    $('battle-stats').innerHTML =
      '<div class="bs-row"><span>本局答题</span><b>' + battle.correctCount + ' 对 / ' + battle.wrongCount + ' 错</b></div>' +
      '<div class="bs-row"><span>最高连击</span><b>' + battle.combo + '</b></div>' +
      '<div class="bs-row"><span>累计战绩</span><b>' + stats.wins + ' 胜 ' + stats.losses + ' 败</b></div>' +
      '<div class="bs-row"><span>历史最高连击</span><b>' + stats.bestCombo + '</b></div>';
    stopBgm();
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
    status.innerHTML = '<span class="loading-ring"></span> 六眼正在扫描截图中的单词…';
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
    var now = Date.now();
    var cnt = { total: 0, neww: 0, learning: 0, due: 0, mastered: 0 };
    wordBank.forEach(function (w) {
      cnt.total++;
      var s = w.state || {};
      if (!s.due || s.due === 0) cnt.neww++;
      else if (s.due <= now) cnt.due++;
      else if (s.ivl >= 7) cnt.mastered++;
      else cnt.learning++;
    });
    $('bank-total').textContent = cnt.total;
    $('bank-new').textContent = cnt.neww;
    $('bank-learning').textContent = cnt.learning;
    $('bank-due').textContent = cnt.due;
    $('bank-mastered').textContent = cnt.mastered;
    $('bank-list-count').textContent = wordBank.length;
    const box = $('bank-list');
    box.innerHTML = '';
    if (!wordBank.length) {
      box.innerHTML = '<div class="empty-state"><div class="empty-icon">🌀</div><h4>词库还是空的</h4><p>先去「六眼 · 识词」上传截图录入单词吧</p><button class="btn-link" data-goto="identify">去识词 →</button></div>';
      box.querySelector('[data-goto]')?.addEventListener('click', function(){ gotoCard('identify'); });
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
    // 游戏 - 难度选择
    document.querySelectorAll('.diff-card[data-diff]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var diff = btn.dataset.diff;
        var noMeaning = wordBank.filter(function (w) { return !w.meaning; }).map(function (w) { return w.word; });
        if (noMeaning.length && cfg.write.key) {
          fetchMeanings(noMeaning).then(function (meanings) {
            wordBank.forEach(function (w) {
              if (!w.meaning && meanings[w.word.toLowerCase()]) w.meaning = meanings[w.word.toLowerCase()];
            });
            saveWordBank();
            startBattle(diff);
          }).catch(function () { startBattle(diff); });
        } else {
          startBattle(diff);
        }
      });
    });
    $('btn-sound').addEventListener('click', toggleSound);
    $('btn-battle-again').addEventListener('click', function () {
      hideAllGameUI();
      if (battle) startBattle(battle.diff);
    });
    $('btn-battle-menu').addEventListener('click', function () {
      hideAllGameUI();
      showDifficultyMenu();
    });
    $('btn-battle-game-select').addEventListener('click', function () {
      hideAllGameUI();
      showGameSelect();
    });

    /* ===== 游戏选择 ===== */
    document.querySelectorAll('.game-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var game = card.dataset.game;
        if (game === 'battle') {
          showDifficultyMenu();
        } else if (game === 'speed') {
          startSpeedGame();
        } else if (game === 'match') {
          startMatchGame();
        } else if (game === 'rain') {
          startRainGame();
        }
      });
    });

    /* ===== 六眼·闪卡竞速 ===== */
    function startSpeedGame() {
      $('game-select').classList.add('hidden');
      $('speed-result').classList.add('hidden');
      $('speed-arena').classList.remove('hidden');
      speedGame = { time: 60, correct: 0, wrong: 0, combo: 0, maxCombo: 0, active: true, timer: null, current: null, used: [] };
      updateSpeedUI();
      nextSpeedQuestion();
      speedGame.timer = setInterval(function () {
        speedGame.time--;
        if (speedGame.time <= 0) {
          speedGame.time = 0;
          endSpeedGame();
          return;
        }
        updateSpeedUI();
      }, 1000);
    }
    function updateSpeedUI() {
      $('speed-time').textContent = speedGame.time;
      $('speed-correct').textContent = speedGame.correct;
      $('speed-wrong').textContent = speedGame.wrong;
      $('speed-combo').textContent = speedGame.combo;
      $('speed-timer-fill').style.width = (speedGame.time / 60 * 100) + '%';
      $('speed-timer-fill').style.background = speedGame.time > 20 ? 'var(--gojo-blue)' : speedGame.time > 10 ? '#e0a800' : 'var(--sukuna-red)';
    }
    function nextSpeedQuestion() {
      if (!speedGame || !speedGame.active) return;
      var pool = getGameWordPool(speedGame.used, 1);
      if (!pool.length) { speedGame.used = []; pool = getGameWordPool(speedGame.used, 1); }
      if (!pool.length) { endSpeedGame(); return; }
      var w = pool[0];
      speedGame.used.push(w.word.toLowerCase());
      speedGame.current = w;
      var opts = buildOptions(w, 4);
      $('speed-word').textContent = w.word;
      var oc = $('speed-options');
      oc.innerHTML = '';
      opts.forEach(function (opt) {
        var b = document.createElement('button');
        b.className = 'speed-opt';
        b.textContent = opt;
        b.addEventListener('click', function () {
          if (!speedGame.active) return;
          if (opt === w.meaning) {
            speedGame.correct++;
            speedGame.combo++;
            if (speedGame.combo > speedGame.maxCombo) speedGame.maxCombo = speedGame.combo;
            speedGame.time = Math.min(60, speedGame.time + 0.5);
            b.classList.add('opt-correct');
            applySm2(w, true);
            updateSpeedUI();
            setTimeout(function () { nextSpeedQuestion(); }, 200);
          } else {
            speedGame.wrong++;
            speedGame.combo = 0;
            speedGame.time = Math.max(0, speedGame.time - 3);
            b.classList.add('opt-wrong');
            var allOpts = oc.querySelectorAll('.speed-opt');
            allOpts.forEach(function (o) { if (o.textContent === w.meaning) o.classList.add('opt-correct'); });
            $('speed-word').innerHTML = '<span class="qword">' + escapeHtml(w.word) + '</span><span class="speed-answer">✅ ' + escapeHtml(w.meaning) + '</span>';
            applySm2(w, false);
            updateSpeedUI();
            setTimeout(function () { nextSpeedQuestion(); }, 1200);
          }
        });
        oc.appendChild(b);
      });
    }
    function endSpeedGame() {
      if (!speedGame) return;
      speedGame.active = false;
      if (speedGame.timer) clearInterval(speedGame.timer);
      var accuracy = speedGame.correct + speedGame.wrong > 0 ? Math.round(speedGame.correct / (speedGame.correct + speedGame.wrong) * 100) : 0;
      var best = parseInt(localStorage.getItem('cet4_speed_best') || '0', 10);
      var isNew = speedGame.correct > best;
      if (isNew) { localStorage.setItem('cet4_speed_best', speedGame.correct); best = speedGame.correct; }
      $('speed-emoji').textContent = isNew ? '⚡' : '👁️';
      $('speed-result-title').textContent = isNew ? '新纪录！' : '时间到';
      $('speed-result-stats').innerHTML = '<div class="result-stat"><span class="result-stat-val">' + speedGame.correct + '</span><span class="result-stat-label">答对</span></div><div class="result-stat"><span class="result-stat-val">' + speedGame.wrong + '</span><span class="result-stat-label">答错</span></div><div class="result-stat"><span class="result-stat-val">' + accuracy + '%</span><span class="result-stat-label">正确率</span></div><div class="result-stat"><span class="result-stat-val">' + speedGame.maxCombo + '</span><span class="result-stat-label">最高连击</span></div>';
      $('speed-best').textContent = '历史最高：' + best + ' 词';
      hideAllGameUI();
      $('speed-result').classList.remove('hidden');
    }
    $('btn-speed-quit').addEventListener('click', function () {
      if (speedGame) { speedGame.active = false; if (speedGame.timer) clearInterval(speedGame.timer); }
      hideAllGameUI();
      showGameSelect();
    });
    $('btn-speed-again').addEventListener('click', function () {
      hideAllGameUI();
      startSpeedGame();
    });
    $('btn-speed-menu').addEventListener('click', function () {
      hideAllGameUI();
      showGameSelect();
    });

    /* ===== 领域展开·记忆翻牌 ===== */
    function startMatchGame() {
      $('game-select').classList.add('hidden');
      $('match-result').classList.add('hidden');
      $('match-arena').classList.remove('hidden');
      var allWords = wordBank.filter(function (w) { return w.meaning; });
      if (allWords.length < 2) {
        $('match-board').innerHTML = '<p class="sub" style="text-align:center;padding:40px 0">词库不足 2 个词，请先添加更多单词</p>';
        matchGame = { active: false };
        return;
      }
      var pairCount = Math.min(8, allWords.length);
      var shuffled = allWords.slice();
      shuffle(shuffled);
      var pairs = shuffled.slice(0, pairCount).map(function (w) { return { word: w.word, meaning: w.meaning }; });
      var cards = [];
      pairs.forEach(function (p, i) {
        cards.push({ id: i, side: 'en', text: p.word });
        cards.push({ id: i, side: 'zh', text: p.meaning });
      });
      shuffle(cards);
      matchGame = { cards: cards, flipped: [], matched: new Set(), moves: 0, startTime: Date.now(), timer: null, active: true };
      $('match-pairs').textContent = '0/' + pairCount;
      updateMatchUI();
      var board = $('match-board');
      board.innerHTML = '';
      var cols = pairCount <= 4 ? 4 : 4;
      board.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
      cards.forEach(function (c, idx) {
        var el = document.createElement('div');
        el.className = 'match-card';
        el.dataset.idx = idx;
        el.addEventListener('click', function () { flipMatchCard(idx); });
        board.appendChild(el);
      });
      matchGame.timer = setInterval(function () { updateMatchUI(); }, 1000);
    }
    function updateMatchUI() {
      if (!matchGame) return;
      $('match-pairs').textContent = matchGame.matched.size + '/' + (matchGame.cards.length / 2);
      $('match-moves').textContent = matchGame.moves;
      $('match-time').textContent = Math.floor((Date.now() - matchGame.startTime) / 1000) + 's';
    }
    function flipMatchCard(idx) {
      if (!matchGame || !matchGame.active) return;
      if (matchGame.flipped.length >= 2) return;
      if (matchGame.flipped.indexOf(idx) >= 0) return;
      if (matchGame.matched.has(matchGame.cards[idx].id)) return;
      var el = $('match-board').children[idx];
      el.classList.add('flipped');
      el.textContent = matchGame.cards[idx].text;
      el.classList.add(matchGame.cards[idx].side === 'en' ? 'card-en' : 'card-zh');
      matchGame.flipped.push(idx);
      if (matchGame.flipped.length === 2) {
        matchGame.moves++;
        var a = matchGame.cards[matchGame.flipped[0]];
        var b = matchGame.cards[matchGame.flipped[1]];
        if (a.id === b.id && a.side !== b.side) {
          matchGame.matched.add(a.id);
          setTimeout(function () {
            matchGame.flipped.forEach(function (i) {
              $('match-board').children[i].classList.add('matched');
            });
            matchGame.flipped = [];
            updateMatchUI();
            if (matchGame.matched.size === matchGame.cards.length / 2) endMatchGame();
          }, 400);
        } else {
          setTimeout(function () {
            matchGame.flipped.forEach(function (i) {
              var e = $('match-board').children[i];
              e.classList.remove('flipped', 'card-en', 'card-zh');
              e.textContent = '';
            });
            matchGame.flipped = [];
          }, 800);
        }
        updateMatchUI();
      }
    }
    function endMatchGame() {
      if (!matchGame) return;
      matchGame.active = false;
      if (matchGame.timer) clearInterval(matchGame.timer);
      var time = Math.floor((Date.now() - matchGame.startTime) / 1000);
      var totalPairs = matchGame.cards.length / 2;
      var rating = time < 30 ? '领域展开！' : time < 60 ? '领域解除' : '领域崩溃';
      $('match-emoji').textContent = time < 30 ? '🌀' : time < 60 ? '✨' : '💫';
      $('match-result-title').textContent = rating;
      $('match-result-stats').innerHTML = '<div class="result-stat"><span class="result-stat-val">' + totalPairs + '</span><span class="result-stat-label">配对数</span></div><div class="result-stat"><span class="result-stat-val">' + matchGame.moves + '</span><span class="result-stat-label">翻牌数</span></div><div class="result-stat"><span class="result-stat-val">' + time + 's</span><span class="result-stat-label">用时</span></div>';
      hideAllGameUI();
      $('match-result').classList.remove('hidden');
    }
    $('btn-match-quit').addEventListener('click', function () {
      if (matchGame) { matchGame.active = false; if (matchGame.timer) clearInterval(matchGame.timer); }
      hideAllGameUI();
      showGameSelect();
    });
    $('btn-match-again').addEventListener('click', function () {
      hideAllGameUI();
      startMatchGame();
    });
    $('btn-match-menu').addEventListener('click', function () {
      hideAllGameUI();
      showGameSelect();
    });

    /* ===== 无量空处·单词雨 ===== */
    function startRainGame() {
      $('game-select').classList.add('hidden');
      $('rain-result').classList.add('hidden');
      $('rain-arena').classList.remove('hidden');
      rainGame = { score: 0, lives: 3, combo: 0, level: 1, active: true, drops: [], used: [], currentDrop: null, spawnTimer: null, tickTimer: null, spawnDelay: 2200, fallSpeed: 2.5, lastSpawn: Date.now() };
      updateRainUI();
      $('rain-zone').innerHTML = '';
      spawnRainDrop();
      rainGame.tickTimer = setInterval(function () { rainTick(); }, 50);
    }
    function updateRainUI() {
      if (!rainGame) return;
      $('rain-score').textContent = rainGame.score;
      $('rain-lives').textContent = rainGame.lives;
      $('rain-combo').textContent = rainGame.combo;
      $('rain-level').textContent = rainGame.level;
    }
    function spawnRainDrop() {
      if (!rainGame || !rainGame.active) return;
      var pool = getGameWordPool(rainGame.used, 1);
      if (!pool.length) { rainGame.used = []; pool = getGameWordPool(rainGame.used, 1); }
      if (!pool.length) return;
      var w = pool[0];
      rainGame.used.push(w.word.toLowerCase());
      rainGame.currentDrop = w;
      var opts = buildOptions(w, 4);
      var el = document.createElement('div');
      el.className = 'rain-drop';
      el.textContent = w.word;
      el.style.left = (Math.random() * 70 + 5) + '%';
      el.style.top = '-40px';
      $('rain-zone').appendChild(el);
      rainGame.drops.push({ el: el, word: w, y: -40, opts: opts });
      var oc = $('rain-options');
      oc.innerHTML = '';
      opts.forEach(function (opt) {
        var b = document.createElement('button');
        b.className = 'rain-opt';
        b.textContent = opt;
        b.addEventListener('click', function () {
          if (!rainGame.active) return;
          if (opt === w.meaning) {
            rainGame.score += 10 + rainGame.combo * 2;
            rainGame.combo++;
            if (rainGame.combo > 0 && rainGame.combo % 5 === 0) {
              rainGame.level++;
              rainGame.fallSpeed += 0.5;
              rainGame.spawnDelay = Math.max(1500, rainGame.spawnDelay - 200);
            }
            el.classList.add('rain-pop');
            applySm2(w, true);
            updateRainUI();
            setTimeout(function () { el.remove(); }, 300);
            rainGame.drops = rainGame.drops.filter(function (d) { return d.el !== el; });
            rainGame.lastSpawn = 0;
          } else {
            rainGame.combo = 0;
            rainGame.lives--;
            b.classList.add('opt-wrong');
            el.classList.add('rain-miss');
            var allOpts = oc.querySelectorAll('.rain-opt');
            allOpts.forEach(function (o) { if (o.textContent === w.meaning) o.classList.add('opt-correct'); });
            allOpts.forEach(function (o) { o.style.pointerEvents = 'none'; });
            el.innerHTML = w.word + '<br><span class="rain-answer">✅ ' + escapeHtml(w.meaning) + '</span>';
            el.style.borderColor = 'var(--sukuna-red)';
            applySm2(w, false);
            updateRainUI();
            if (rainGame.lives <= 0) {
              setTimeout(function () { endRainGame(); }, 1200);
              return;
            }
            setTimeout(function () {
              el.remove();
              rainGame.drops = rainGame.drops.filter(function (d) { return d.el !== el; });
              rainGame.lastSpawn = 0;
            }, 1200);
          }
        });
        oc.appendChild(b);
      });
    }
    function rainTick() {
      if (!rainGame || !rainGame.active) return;
      var zoneH = $('rain-zone').offsetHeight || 300;
      for (var i = rainGame.drops.length - 1; i >= 0; i--) {
        var d = rainGame.drops[i];
        if (d.el.classList.contains('rain-miss')) continue;
        d.y += rainGame.fallSpeed;
        d.el.style.top = d.y + 'px';
        if (d.y > zoneH - 50) {
          d.el.classList.add('rain-fall');
          rainGame.lives--;
          rainGame.combo = 0;
          applySm2(d.word, false);
          d.el.remove();
          rainGame.drops.splice(i, 1);
          updateRainUI();
          if (rainGame.lives <= 0) { endRainGame(); return; }
        }
      }
      var now = Date.now();
      if (rainGame.drops.length === 0 && now - rainGame.lastSpawn > 200) {
        rainGame.lastSpawn = now;
        spawnRainDrop();
      }
    }
    function endRainGame() {
      if (!rainGame) return;
      rainGame.active = false;
      if (rainGame.tickTimer) clearInterval(rainGame.tickTimer);
      var best = parseInt(localStorage.getItem('cet4_rain_best') || '0', 10);
      var isNew = rainGame.score > best;
      if (isNew) { localStorage.setItem('cet4_rain_best', rainGame.score); best = rainGame.score; }
      $('rain-emoji').textContent = isNew ? '💜' : '💫';
      $('rain-result-title').textContent = isNew ? '新纪录！' : '领域解除';
      $('rain-result-stats').innerHTML = '<div class="result-stat"><span class="result-stat-val">' + rainGame.score + '</span><span class="result-stat-label">得分</span></div><div class="result-stat"><span class="result-stat-val">' + rainGame.level + '</span><span class="result-stat-label">最高层级</span></div>';
      $('rain-best').textContent = '历史最高：' + best + ' 分';
      hideAllGameUI();
      $('rain-result').classList.remove('hidden');
    }
    $('btn-rain-quit').addEventListener('click', function () {
      if (rainGame) { rainGame.active = false; if (rainGame.tickTimer) clearInterval(rainGame.tickTimer); }
      hideAllGameUI();
      showGameSelect();
    });
    $('btn-rain-again').addEventListener('click', function () {
      hideAllGameUI();
      startRainGame();
    });
    $('btn-rain-menu').addEventListener('click', function () {
      hideAllGameUI();
      showGameSelect();
    });
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
