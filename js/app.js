/* =====================================================================
 * 单词短文 · 把今天的词串成故事  (PWA)
 * 上传学习截图 → 可配置的多模态大模型识图提取单词 → 生成英文短文+中文翻译
 * ===================================================================== */
(function () {
  'use strict';

  const STORE_KEY = 'cet4essay_cfg_v1';
  const HIST_KEY = 'cet4essay_hist_v1';
  const MARK_KEY = 'cet4essay_mark_v1';

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

  function init() {
    bind();
    loadHistory();
    syncCfgToUI();
    refreshGenerateBtn();
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
      refreshGenerateBtn();
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
    refreshGenerateBtn();
  }

  function refreshGenerateBtn() {
    $('btn-generate').disabled = !(currentImages.length && cfg.vision.key && cfg.write.key);
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
    if (!currentImages.length) return;
    if (!cfg.vision.key || !cfg.write.key) { openSettings(); alert('请先在设置里填好「识图模型」和「写文模型」的 key'); return; }
    if (!cfg.vision.baseURL || !cfg.vision.model || !cfg.write.baseURL || !cfg.write.model) { openSettings(); alert('请先填全识别/写文模型的地址和模型名'); return; }

    const status = $('gen-status');
    status.classList.remove('hidden');
    status.classList.remove('error');
    $('btn-generate').disabled = true;

    try {
      // 第一步：识图拿单词清单
      status.textContent = '① 正在识别截图中的单词…';
      const wordsLine = await callVision();

      // 第二步：写短文
      status.textContent = '② 正在根据单词生成短文…';
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

  /* ---------- 分段解析：按空行切成英文段，翻译由前端逐段完成 ---------- */
  function parseParagraphs(raw) {
    return raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  }

  // 用写文模型翻译一段英文
  async function translateParagraph(en) {
    const model = cfg.write.model;
    const prompt = '把下面这段英文翻译成自然流畅的中文，只输出翻译结果，不要任何解释或原文：\n\n' + en;
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
    return (data.choices && data.choices[0].message && data.choices[0].message.content) || '';
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
        eye.textContent = '👁 翻译';
        const cn = document.createElement('div');
        cn.className = 'para-cn hidden-cn';
        cn.textContent = seg.cn;
        eye.addEventListener('click', () => {
          const hidden = cn.classList.contains('hidden-cn');
          cn.classList.toggle('hidden-cn', !hidden);
          eye.textContent = hidden ? '🙈 收起' : '👁 翻译';
        });
        para.appendChild(eye);
        para.appendChild(cn);
      }
      box.appendChild(para);
    });
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
    $('words-chip').textContent = wordsLine ? '目标单词：' + wordsLine : '';
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
    list.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'history-item';
      const d = document.createElement('div');
      d.className = 'h-date';
      d.textContent = item.date + (item.words ? ' · ' + item.words : '');
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
        $('words-chip').textContent = item.words ? '目标单词：' + item.words : '';
        $('result-card').classList.remove('hidden');
        $('history-mask').classList.add('hidden');
        $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      box.appendChild(div);
    });
  }

  /* ---------- 设置 ---------- */
  function openSettings() { $('settings-mask').classList.remove('hidden'); }
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
    $('file-input').addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length) handleFiles(e.target.files);
    });
    // 清空重选
    $('btn-remove').addEventListener('click', () => {
      currentImages = [];
      $('file-input').value = '';
      $('preview-grid').innerHTML = '';
      $('upload-text').textContent = '点这里，上传今天背单词的截图';
      renderPreview();
    });

    $('btn-generate').addEventListener('click', generate);

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
