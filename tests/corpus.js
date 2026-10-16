/* Parse + run every .H under a folder, histogram the errors by line shape.
   AUTOTOOLS=1: tools missing from the table are created (as an import would), to see what else fails.
   node tests/corpus.js [dir]   (default: search-heidenhain/clones — local research, gitignored) */
const fs = require('fs'), { TNC: T } = require('../sim/engine.js');
const dir = process.argv[2] || __dirname + '/../search-heidenhain/clones';
if (!fs.existsSync(dir)) { console.log('corpus not found: ' + dir + ' (gitignored research, see README)'); process.exit(2); }
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(d + '/' + e.name) : /\.h$/i.test(e.name) ? [d + '/' + e.name] : []);
const files = walk(dir);   // node, not `find`: Windows has its own find.exe
let clean = 0, crash = 0; const H = {};
for (const f of files) {
  let r; try { r = T.run(fs.readFileSync(f, 'latin1'), { autoTools: !!process.env.AUTOTOOLS }); } catch (e) { crash++; const k = 'CRASH ' + e.message.slice(0, 60); H[k] = (H[k] || 0) + 1; continue; }
  if (!r.errors.length) clean++;
  for (const e of r.errors) { const b = r.blocks[e.block] || {}; const k = e.msg.replace(/\d+/g, '#').slice(0, 30).padEnd(30) + ' | ' + String(b.raw || '').replace(/^\d+\s+/, '').replace(/[-+]?\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').slice(0, 40); H[k] = (H[k] || 0) + 1; }
}
console.log(`${files.length} programs · ${clean} clean · ${files.length - clean - crash} with errors · ${crash} crashed`);
Object.entries(H).sort((a, b) => b[1] - a[1]).slice(0, +process.env.TOP || 25).forEach(([k, c]) => console.log(String(c).padStart(7), k));
