const https = require('https');
const fs = require('fs');

// 四级词库（正序版）
const url = 'https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/full_line_jsonl/full/%E6%AD%A3%E5%BA%8F/%E5%9B%9B%E7%BA%A7.jsonl';
const out = 'C:/Users/qwera/Documents/四级单词巩固/raw_cet4.jsonl';

function get(u, cb) {
  https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
      get(r.headers.location, cb);
      return;
    }
    cb(r);
  }).on('error', (e) => { console.error('ERR', e.message); process.exit(1); });
}

get(url, (r) => {
  const ws = fs.createWriteStream(out);
  r.pipe(ws);
  ws.on('finish', () => {
    const size = fs.statSync(out).size;
    const lines = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).length;
    console.log('DONE size=' + size + ' lines=' + lines);
    ws.close();
  });
  r.on('error', (e) => { console.error('ERR', e.message); process.exit(1); });
});
