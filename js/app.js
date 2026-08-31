/* =====================================================================
 * 单词巩固 · 每日趁热打铁  (PWA)
 * 配合「不背单词」App：背完当天新词后，花 60 秒趁热巩固。
 * ===================================================================== */
(function () {
  'use strict';

  /* ---------- 常量 ---------- */
  const WORDS = window.CET4_WORDS || [];
  const STORE_KEY = 'cet4gushu_v1';
  const DEFAULT_DAILY = 30;
  const HABIT_WINDOW = 7;          // 习惯记忆窗口（天）

  /* ---------- 状态 ---------- */
  let state = load();

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);

  /* ---------- 状态读写 ---------- */
  function defaultState() {
    return {
      cursor: 0,            // 词表进度：已背到第几个（0-based，指向下一个待巩固词）
      dailyNew: DEFAULT_DAILY,
      recentNew: [],        // 最近每天实际背的新词数
      wordStates: {},       // { [index]: {g, ivl, due, ease, seen} }
      plant: 0,             // 已认识词计数（植物成长）
      streak: 0,
      lastDate: '',
      log: {}               // { 'YYYY-MM-DD': { newCount, mode } }
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return Object.assign(defaultState(), s);
      }
    } catch (e) { /* ignore */ }
    return defaultState();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function nowTs() { return Date.now(); }
  function dayTs(t) { const d = new Date(t); d.setHours(0,0,0,0); return d.getTime(); }

  /* ---------- 习惯量 ---------- */
  function habitNew() {
    if (state.recentNew && state.recentNew.length) {
      const sum = state.recentNew.reduce((a, b) => a + b, 0);
      return Math.max(1, Math.round(sum / state.recentNew.length));
    }
    return state.dailyNew;
  }

  function wordAt(i) {
    return WORDS[i] || null;
  }
  function wordHead(i) {
    const w = wordAt(i);
    return w ? w[0] : '?';
  }

  /* ---------- 视图切换 ---------- */
  function show(id) {
    ['view-home', 'view-quiz', 'view-done', 'view-wordlist'].forEach((v) => {
      $(v).classList.toggle('hidden', v !== id);
    });
    window.scrollTo(0, 0);
  }

  /* =====================================================================
   * 锚点校正：词表浏览 + 搜索
   * ===================================================================== */
  function openWordlist() {
    $('wl-search').value = '';
    renderWordlist('');
    show('view-wordlist');
  }

  function renderWordlist(filter) {
    const box = $('wl-list');
    box.innerHTML = '';
    const f = (filter || '').trim().toLowerCase();
    let shown = 0;
    const MAX = 200;
    for (let i = 0; i < WORDS.length && shown < MAX; i++) {
      const w = WORDS[i];
      if (f && w[0].toLowerCase().indexOf(f) < 0) continue;
      shown++;
      const item = document.createElement('div');
      item.className = 'wl-item';
      const idxSpan = document.createElement('span');
      idxSpan.className = 'wl-idx';
      idxSpan.textContent = (i + 1);
      const wordSpan = document.createElement('span');
      wordSpan.className = 'wl-word';
      wordSpan.textContent = w[0];
      const transSpan = document.createElement('span');
      transSpan.className = 'wl-trans';
      transSpan.textContent = w[2] || '';
      item.appendChild(idxSpan);
      item.appendChild(wordSpan);
      item.appendChild(transSpan);
      item.addEventListener('click', () => setAnchor(i));
      box.appendChild(item);
    }
    if (shown === 0) {
      box.innerHTML = '<p class="sub" style="text-align:center;padding:20px">没找到，换个词试试（支持模糊搜索）</p>';
    }
  }

  function setAnchor(i) {
    // 把锚点设到该词之后（即"刚背完这个词"）
    state.cursor = i + 1;
    save();
    show('view-home');
    renderHome();
    $('sub-tip').textContent = '已对齐到「' + wordHead(i) + '」，下次从这里继续 ✅';
  }

  /* =====================================================================
   * 首页
   * ===================================================================== */
  let sliderN = DEFAULT_DAILY;   // 本次要巩固的新词数

  function renderHome() {
    updatePlant();
    $('greeting').textContent = '嗨，今天在不背单词背完新词了吗？';
    $('sub-tip').textContent = '背完后花 60 秒，把今天的新词锁进脑子。';

    // 锚点
    const cur = state.cursor;
    const anchorHead = cur > 0 ? wordHead(cur - 1) : '词表开头';
    $('anchor-word').textContent = anchorHead + '（第 ' + cur + ' 个）';

    // 滑块：默认习惯量
    sliderN = habitNew();
    const maxN = Math.max(40, sliderN * 2 + 10);
    const slider = $('end-slider');
    slider.max = Math.min(maxN, 100);
    if (sliderN > Number(slider.max)) slider.max = sliderN;
    slider.value = sliderN;
    updateRange(sliderN);

    // 统计
    const known = Object.keys(state.wordStates).filter((k) => {
      const s = state.wordStates[k];
      return s && s.g === 0;
    }).length;
    const dueCount = countDue();
    $('stat-known').textContent = known;
    $('stat-due').textContent = dueCount;
    $('stat-days').textContent = state.streak;
  }

  function updateRange(n) {
    n = Math.max(0, Math.min(n, state.dailyNew * 5 || 100));
    $('range-count').textContent = n + ' 个';
    const box = $('range-words');
    box.innerHTML = '';
    const start = state.cursor;
    const showN = Math.min(n, 24); // 最多展示 24 个词片
    for (let i = 0; i < showN; i++) {
      const w = wordAt(start + i);
      const span = document.createElement('span');
      span.className = 'w' + (i < n ? ' active' : '');
      span.textContent = w ? w[0] : '…';
      box.appendChild(span);
    }
    if (n > showN) {
      const more = document.createElement('span');
      more.className = 'w';
      more.textContent = '…+' + (n - showN);
      box.appendChild(more);
    }
  }

  function updatePlant() {
    const lv = 1 + Math.floor(state.plant / 100);
    const emojis = ['🌱', '🌿', '🌳', '🌲', '🍀', '🌸', '🌻', '⭐'];
    $('plant-emoji').textContent = emojis[Math.min(lv - 1, emojis.length - 1)];
    $('plant-level').textContent = 'Lv.' + lv;
  }

  /* ---------- 复习队列（到期词） ---------- */
  function countDue() {
    const t = nowTs();
    return Object.keys(state.wordStates).filter((k) => {
      const s = state.wordStates[k];
      return s && s.due && s.due <= t;
    }).length;
  }
  function dueIndices(limit) {
    const t = nowTs();
    const list = Object.keys(state.wordStates)
      .filter((k) => { const s = state.wordStates[k]; return s && s.due && s.due <= t; })
      .map(Number)
      .sort((a, b) => (state.wordStates[a].due - state.wordStates[b].due));
    return limit ? list.slice(0, limit) : list;
  }

  /* =====================================================================
   * 巩固流程
   * ===================================================================== */
  let quizList = [];       // 本轮要巩固的词 index 列表
  let quizMode = 'new';    // 'new' | 'review'
  let quizPos = 0;
  let gradeStats = { good: 0, mid: 0, bad: 0 };

  function startQuiz(mode) {
    quizMode = mode;
    gradeStats = { good: 0, mid: 0, bad: 0 };

    if (mode === 'new') {
      const start = state.cursor;
      quizList = [];
      for (let i = 0; i < sliderN; i++) {
        if (wordAt(start + i)) quizList.push(start + i);
      }
      // 只练有词的位置
      quizList = quizList.filter((idx) => wordAt(idx));
    } else {
      // 复习模式：到期词
      quizList = dueIndices(10);
    }

    if (!quizList.length) {
      if (mode === 'new') {
        $('greeting').textContent = '这段没有可巩固的词，先把锚点往后调一点？';
      } else {
        $('greeting').textContent = '今天没有到期要复习的词，太棒了！';
        $('sub-tip').textContent = '去不背单词背几个新词吧，或者休息一下～';
      }
      renderHome();
      show('view-home');
      return;
    }

    quizPos = 0;
    $('quiz-progress').textContent = '1 / ' + quizList.length;
    show('view-quiz');
    showFlip();
  }

  function showFlip() {
    $('stage-flip').classList.remove('hidden');
    $('stage-choice').classList.add('hidden');
    const idx = quizList[quizPos];
    const w = wordAt(idx);
    $('flip-word').textContent = w[0];
    $('flip-phone').textContent = w[1] ? '/' + w[1] + '/' : '';
    $('flip-trans').textContent = w[2];
    $('flip-sent-en').textContent = w[3] || '';
    $('flip-sent-cn').textContent = w[4] || '';
    $('flip-answer').classList.add('hidden');
    $('flip-btns').classList.add('hidden');
    $('btn-reveal').classList.remove('hidden');
  }

  function showChoice() {
    // 只对"模糊/不认识"的词出四选一；"认识"的跳过直接记录
    const idx = quizList[quizPos];
    const target = wordAt(idx);
    buildChoice(idx, target);
    $('stage-flip').classList.add('hidden');
    $('stage-choice').classList.remove('hidden');
  }

  /* ---------- 四选一出题 ---------- */
  function buildChoice(idx, target) {
    $('choice-word').textContent = target[0];
    $('choice-phone').textContent = target[1] ? '/' + target[1] + '/' : '';
    $('choice-feedback').classList.add('hidden');
    $('choice-feedback').innerHTML = '';
    $('btn-next').classList.add('hidden');

    // 生成 3 个干扰项（随机从其他词里取中文释义）
    const opts = [target[2]];
    let guard = 0;
    while (opts.length < 4 && guard < 200) {
      guard++;
      const ri = Math.floor(Math.random() * WORDS.length);
      if (ri === idx) continue;
      const cand = wordAt(ri);
      if (!cand || !cand[2]) continue;
      if (opts.indexOf(cand[2]) >= 0) continue;
      opts.push(cand[2]);
    }
    // 不足 4 个时补占位
    while (opts.length < 4) opts.push('（无释义）');
    // 洗牌
    shuffle(opts);

    const box = $('choice-options');
    box.innerHTML = '';
    opts.forEach((o) => {
      const btn = document.createElement('button');
      btn.className = 'opt';
      btn.textContent = o;
      btn.addEventListener('click', () => answerChoice(btn, o, target[2]));
      box.appendChild(btn);
    });
  }

  function answerChoice(btn, chosen, correct) {
    const opts = document.querySelectorAll('#choice-options .opt');
    opts.forEach((o) => o.classList.add('disabled'));
    const isRight = chosen === correct;
    if (isRight) {
      btn.classList.add('right');
      $('choice-feedback').classList.remove('hidden');
      $('choice-feedback').innerHTML = '✅ 正确答案：' + correct;
    } else {
      btn.classList.add('wrong');
      opts.forEach((o) => { if (o.textContent === correct) o.classList.add('right'); });
      $('choice-feedback').classList.remove('hidden');
      $('choice-feedback').innerHTML = '❌ 正确是：' + correct;
    }
    // 记录：答对算"认识"，答错算"模糊"
    const idx = quizList[quizPos];
    if (isRight) {
      gradeStats.good++;
      scheduleWord(idx, 0);
    } else {
      gradeStats.mid++;
      scheduleWord(idx, 1);
    }
    $('btn-next').classList.remove('hidden');
  }

  /* ---------- 评分 → 间隔调度（简化 SM-2） ---------- */
  function scheduleWord(idx, grade) {
    const cur = state.wordStates[idx] || { g: 1, ivl: 0, ease: 2.5, seen: 0, due: 0 };
    cur.seen = (cur.seen || 0) + 1;
    let ivl, ease = cur.ease;
    if (grade === 0) {           // 认识
      ease = Math.min(3.0, ease + 0.1);
      ivl = cur.ivl === 0 ? 3 : Math.round(cur.ivl * ease);
    } else if (grade === 1) {    // 模糊
      ease = Math.max(1.3, ease - 0.2);
      ivl = 1;
    } else {                     // 不认识
      ease = Math.max(1.3, ease - 0.3);
      ivl = 0;
    }
    cur.g = grade;
    cur.ease = ease;
    cur.ivl = ivl;
    cur.due = nowTs() + ivl * 86400000;
    state.wordStates[idx] = cur;
    if (grade === 0) state.plant += 1;
  }

  /* ---------- 流程推进 ---------- */
  function onGrade(grade) {
    const idx = quizList[quizPos];
    if (grade === 0) gradeStats.good++;
    else if (grade === 1) gradeStats.mid++;
    else gradeStats.bad++;
    scheduleWord(idx, grade);

    if (grade === 0) {
      nextQuiz();               // 认识的直接下一个
    } else {
      showChoice();             // 模糊/不认识 → 四选一加深
    }
  }

  function gotoNext() {
    nextQuiz();
  }

  function nextQuiz() {
    quizPos++;
    if (quizPos >= quizList.length) {
      finishQuiz();
      return;
    }
    $('quiz-progress').textContent = (quizPos + 1) + ' / ' + quizList.length;
    showFlip();
  }

  function finishQuiz() {
    // 新词模式：推进 cursor
    if (quizMode === 'new') {
      const start = state.cursor;
      state.cursor = start + sliderN;
      state.recentNew.push(sliderN);
      if (state.recentNew.length > HABIT_WINDOW) state.recentNew.shift();
      state.log[today()] = { newCount: sliderN, mode: 'new' };
    } else {
      state.log[today()] = { newCount: 0, mode: 'review' };
    }
    // 坚持天数
    const t = today();
    if (state.lastDate !== t) {
      if (state.lastDate) {
        const diff = (dayTs(new Date()) - dayTs(new Date(state.lastDate))) / 86400000;
        state.streak = diff === 1 ? state.streak + 1 : 1;
      } else {
        state.streak = 1;
      }
      state.lastDate = t;
    }
    save();
    renderDone();
    show('view-done');
  }

  function renderDone() {
    const total = gradeStats.good + gradeStats.mid + gradeStats.bad;
    const goodRate = total ? Math.round(gradeStats.good / total * 100) : 0;
    let emoji, title;
    if (gradeStats.bad === 0 && gradeStats.mid === 0) { emoji = '🌟'; title = '全对，漂亮！'; }
    else if (goodRate >= 70) { emoji = '✨'; title = '很棒，继续保持！'; }
    else { emoji = '💪'; title = '稳住，明天就熟了！'; }
    $('done-emoji').textContent = emoji;
    $('done-title').textContent = title;
    $('done-text').textContent = quizMode === 'new'
      ? '今天 ' + quizList.length + ' 个新词已过了一遍。'
      : '今天复习了 ' + quizList.length + ' 个难点词。';
    $('done-stats').innerHTML =
      '<span class="chip">认识 <b>' + gradeStats.good + '</b></span>' +
      '<span class="chip">模糊 <b>' + gradeStats.mid + '</b></span>' +
      '<span class="chip">不认识 <b>' + gradeStats.bad + '</b></span>';
  }

  /* =====================================================================
   * 导出 / 导入
   * ===================================================================== */
  function doExport() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '单词巩固备份-' + today() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function doImport(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const s = JSON.parse(reader.result);
        state = Object.assign(defaultState(), s);
        save();
        renderHome();
        $('sub-tip').textContent = '已导入备份 ✅';
      } catch (e) {
        alert('导入失败：文件格式不对');
      }
    };
    reader.readAsText(file);
  }

  /* =====================================================================
   * 工具
   * ===================================================================== */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /* =====================================================================
   * 事件绑定
   * ===================================================================== */
  function bind() {
    $('end-slider').addEventListener('input', (e) => {
      sliderN = Number(e.target.value);
      updateRange(sliderN);
      $('range-count').textContent = sliderN + ' 个';
    });

    $('btn-start').addEventListener('click', () => startQuiz('new'));
    $('btn-review-only').addEventListener('click', () => startQuiz('review'));

    $('btn-reveal').addEventListener('click', () => {
      $('btn-reveal').classList.add('hidden');
      $('flip-answer').classList.remove('hidden');
      $('flip-btns').classList.remove('hidden');
    });
    document.querySelectorAll('[data-grade]').forEach((b) => {
      b.addEventListener('click', () => onGrade(Number(b.dataset.grade)));
    });
    $('btn-next').addEventListener('click', gotoNext);
    $('btn-home').addEventListener('click', () => { renderHome(); show('view-home'); });

    $('btn-export').addEventListener('click', doExport);
    $('btn-import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) doImport(e.target.files[0]);
      e.target.value = '';
    });

    // 锚点校正
    $('btn-align').addEventListener('click', openWordlist);
    $('btn-wl-back').addEventListener('click', () => { renderHome(); show('view-home'); });
    $('wl-search').addEventListener('input', (e) => renderWordlist(e.target.value));
  }

  /* =====================================================================
   * 初始化
   * ===================================================================== */
  function init() {
    bind();
    renderHome();
    show('view-home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
