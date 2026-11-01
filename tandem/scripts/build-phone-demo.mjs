#!/usr/bin/env node
/**
 * Turns the demo build (out/remote-demo) into one self-contained HTML file with the CSS and JS
 * inlined, suitable for hosting anywhere as a static page.
 *   node scripts/build-phone-demo.mjs [output.html]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const dir = join(root, 'out', 'remote-demo')
const out = resolve(process.argv[2] ?? join(root, 'out', 'phone-demo.html'))
const html = readFileSync(join(dir, 'index.html'), 'utf8')
const js = /<script[^>]+src="\.\/([^"]+\.js)"/.exec(html)?.[1]
const css = /<link[^>]+href="\.\/([^"]+\.css)"/.exec(html)?.[1]
if (!js) throw new Error('No script in demo build')
// U+FFFD appears inside library string literals; write it as a JS escape so the file stays clean text.
const script = readFileSync(join(dir, js), 'utf8').replace(/<\/script/gi, '<\\/script').replace(/\uFFFD/g, '\\uFFFD')
const style = css ? readFileSync(join(dir, css), 'utf8').replace(/<\/style/gi, '<\\/style') : ''
const page = `<title>Tandem Phone Remote</title>
<meta name="theme-color" content="#0a0b0f">
<style>
${style}
/* The host page already pads for the phone's safe areas. */
:root { --sat: 0px; --sab: 0px; }
</style>
<div id="root"></div>
<script type="module">
${script}
</script>
`
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, page)
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`)
