#!/usr/bin/env node
// made by gigacook — autosave-lint.mjs: finds writable text boxes on gigacook pages that do not use the autosave primitive
// (core\brand\components\autosave.js). Rule (owner, #282): any text in any writable text box is always autosaved.
//   node autosave-lint.mjs [file-or-folder ...] [--json]     default: the hub and core\brand. Exit 1 when there are findings.
// A box passes with data-autosave (the attribute), or GCAutosave.attach(<its id>) in the same file.
// Exempt (never autosaved on purpose): type password/search/hidden, API key / token / secret / confirm / search / filter / OTP
// fields (by type, id, name, aria-label, role, autocomplete only: never by words in class, placeholder or title), and anything marked data-autosave-exempt="why".
// Not text boxes: checkbox, radio, range, buttons, file, color, readonly, disabled. Boxes inside JS template strings count.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

const NOT_TEXT = /^(checkbox|radio|range|submit|button|reset|file|color|image|hidden|password|search|date|time|datetime-local|month|week)$/i;
const SECRETISH = /api[-_ ]?key|apikey|secret|token|passw|passcode|confirm|search|filter|one-time-code|otp\b|captcha|\bpin\b/i;
const SKIP_DIR = new Set(['node_modules', 'local', 'shots', 'out', '.git', 'unified-old']);

const attr = (a, n) => { const m = new RegExp('(?:^|\\s)' + n + '(?:\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+)))?(?=\\s|$|/)', 'i').exec(a); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null; };

