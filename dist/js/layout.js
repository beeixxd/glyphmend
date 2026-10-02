// 纯函数文字排版：换行规则（中日韩逐字、西文按词、标点避头），供预览、导出、内联估算共用。
export const isCJK = ch => /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f\u3040-\u30ff\uac00-\ud7af]/.test(ch);
const NO_LINE_START = new Set(Array.from('，。、！？；：）】」』》〕〉,.!?;:)]}%‰′″…—·'));
const NO_LINE_END = new Set(Array.from('（【「『《〔〈([{'));

function units(text) {
  const out = [];
  const chars = Array.from(text);
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (isCJK(ch) || /\s/.test(ch)) { out.push(ch); i++; continue; }
    let j = i, word = '';
    while (j < chars.length && !isCJK(chars[j]) && !/\s/.test(chars[j])) { word += chars[j]; j++; }
    out.push(word); i = j;
  }
  return out;
}

/**
 * 按最大宽度换行。measure(str) 返回该字符串（含字距）的宽度。
 * 返回字符串数组；单个超宽单词会按字符强制断开。空串保留为空行。
 */
export function wrapText(text, measure, maxWidth) {
  const result = [];
  for (const para of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (!(maxWidth > 0) || measure(para) <= maxWidth) { result.push(para); continue; }
    let line = '';
    const push = () => { result.push(line.replace(/\s+$/, '')); line = ''; };
    const place = u => {
      if (/^\s+$/.test(u)) { line += u; return; }
      const trial = line + u;
      if (!line || measure(trial.replace(/\s+$/, '')) <= maxWidth) { line = trial; return; }
      // 避头：行首不能是闭标点——把它挂在上一行
      if (NO_LINE_START.has(Array.from(u)[0]) && result.length >= 0 && line) { line = trial; return; }
      push();
      line = u;
    };
    for (const u of units(para)) {
      if (Array.from(u).length > 1 && measure(u) > maxWidth) { // 超宽单词：逐字符强拆
        for (const ch of Array.from(u)) place(ch);
      } else place(u);
      // 避尾：行尾不能是开标点——把它挪到下一行
      const chars = Array.from(line);
      if (chars.length > 1 && NO_LINE_END.has(chars[chars.length - 1]) && measure(line) > maxWidth) {
        const last = chars.pop(); line = chars.join(''); push(); line = last;
      }
    }
    if (line.length || !result.length) push();
  }
  return result;
}
export default { wrapText, isCJK };
