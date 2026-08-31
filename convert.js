const fs = require('fs');

const raw = fs.readFileSync('C:/Users/qwera/Documents/四级单词巩固/raw_cet4.jsonl', 'utf8');
const lines = raw.split('\n').filter(Boolean);

const out = [];
let skipped = 0;

for (const line of lines) {
  let o;
  try { o = JSON.parse(line); } catch (e) { skipped++; continue; }
  const w = o.content && o.content.word;
  const c = w && w.content;
  if (!c) { skipped++; continue; }

  const word = w.wordHead || '';
  const rank = o.wordRank || 0;

  let phone = c.usphone || c.phone || c.ukphone || '';
  // 音标去掉空格，保留美音为主
  phone = phone.replace(/;/g, '，').trim();

  let trans = '';
  if (c.trans && c.trans.length) {
    trans = c.trans.map(t => ((t.pos ? t.pos + '. ' : '') + (t.tranCn || ''))).join('；');
  }
  // 去重多余空白
  trans = trans.replace(/\s+/g, ' ').trim();

  let sent = '', sentCn = '';
  if (c.sentence && c.sentence.sentences && c.sentence.sentences.length) {
    sent = (c.sentence.sentences[0].sContent || '').replace(/<[^>]+>/g, '').trim();
    sentCn = (c.sentence.sentences[0].sCn || '').trim();
  }

  let rem = '';
  if (c.remMethod && c.remMethod.val) {
    rem = c.remMethod.val.replace(/\s+/g, '').trim();
  }

  out.push([word, phone, trans, sent, sentCn, rem]);
}

// 按 rank 排序
out.sort((a, b) => (a.__r || 0) - (b.__r || 0));

const js = 'window.CET4_WORDS=' + JSON.stringify(out) + ';';
fs.writeFileSync('C:/Users/qwera/Documents/四级单词巩固/words.js', js, 'utf8');

const size = fs.statSync('C:/Users/qwera/Documents/四级单词巩固/words.js').size;
console.log('总词条: ' + out.length + '  跳过: ' + skipped + '  words.js 大小: ' + (size / 1024 / 1024).toFixed(2) + ' MB');
console.log('样例: ' + JSON.stringify(out[0]));
console.log('样例2: ' + JSON.stringify(out[100]));
