/* =====================================================================
 * 单词短文 · 把今天的词串成故事  (PWA)
 * 上传学习截图 → 可配置的多模态大模型识图提取单词 → 生成英文短文+中文翻译
 * ===================================================================== */
(function () {
  'use strict';

  const STORE_KEY = 'cet4essay_cfg_v1';
  const HIST_KEY = 'cet4essay_hist_v1';

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
  let currentImage = null;   // dataURI

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
  function handleFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('请选择图片文件'); return; }
    // 只保留一张：每次替换 currentImage，不做多选
    const reader = new FileReader();
    reader.onload = () => {
      currentImage = reader.result;
      $('preview-img').src = currentImage;
      $('preview-box').classList.remove('hidden');
      $('upload-zone').classList.add('hidden');
      $('upload-text').textContent = '图片已就绪（一次一张，点「重选」换图）';
      refreshGenerateBtn();
      $('file-input').value = '';
    };
    reader.readAsDataURL(file);
  }
  function refreshGenerateBtn() {
    $('btn-generate').disabled = !(currentImage && cfg.key);
  }

  /* ---------- 生成短文 ---------- */
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // 把短文渲染成 DOM：目标词(**word**)高亮加粗、所有英文单词可点击查词
  function renderEssayDOM(text) {
    const frag = document.createDocumentFragment();
    const pattern = /(\*\*[^*]+\*\*)|([A-Za-z][A-Za-z'-]*)/g;
    let last = 0, m;
    while ((m = pattern.exec(text)) !== null) {
      if (m.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      if (m[1]) {
        // 目标词 → 高亮加粗
        const word = m[1].replace(/\*/g, '');
        const b = document.createElement('b');
        b.className = 'e-word target';
        b.dataset.word = word;
        b.textContent = word;
        frag.appendChild(b);
      } else if (m[2]) {
        // 普通英文单词 → 可点击查词
        const word = m[2];
        const span = document.createElement('span');
        span.className = 'e-word';
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
    '2. 用提取到的这些单词，写一篇 130~180 词的英文短文。要求：内容连贯、自然地道、适合中文大学生的四级阅读水平；每个目标单词在文中首次出现时用 **两个星号** 加粗包起来。',
    '3. 在短文之后另起一行写「===翻译===」，下面输出短文的完整中文翻译。',
    '',
    '请严格按以下格式输出，不要有多余解释：',
    '',
    '单词: word1, word2, word3',
    '',
    '短文:',
    '（英文短文，目标词用 **word** 加粗）',
    '',
    '===翻译===',
    '（中文翻译）'
  ].join('\n');

  async function generate() {
    if (!currentImage) return;
    if (!cfg.key) { openSettings(); alert('请先填写 API Key'); return; }
    if (!cfg.baseURL || !cfg.model) { openSettings(); alert('请先填写 baseURL 和模型名'); return; }

    const status = $('gen-status');
    status.classList.remove('hidden');
    status.classList.remove('error');
    status.textContent = '正在识别单词并生成短文，稍等几秒…';
    $('btn-generate').disabled = true;

    try {
      const url = cfg.baseURL.replace(/\/+$/, '') + '/chat/completions';
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
            content: [
              { type: 'image_url', image_url: { url: currentImage } },
              { type: 'text', text: PROMPT }
            ]
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

  function renderResult(text) {
    // 解析：单词清单 + 短文 + 翻译
    let wordsLine = '';
    let essay = text;
    let trans = '';

    const wordsMatch = text.match(/单词[:：]\s*([^\n]+)/);
    if (wordsMatch) wordsLine = wordsMatch[1].trim();

    // 分割短文与翻译
    let en = text;
    let cn = '';
    const sepIdx = text.indexOf('===翻译===');
    if (sepIdx >= 0) {
      en = text.slice(0, sepIdx);
      cn = text.slice(sepIdx + '===翻译==='.length);
    }
    // 去掉 "短文:" 标签
    en = en.replace(/^[\s\S]*?短文[:：]\s*/, '').trim();
    cn = cn.trim();

    $('essay-en').innerHTML = '';
    $('essay-en').appendChild(renderEssayDOM(en));
    $('essay-cn').textContent = cn;
    $('words-chip').textContent = wordsLine ? '目标单词：' + wordsLine : '';

    $('result-card').classList.remove('hidden');
    saveHistory(wordsLine, en, cn);
    $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 复制 ---------- */
  function copyAll() {
    const en = $('essay-en').innerText;
    const cn = $('essay-cn').textContent;
    const words = $('words-chip').textContent;
    const full = [words, '', en, '', '===翻译===', cn].filter(Boolean).join('\n');
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
  function showLookup(word, content) {
    $('lookup-word').textContent = word;
    $('lookup-body').textContent = content;
    $('lookup-mask').classList.remove('hidden');
  }
  function closeLookup() {
    $('lookup-mask').classList.add('hidden');
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
  function saveHistory(words, en, cn) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { /* ignore */ }
    list.unshift({
      date: new Date().toLocaleString('zh-CN'),
      words: words,
      en: en,
      cn: cn
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
      e.innerHTML = renderHighlightHtml(item.en);
      div.appendChild(d);
      div.appendChild(e);
      div.addEventListener('click', () => {
        $('essay-en').innerHTML = '';
        $('essay-en').appendChild(renderEssayDOM(item.en));
        $('essay-cn').textContent = item.cn;
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
      if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
    });
    // 也支持点击已选图片重新换图
    $('btn-remove').addEventListener('click', () => {
      currentImage = null;
      $('file-input').value = '';
      $('preview-box').classList.add('hidden');
      $('upload-zone').classList.remove('hidden');
      $('upload-text').textContent = '点这里，上传今天背单词的截图';
      refreshGenerateBtn();
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