export function lintText(text, file = '') {
  const out = [], line = i => text.slice(0, i).split('\n').length;
  const attachedIds = new Set([...text.matchAll(/GCAutosave\.(?:attach|watch|scan)\(\s*(?:document\.getElementById\(|\$\()?\s*['"]([\w-]+)['"]/g)].map(m => m[1]));
  const push = (m, kind, a) => {
    if (attr(a, 'data-autosave-exempt') !== null) return;
    if (/^\s*data-autosave\b(?!-)/.test(a) || /\sdata-autosave(?=[\s=/]|$)/i.test(a)) return;
    if (attr(a, 'readonly') !== null || attr(a, 'disabled') !== null) return;
    if (SECRETISH.test(['id', 'name', 'aria-label', 'autocomplete', 'role'].map(n => attr(a, n) ?? '').join(' '))) return;
    const id = attr(a, 'id'); if (id && attachedIds.has(id)) return;
    out.push({ file, line: line(m.index), tag: kind, id: id ?? undefined, reason: `writable ${kind} without data-autosave (add data-autosave="name", or data-autosave-exempt="why")` });
  };
  for (const m of text.matchAll(/<textarea\b([^>]*)>/gi)) push(m, 'textarea', m[1]);
  for (const m of text.matchAll(/<input\b([^>]*)>/gi)) { const t = attr(m[1], 'type'); if (t !== null && NOT_TEXT.test(t)) continue; push(m, 'input', m[1]); }
  for (const m of text.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\scontenteditable\b[^>]*)>/gi)) { const v = attr(m[2], 'contenteditable'); if (v !== null && /^false$/i.test(v)) continue; push(m, 'contenteditable', m[2]); }
  return out.sort((a, b) => a.line - b.line);
}

// JSX (.tsx/.jsx): a tag opens at <input|<textarea|<Input|<Textarea (and any tag with contentEditable) and ends at the first
// `>` outside braces/quotes (arrow functions put `=>` inside). <AutoText> is the autosaving box and is never flagged.
// Props are read as text: type="..", aria-label=".." (string only), id, readOnly, disabled, data-autosave, data-autosave-exempt.
export function lintJsx(text, file = '') {
  const out = [], line = i => text.slice(0, i).split('\n').length;
  // blank out comments so documentation that mentions <input> is not a box (same length, so line numbers stay)
  text = text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, (s, p) => (p ?? '') + s.slice((p ?? '').length).replace(/[^\n]/g, ' '));
  // Names bound to the autosave hooks in this file: `const x = useAutosave(..)`, `const [v, set, clear] = useDraft(..)`, `const d = x.value`.
  const hooks = new Set([...text.matchAll(/\bconst\s+(\w+)\s*=\s*useAutosave\s*\(/g)].map(r => r[1]));
  const drafts = new Set([...text.matchAll(/\bconst\s*\[\s*(\w+)\s*,[^\]]*\]\s*=\s*useDraft\s*\(/g)].map(r => r[1]));
  for (const r of text.matchAll(/\bconst\s+(\w+)\s*=\s*(\w+)\.value\b/g)) if (hooks.has(r[2])) drafts.add(r[1]);
  const bound = a => /\{\s*\.\.\.\s*\w+\.bind\s*\}/.test(a) || /\.setValue\s*\(/.test(a)
    || [...drafts].some(n => new RegExp('\\bvalue=\\{\\s*' + n + '\\s*\\}').test(a)) || [...hooks].some(n => new RegExp('\\bvalue=\\{\\s*' + n + '\\.value\\s*\\}').test(a));
  const re = /<([A-Za-z][\w.]*)(?=[\s/>])/g; let m;
  while ((m = re.exec(text))) {
    let i = m.index + m[0].length, depth = 0, q = null;
    for (; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || (c === '`' && depth > 0)) { q = c; continue; }
      if (c === '{') depth++; else if (c === '}') depth--;
      else if (c === '>' && depth === 0 && text[i - 1] !== '=') break;
    }
    const a = text.slice(m.index + m[0].length, i), tag = m[1];
    const isBox = /^(input|textarea)$/i.test(tag);
    const editable = /\bcontentEditable\b/.test(a) && !/contentEditable=(\{\s*false\s*\}|"false")/.test(a);
    if (!isBox && !editable) continue;
    if (/\bdata-autosave(-exempt)?\b/.test(a) || bound(a)) continue;
    if (/\b(readOnly|disabled)(?![\w=])/.test(a) || /\b(readOnly|disabled)=\{\s*true\s*\}/.test(a)) continue;
    const t = /\btype=(?:"([^"]*)"|\{\s*['"]([^'"]*)['"]\s*\})/.exec(a), type = t ? (t[1] ?? t[2]) : null;
    if (isBox && type && NOT_TEXT.test(type)) continue;
    const names = ['id', 'name', 'aria-label', 'autoComplete'].map(n => { const r = new RegExp('\\b' + n + '="([^"]*)"').exec(a); return r ? r[1] : ''; }).join(' ');
    if (SECRETISH.test(names + ' ' + (type ?? ''))) continue;
    out.push({ file, line: line(m.index), tag: isBox ? tag : 'contenteditable', reason: `writable <${isBox ? tag : tag + ' contentEditable'}> without autosave (use <AutoText>, or add data-autosave-exempt="why")` });
  }
  return out;
}

function* walk(p) {
  const st = fs.statSync(p);
  if (st.isFile()) { yield p; return; }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) yield* walk(path.join(p, e.name)); }
    else if (/\.(html?|m?js|tsx|jsx)$/i.test(e.name) && !/\.(test|spec)\.(m?js|tsx|jsx)$/i.test(e.name) && !/^(input|textarea|AutoText)\.tsx$/.test(e.name) && e.name !== 'autosave.js') yield path.join(p, e.name);
  }
}
export function lintPaths(paths) {
  const out = [];
  for (const p of paths) for (const f of walk(p)) out.push(...(/\.[tj]sx$/i.test(f) ? lintJsx : lintText)(fs.readFileSync(f, 'utf8'), f));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), json = args.includes('--json'), given = args.filter(a => !a.startsWith('--'));
  const gc = path.join(os.homedir(), 'gigacook');
  const f = lintPaths(given.length ? given : [path.join(gc, 'Dex', 'hub'), path.join(gc, 'core', 'brand')]);
  if (json) console.log(JSON.stringify(f, null, 2));
  else { for (const x of f) console.log(`${x.file}:${x.line}: ${x.reason}`); console.log(f.length ? `${f.length} writable text box(es) without autosave` : 'every writable text box has autosave'); }
  process.exit(f.length ? 1 : 0);
}
