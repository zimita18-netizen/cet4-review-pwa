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

  /* ---------- 预设模型模板 ---------- */
  const PRESETS = {
    glm: {
      name: 'GLM-4V-Flash（免费）',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4v-flash',
      textModel: 'glm-4-flash'
    },
    deepseek: {
      name: 'DeepSeek（VL）',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      textModel: 'deepseek-chat'
    },
    custom: {
      name: '自定义',
      baseURL: '',
      model: '',
      textModel: ''
    }
  };

  // 本地种子配置（js/config.js 由用户本地提供，含 key，不入库）
  const seed = (typeof window !== 'undefined' && window.CONFIG_SEED) || {};

  const DEFAULTS = {
    baseURL: PRESETS.glm.baseURL,
    model: PRESETS.glm.model,
    textModel: PRESETS.glm.textModel,
    key: seed.key || ''
  };

  let cfg = load();

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);

  /* ---------- 配置读写 ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return Object.assign({}, DEFAULTS);
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
    $('cfg-baseurl').value = cfg.baseURL;
    $('cfg-model').value = cfg.model;
    $('cfg-textmodel').value = cfg.textModel || '';
    $('cfg-key').value = cfg.key;
    highlightPreset();
  }
  function highlightPreset() {
    const btns = document.querySelectorAll('.preset');
    btns.forEach((b) => b.classList.remove('active'));
    let active = 'custom';
    if (cfg.baseURL === PRESETS.glm.baseURL && cfg.model === PRESETS.glm.model) active = 'glm';
    else if (cfg.baseURL === PRESETS.deepseek.baseURL && cfg.model === PRESETS.deepseek.model) active = 'deepseek';
    const target = document.querySelector('.preset[data-preset="' + active + '"]');
    if (target) target.classList.add('active');
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
    $('btn-generate').disabled = !(currentImages.length && cfg.key);
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

  const PROMPT = [
    '你是一名经验丰富的大学英语四级教师。请完成以下任务：',
    '',
    '1. 仔细识别图片中出现的所有「正在学习的英文单词或词组」。忽略界面按钮、中文释义、菜单等非学习内容，只提取用户要背的英文单词本身，并还原原形（如 studies→study）。',
    '2. 用上面提取到的【所有】单词（清单里的每一个都必须用到，一个都不能漏）写一篇英文短文，分成 4~5 个自然段，每段几句话，段与段之间用空行隔开，总词数 300 词左右（词多就写长，务必保证每个目标词都出现在短文里）。要求：内容连贯、自然地道、适合中文大学生的四级水平；每个用到的目标单词都用 **两个星号** 加粗包起来，保持原形不要变形。除目标词之外，短文用到的其它所有词汇必须严格控制在大学英语四级词汇范围内，只用简单常见的四级词，严禁使用考研、GRE、托福、雅思级别的生僻词、学术术语或文学性生词。',
    '3. 只输出英文短文，不要输出中文翻译（翻译由用户自己处理）。',
    '',
    '请严格按以下格式输出，不要有多余解释：',
    '',
    '单词: word1, word2, word3（务必列出图中识别到的全部单词，一个都不漏）',
    '',
    '短文:',
    '（第一段英文，目标词用 **word** 加粗）',
    '',
    '（第二段英文）',
    '',
    '（第三段英文）'
  ].join('\n');

  async function generate() {
    if (!currentImages.length) return;
    if (!cfg.key) { openSettings(); alert('请先填写 API Key'); return; }
    if (!cfg.baseURL || !cfg.model) { openSettings(); alert('请先填写 baseURL 和模型名'); return; }

    const status = $('gen-status');
    status.classList.remove('hidden');
    status.classList.remove('error');
    status.textContent = '正在识别 ' + currentImages.length + ' 张截图并生成短文，稍等几秒…';
    $('btn-generate').disabled = true;

    try {
      const url = cfg.baseURL.replace(/\/+$/, '') + '/chat/completions';
      // 多张图依次放入 content，再附文字指令
      const content = currentImages.map((uri) => ({ type: 'image_url', image_url: { url: uri } }));
      content.push({ type: 'text', text: PROMPT });
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.key
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [{
            role: 'user',
            content: content
          }],
          temperature: 0.7,
          max_tokens: 1024
        })
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error('调用失败(' + resp.status + ')：' + txt.slice(0, 200));
      }

      const data = await resp.json();
      const text = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : '';
      if (!text) throw new Error('模型没有返回内容');

      renderResult(text);
      status.classList.add('hidden');
    } catch (e) {
      status.classList.add('error');
      status.textContent = '出错：' + e.message + '\n（可检查 key / baseURL / 模型名是否正确）';
    } finally {
      refreshGenerateBtn();
    }
  }

  /* ---------- 分段解析：按空行切成英文段，翻译由前端逐段完成 ---------- */
  function parseParagraphs(raw) {
    return raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  }

  // 用文本模型翻译一段英文
  async function translateParagraph(en) {
    const model = cfg.textModel || cfg.model;
    const prompt = '把下面这段英文翻译成自然流畅的中文，只输出翻译结果，不要任何解释或原文：\n\n' + en;
    const url = cfg.baseURL.replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
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

  // 找出清单里没被短文用到的词
  function findMissingWords(words, paragraphs) {
    const allText = paragraphs.join(' ').toLowerCase().replace(/\*\*/g, '');
    return words.filter((w) => {
      if (w.length <= 2) return false;
      const forms = inflect(w);
      return !Array.from(forms).some((f) => {
        const re = new RegExp('\\b' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
        return re.test(allText);
      });
    });
  }

  // 用漏掉的词补写一小段，强制补全
  async function supplementParagraph(words) {
    const model = cfg.textModel || cfg.model;
    const prompt = '请用下面这些英文单词写一小段连贯的英文（2~4 句），把【每一个】单词都自然用上，句子地道、用词简单、四级水平、不超纲：\n' + words.join(', ');
    const url = cfg.baseURL.replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 500
      })
    });
    if (!resp.ok) throw new Error(resp.status);
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

  async function renderResult(text) {
    // 解析：单词清单 + 分段英文（翻译由前端逐段完成）
    let wordsLine = '';
    const wordsMatch = text.match(/单词[:：]\s*([^\n]+)/);
    if (wordsMatch) wordsLine = wordsMatch[1].trim();

    let body = text;
    const bodyMatch = text.match(/短文[:：]\s*([\s\S]*)$/);
    if (bodyMatch) body = bodyMatch[1];
    body = body.trim();

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

      // 漏词兜底：检测没用上的目标词，补写一小段强制用上
      const missing = findMissingWords(targetWords, paragraphs);
      if (missing.length) {
        try {
          $('gen-status').classList.remove('hidden');
          $('gen-status').textContent = '补充漏掉的目标词…(' + missing.join(', ') + ')';
          const supEn = await supplementParagraph(missing);
          if (supEn.trim()) {
            const supCn = await translateParagraph(supEn);
            segments.push({ en: supEn.trim(), cn: (supCn || '').trim() });
          }
        } catch (e2) { /* 补写失败则忽略 */ }
      }

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
    if (!cfg.key || !cfg.baseURL) {
      $('lookup-mask').classList.add('hidden');
      openSettings();
      alert('请先在设置里填写 API Key，才能点击查词');
      return;
    }
    const seq = ++lookupSeq;
    showLookup(word, '查询中…');
    const model = cfg.textModel || cfg.model;
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
      const url = cfg.baseURL.replace(/\/+$/, '') + '/chat/completions';
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
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

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    if (name === 'custom') {
      // 清空让用户自己填，但保留当前 key
      $('cfg-baseurl').value = '';
      $('cfg-model').value = '';
      $('cfg-textmodel').value = '';
    } else {
      $('cfg-baseurl').value = p.baseURL;
      $('cfg-model').value = p.model;
      $('cfg-textmodel').value = p.textModel || '';
    }
    highlightPreset();
  }

  function saveSettings() {
    cfg.baseURL = $('cfg-baseurl').value.trim();
    cfg.model = $('cfg-model').value.trim();
    cfg.textModel = $('cfg-textmodel').value.trim() || cfg.model;
    cfg.key = $('cfg-key').value.trim();
    saveCfg();
    refreshGenerateBtn();
    closeSettings();
    toast('设置已保存 ✓');
  }

  async function testConnection() {
    const baseURL = $('cfg-baseurl').value.trim();
    const model = $('cfg-model').value.trim();
    const key = $('cfg-key').value.trim();
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

    document.querySelectorAll('.preset').forEach((b) => {
      b.addEventListener('click', () => applyPreset(b.dataset.preset));
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
