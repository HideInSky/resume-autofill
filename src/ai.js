// 让 AI 整理简历用的提示词和空白模板，都从字段定义生成，新增字段会自动带上。
// 资料页的「复制提示词」和云端解析服务器（server/，用 scripts/ai-prompt.mjs 生成）用的是同一份。
const aiField = (f) => !f.hidden && f.type !== 'tiers' && f.type !== 'region';
const AI_SECTIONS = () => RESUME_SCHEMA.sections.filter((s) => s.id !== 'account' && s.id !== 'custom');
function buildTemplate() {
  const out = {};
  for (const sec of AI_SECTIONS()) {
    const blank = Object.fromEntries(sec.fields.filter(aiField).map((f) => [f.key, '']));
    out[sec.id] = sec.repeat ? [blank] : blank;
  }
  return out;
}
function buildPrompt() {
  const lines = [
    '请阅读我提供的简历（PDF 或文字），把信息填进下面的 JSON 模板。只输出一个 JSON 代码块，不要输出其他文字。',
    '',
    '规则：',
    '1. 只填简历里明确写了的内容；没有的保持空字符串 ""，不要编造、不要猜。唯一的例外是标了「可推断」的字段，按说明从姓名推出来。',
    '2. 日期：年月写成 YYYY-MM，完整日期写成 YYYY-MM-DD；「至今」留空。',
    '3. 标了「数组」的段落，每段经历一个对象，按时间从近到远排列，字段和模板里的示例对象相同；没有的给空数组 []。',
    '4. 标了「只能填」的字段，只能填给出的选项之一，否则留空。',
    '5. 经历描述保留原文要点，多条用换行分隔，不要改写、不要加 Markdown 符号。',
    '6. 键名必须和模板完全一致，不要增删键。',
    '',
    '字段说明：',
  ];
  for (const sec of AI_SECTIONS()) {
    lines.push(`[${sec.id}] ${sec.title}${sec.repeat ? '（数组）' : ''}`);
    for (const f of sec.fields.filter(aiField)) {
      let note = f.label;
      if (f.ai) note += `（可推断：${f.ai}）`;
      if (f.type === 'select') note += `（只能填：${f.options.filter(Boolean).join(' / ')}）`;
      else if (f.type === 'month') note += '（YYYY-MM）';
      else if (f.type === 'date') note += '（YYYY-MM-DD）';
      else if (f.placeholder) note += `（${f.placeholder}）`;
      lines.push(`  ${f.key}: ${note}`);
    }
  }
  lines.push('', 'JSON 模板：', '```json', JSON.stringify(buildTemplate(), null, 2), '```');
  return lines.join('\n');
}
