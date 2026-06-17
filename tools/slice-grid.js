#!/usr/bin/env node
/**
 * 把一张「九宫格动作图」清洗成可直接做桌宠的素材。
 * 解决三件事：① 去掉每格的编号角标/网格线（边缘内缩 inset）；
 *            ② 可选去背景（从四角洪水填充，近纯色背景效果最好）；
 *            ③ 重新拼成一张干净的 3×3 透明 PNG，丢回 App「⬆️ 上传九宫格」即可。
 * 依赖 ImageMagick（magick）。
 *
 *   node tools/slice-grid.js 剑舞.png                 # 默认 inset 6%
 *   node tools/slice-grid.js 剑舞.png --inset 10      # 角标/边线粗一点就调大（百分比）
 *   node tools/slice-grid.js 剑舞.png --debg          # 顺便去背景（近纯色背景才干净）
 *   node tools/slice-grid.js 剑舞.png --out ~/Desktop/clean
 *
 * 产物：<out>/frame-0..8.png（9 帧）+ <out>/clean-grid.png（重拼的干净九宫格）。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
if (!input || !fs.existsSync(input)) {
  console.error('用法：node tools/slice-grid.js <九宫格图> [--inset 6] [--debg] [--out 目录]');
  process.exit(1);
}
const getOpt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def; };
const insetPct = parseFloat(getOpt('inset', '6')) || 0;
const debg = args.includes('--debg');
const outDir = path.resolve(getOpt('out', path.join(path.dirname(input), 'clean-grid-out')));

const has = (b) => { try { execFileSync('command', ['-v', b], { stdio: 'ignore', shell: '/bin/bash' }); return true; } catch { return false; } };
const MAGICK = has('magick') ? 'magick' : (has('convert') ? 'convert' : null);
if (!MAGICK) { console.error('✗ 需要 ImageMagick：brew install imagemagick'); process.exit(1); }
const m = (...a) => execFileSync(MAGICK, a, { stdio: ['ignore', 'ignore', 'inherit'] });
const out = (...a) => execFileSync(MAGICK, a, { encoding: 'utf8' });

fs.mkdirSync(outDir, { recursive: true });
const [W, H] = out('identify', '-format', '%w %h', input).trim().split(/\s+/).map(Number);
const tw = Math.floor(W / 3), th = Math.floor(H / 3);
const insX = Math.round(tw * insetPct / 100), insY = Math.round(th * insetPct / 100);
const cw = tw - insX * 2, ch = th - insY * 2;
const S = Math.min(cw, ch); // 每帧统一成正方形画布，跳舞时不会忽大忽小

console.log(`原图 ${W}×${H} → 单格 ${tw}×${th}，内缩 ${insetPct}% → 取 ${cw}×${ch}${debg ? '，去背景' : ''}`);

const frames = [];
let k = 0;
for (let r = 0; r < 3; r++) {
  for (let c = 0; c < 3; c++) {
    const f = path.join(outDir, `frame-${k}.png`);
    const argv = [input, '-crop', `${cw}x${ch}+${c * tw + insX}+${r * th + insY}`, '+repage'];
    if (debg) {
      // 从四角洪水填充成透明（近纯色背景才干净；带场景/渐变的背景请改用透明底重新生成）
      argv.push('-alpha', 'set', '-bordercolor', 'none', '-fuzz', '12%');
      for (const xy of ['0,0', `${cw - 1},0`, `0,${ch - 1}`, `${cw - 1},${ch - 1}`]) {
        argv.push('-fill', 'none', '-draw', `color ${xy} floodfill`);
      }
    }
    // 居中放到统一正方形透明画布
    argv.push('-background', 'none', '-gravity', 'center', '-extent', `${S}x${S}`, f);
    m(...argv);
    frames.push(f);
    k++;
  }
}

const grid = path.join(outDir, 'clean-grid.png');
m('montage', ...frames, '-tile', '3x3', '-geometry', '+0+0', '-background', 'none', grid);

console.log(`✓ 9 帧 → ${path.relative(process.cwd(), outDir)}/frame-0..8.png`);
console.log(`✓ 干净九宫格 → ${path.relative(process.cwd(), grid)}`);
console.log('下一步：把 clean-grid.png 丢进 App 设置「✨ 自定义宠物 → ⬆️ 上传九宫格」，它就会跳舞。');
if (!debg) console.log('提示：想要透明背景，加 --debg（近纯色背景才干净；带场景的背景建议用透明底重生成）。');
