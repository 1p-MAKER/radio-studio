// 既存SRTファイルのタイムスタンプを修復するスクリプト
const fs = require('fs');
const filePath = process.argv[2];
if (!filePath) { console.error('Usage: node fix_srt.js <srt_file>'); process.exit(1); }

let content = fs.readFileSync(filePath, 'utf-8');

const fixed = content.replace(
    /(\d{1,2}(?::\d{1,2}){0,2}),(\d{3})\s*-->\s*(\d{1,2}(?::\d{1,2}){0,2}),(\d{3})/g,
    (match, start, startMs, end, endMs) => {
        const fixTime = (timeStr) => {
            const parts = timeStr.split(':').map(p => parseInt(p, 10));
            let h, m, s;
            if (parts.length === 3) { [h, m, s] = parts; }
            else if (parts.length === 2) { h = 0;[m, s] = parts; }
            else { h = 0; m = 0; s = parts[0]; }
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        };
        return `${fixTime(start)},${startMs} --> ${fixTime(end)},${endMs}`;
    }
);

fs.writeFileSync(filePath, fixed, 'utf-8');
console.log('修復完了:', filePath);

const lines = fixed.split('\n');
const timestamps = lines.filter(l => l.includes('-->'));
console.log('総エントリ数:', timestamps.length);
console.log('最初:', timestamps[0]);
console.log('最後:', timestamps[timestamps.length - 1]);
