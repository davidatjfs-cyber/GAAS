#!/usr/bin/env node
/**
 * AST-safe unused-vars cleanup driven by ESLint JSON report.
 * - ImportSpecifier / ImportDefaultSpecifier: remove binding (drop import if empty)
 * - ObjectPattern Property: rename local to _name (keeps key) — never deletes commas
 * - Function params (Identifier): rename to _name
 * - VariableDeclarator id Identifier: rename to _name
 */
import fs from 'node:fs';
import * as acorn from 'acorn';

const eslintPath = process.argv[2] || '/tmp/eslint-out.json';
const report = JSON.parse(fs.readFileSync(eslintPath, 'utf8'));

function unusedName(message) {
  const m = String(message || '').match(/^'([^']+)'/);
  return m ? m[1] : null;
}

function parse(source) {
  return acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    ranges: true,
    allowHashBang: true,
  });
}

function walk(node, fn, parent = null) {
  if (!node || typeof node !== 'object') return;
  fn(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn, node));
    else if (v && typeof v.type === 'string') walk(v, fn, node);
  }
}

/** Apply edits from end to start: [{start,end,text}] */
function applyEdits(source, edits) {
  edits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

function collectFixes(source, unusedAtLines) {
  // unusedAtLines: Map name -> Set(line numbers)
  const ast = parse(source);
  const edits = [];
  const importDecls = [];

  walk(ast, (node, parent) => {
    if (node.type === 'ImportDeclaration') importDecls.push(node);

    // ObjectPattern property: { name } or { name: local } or { name = def }
    if (node.type === 'Property' && parent?.type === 'ObjectPattern') {
      const keyName =
        node.key.type === 'Identifier' ? node.key.name : null;
      if (!keyName) return;
      const lines = unusedAtLines.get(keyName);
      if (!lines) return;
      const line = node.loc?.start?.line;
      if (!lines.has(line) && ![...lines].some((l) => Math.abs(l - line) <= 0)) {
        // also allow if any unused report for this name (line may drift)
        if (![...lines].some((l) => Math.abs(l - line) <= 2)) return;
      }

      if (node.value.type === 'Identifier') {
        if (node.value.name.startsWith('_')) return;
        if (node.shorthand) {
          // `{ name }` → `{ name: _name }`
          edits.push({
            start: node.value.start,
            end: node.value.end,
            text: `${keyName}: _${keyName}`,
          });
        } else {
          // `{ name: local }` → `{ name: _local }`
          edits.push({
            start: node.value.start,
            end: node.value.end,
            text: `_${node.value.name}`,
          });
        }
      } else if (node.value.type === 'AssignmentPattern' && node.value.left.type === 'Identifier') {
        const id = node.value.left;
        if (id.name.startsWith('_')) return;
        if (node.shorthand) {
          // `{ name = def }` → `{ name: _name = def }`
          edits.push({
            start: id.start,
            end: id.end,
            text: `${keyName}: _${keyName}`,
          });
        } else {
          edits.push({ start: id.start, end: id.end, text: `_${id.name}` });
        }
      }
      return;
    }

    // Function param Identifier
    if (
      node.type === 'Identifier' &&
      parent &&
      (parent.type === 'FunctionDeclaration' ||
        parent.type === 'FunctionExpression' ||
        parent.type === 'ArrowFunctionExpression') &&
      Array.isArray(parent.params) &&
      parent.params.includes(node)
    ) {
      const lines = unusedAtLines.get(node.name);
      if (!lines || node.name.startsWith('_')) return;
      if (![...lines].some((l) => Math.abs(l - node.loc.start.line) <= 1)) return;
      edits.push({ start: node.start, end: node.end, text: `_${node.name}` });
      return;
    }

    // const name = ...
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      !node.id.name.startsWith('_')
    ) {
      const lines = unusedAtLines.get(node.id.name);
      if (!lines) return;
      if (![...lines].some((l) => Math.abs(l - node.id.loc.start.line) <= 1)) return;
      edits.push({
        start: node.id.start,
        end: node.id.end,
        text: `_${node.id.name}`,
      });
    }
  });

  // Imports: remove unused specifiers
  for (const decl of importDecls) {
    const keep = [];
    let changed = false;
    for (const spec of decl.specifiers) {
      const local = spec.local?.name;
      if (!local) {
        keep.push(spec);
        continue;
      }
      const lines = unusedAtLines.get(local);
      if (lines && [...lines].some((l) => Math.abs(l - spec.loc.start.line) <= 1)) {
        changed = true;
        continue;
      }
      keep.push(spec);
    }
    if (!changed) continue;
    if (!keep.length) {
      // remove whole declaration including trailing newline
      let end = decl.end;
      if (source[end] === '\n') end++;
      edits.push({ start: decl.start, end, text: '' });
    } else {
      // rebuild named import clause only when all are ImportSpecifier
      const onlyNamed = keep.every((s) => s.type === 'ImportSpecifier');
      const hasDefault = keep.some((s) => s.type === 'ImportDefaultSpecifier');
      const hasNamespace = keep.some((s) => s.type === 'ImportNamespaceSpecifier');
      if (hasNamespace || (hasDefault && !onlyNamed && keep.length > 1)) {
        // complex — skip rewrite; leave for manual
        continue;
      }
      const src = decl.source.raw || JSON.stringify(decl.source.value);
      let text;
      if (keep.length === 1 && keep[0].type === 'ImportDefaultSpecifier') {
        text = `import ${keep[0].local.name} from ${src};`;
      } else if (onlyNamed) {
        const names = keep
          .map((s) =>
            s.imported.name === s.local.name
              ? s.local.name
              : `${s.imported.name} as ${s.local.name}`
          )
          .join(', ');
        text = `import { ${names} } from ${src};`;
      } else {
        continue;
      }
      edits.push({ start: decl.start, end: decl.end, text });
    }
  }

  return edits;
}

let filesChanged = 0;
let ops = 0;

for (const fileReport of report) {
  const errors = fileReport.messages.filter(
    (m) => m.severity === 2 && m.ruleId === 'no-unused-vars'
  );
  if (!errors.length) continue;

  const unusedAtLines = new Map();
  for (const m of errors) {
    const name = unusedName(m.message);
    if (!name || name.startsWith('_')) continue;
    if (!unusedAtLines.has(name)) unusedAtLines.set(name, new Set());
    unusedAtLines.get(name).add(m.line);
  }
  if (!unusedAtLines.size) continue;

  const filePath = fileReport.filePath;
  const original = fs.readFileSync(filePath, 'utf8');
  let source = original;

  try {
    const edits = collectFixes(source, unusedAtLines);
    if (!edits.length) continue;
    // Deduplicate overlapping edits by start
    const seen = new Set();
    const uniq = [];
    for (const e of edits.sort((a, b) => b.start - a.start)) {
      const k = `${e.start}:${e.end}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(e);
    }
    source = applyEdits(source, uniq);
    // verify parse
    parse(source);
    fs.writeFileSync(filePath, source);
    filesChanged++;
    ops += uniq.length;
    console.log('updated', filePath.replace(/.*\/GAAS\//, ''), 'edits', uniq.length);
  } catch (e) {
    console.error('SKIP', filePath.replace(/.*\/GAAS\//, ''), e.message);
  }
}

console.log(JSON.stringify({ filesChanged, ops }, null, 2));
