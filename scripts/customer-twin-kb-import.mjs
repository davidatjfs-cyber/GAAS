/**
 * 顾客孪生·岗位教练知识库导入准备（dry-run）
 * 把 /Users/xieding/GAAS知识库内容 下的手册按章节拆分，打技能标签，
 * 输出拆分报告（默认不写数据库；--write 才写 knowledge_base）。
 * 用法：node scripts/customer-twin-kb-import.mjs [--dir=路径] [--write]
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DIR = '/Users/xieding/GAAS知识库内容';

// 手册文件 → 主技能 + 章节级附加技能
const SKILL_MAP = {
  '中餐烹饪知识手册.md': { skill: '烹饪知识', extra: ['菜品介绍'] },
  '餐厅原材料采购手册.md': { skill: '原材料知识', extra: ['出品质量'] },
  '餐厅忌口与点单问询手册.md': { skill: '忌口知识', extra: ['食安事件'] },
  '餐厅出品质量管理手册.md': { skill: '出品质量', extra: ['与厨房配合', '堂食客诉'] },
  '餐厅前厅后厨联动手册.md': { skill: '与厨房配合', extra: ['堂食客诉', '推销'] },
  '餐厅外卖异常处理手册.md': { skill: '外卖异常', extra: ['外卖客诉'] },
  '餐厅推销与销售运营手册.md': { skill: '推销', extra: ['菜品介绍'] },
  '餐厅桌访顾客回访手册.md': { skill: '桌访', extra: ['堂食客诉'] },
  '餐厅迎宾与服务标准手册.md': { skill: '迎宾', extra: [] },
  '餐厅食品安全手册.md': { skill: '食安知识', extra: ['食安事件'] },
  '招牌菜品介绍话术.md': { skill: '菜品介绍', extra: ['菜品知识'] },
};

// 章节标题关键词 → 附加技能（覆盖手册级默认）
const CHAPTER_EXTRA = {
  '沽清': ['推销'],
  '催单': ['堂食客诉'],
  '错菜': ['堂食客诉'],
  '退菜': ['堂食客诉'],
  '过敏': ['食安事件'],
  '异物': ['食安事件'],
  '会员': ['推销'],
  '充值': ['推销'],
};

function splitChapters(text) {
  const lines = text.split('\n');
  const chapters = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      if (current && current.title !== '目录') chapters.push(current);
      current = { title: m[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current && current.title !== '目录') chapters.push(current);
  return chapters.map((c) => ({
    title: c.title,
    content: c.body.join('\n').trim(),
    lines: c.body.length,
  })).filter((c) => c.content);
}

function extraSkills(title) {
  const found = new Set();
  for (const [kw, skills] of Object.entries(CHAPTER_EXTRA)) {
    if (title.includes(kw)) skills.forEach((s) => found.add(s));
  }
  return [...found];
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dir = DEFAULT_DIR;
  let write = false;
  for (const a of args) {
    if (a.startsWith('--dir=')) dir = a.slice(6);
    if (a === '--write') write = true;
  }
  return { dir, write };
}

const { dir, write } = parseArgs();
const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
const records = [];
const report = { files: [] };

for (const file of files) {
  const text = readFileSync(join(dir, file), 'utf8');
  const map = SKILL_MAP[file] || { skill: '未映射', extra: [] };
  const chapters = splitChapters(text);
  if (!chapters.length) {
    // 无章节（如纯表格）→ 整份一条
    records.push({
      title: file.replace('.md', ''),
      content: text.trim(),
      skills: [map.skill, ...(map.extra || [])],
      file,
    });
    report.files.push({ file, chapters: 1, skills: [map.skill, ...(map.extra || [])], note: '无章节，整份一条' });
    continue;
  }
  const fileSkills = new Set([map.skill, ...(map.extra || [])]);
  for (const ch of chapters) {
    const extra = extraSkills(ch.title);
    const skills = [...new Set([...fileSkills, ...extra])];
    records.push({
      title: `${file.replace('.md', '')} · ${ch.title}`,
      content: ch.content,
      skills,
      file,
    });
  }
  report.files.push({ file, chapters: chapters.length, skills: [...fileSkills], sample: `${chapters[0].title}（${chapters[0].lines} 行）` });
}

report.total_records = records.length;
report.skill_coverage = {};
for (const r of records) {
  for (const s of r.skills) report.skill_coverage[s] = (report.skill_coverage[s] || 0) + 1;
}

console.log(JSON.stringify({
  files: report.files.map((f) => `${f.file} → ${f.chapters} 章 [${f.skills.join(',')}]${f.note ? '（' + f.note + '）' : ''}`),
  total_records: report.total_records,
  skill_coverage: report.skill_coverage,
}, null, 1));

writeFileSync(join(process.cwd(), 'docs', 'customer-twin-kb-import-dryrun.json'), JSON.stringify(report, null, 2) + '\n');
console.log('dry-run 报告已写入 docs/customer-twin-kb-import-dryrun.json');

if (write) {
  console.error('--write 尚未实现（待确认导入目标后接入 knowledge_base）');
  process.exit(2);
}
