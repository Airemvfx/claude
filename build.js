#!/usr/bin/env node
/* Concatenates src/*.js into the single self-contained index.html. */
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, 'src');
const files = fs.readdirSync(SRC).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
const js = files.map(f => `\n/* ===== ${f} ===== */\n` + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
const tpl = fs.readFileSync(path.join(SRC, 'shell.html'), 'utf8');
const out = tpl.replace('/*__BUNDLE__*/', () => js);
fs.writeFileSync(path.join(__dirname, 'index.html'), out);
console.log(`built index.html  (${files.length} modules, ${(out.length/1024).toFixed(1)} KB)`);
