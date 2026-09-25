#!/usr/bin/env node
// Convert the single-file build (dist/index.html) into a page body suitable for hosts that
// wrap content in their own <!doctype>/<html>/<head>/<body> skeleton: keeps <title>, meta
// description, <style>, <link rel=icon>, <script> and the body markup, drops the wrappers.
//
// Usage: node tools/make-artifact.mjs [in=dist/index.html] [out=dist/apollo-lunar-landing.html]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inFile = path.resolve(root, process.argv[2] || 'dist/index.html');
const outFile = path.resolve(root, process.argv[3] || 'dist/apollo-lunar-landing.html');
const html = fs.readFileSync(inFile, 'utf8');

const head = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [, ''])[1];
const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, ''])[1];

// keep head elements except charset/viewport metas (the host provides them)
const keep = [];
const title = head.match(/<title>[\s\S]*?<\/title>/i);
if (title) keep.push(title[0]);
for (const m of head.matchAll(/<meta[^>]*name="description"[^>]*>/gi)) keep.push(m[0]);
for (const m of head.matchAll(/<link[^>]*rel="icon"[^>]*>/gi)) keep.push(m[0]);
for (const m of head.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)) keep.push(m[0]);
const scripts = [...head.matchAll(/<script[^>]*>[\s\S]*?<\/script>/gi)].map((m) => m[0]);

const out = [...keep, body.trim(), ...scripts].join('\n');
fs.writeFileSync(outFile, out);
console.log(`wrote ${path.relative(root, outFile)} (${(out.length / 1024).toFixed(0)} KB)`);
