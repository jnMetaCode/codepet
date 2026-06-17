#!/usr/bin/env node
/**
 * 生成封面图：粉彩渐变底 + 宠物 + 标题文案。
 *   docs/cover.png        公众号横版封面 900×383（2.35:1，主封面）
 *   docs/cover-square.png 1:1 备用 1080×1080（朋友圈/小图）
 * 依赖 ImageMagick（magick）；中文用系统苹方字体。
 *
 *   node tools/make-cover.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'src/renderer/assets');
const OUT = path.join(ROOT, 'docs');
const TMP = path.join(OUT, '.cover-tmp');
fs.mkdirSync(TMP, { recursive: true });

const has = (b) => { try { execFileSync('command', ['-v', b], { stdio: 'ignore', shell: '/bin/bash' }); return true; } catch { return false; } };
const M = has('magick') ? 'magick' : (has('convert') ? 'convert' : null);
if (!M) { console.error('✗ 需要 ImageMagick：brew install imagemagick'); process.exit(1); }
const m = (...a) => execFileSync(M, a, { stdio: ['ignore', 'ignore', 'inherit'] });
const FONT = ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Medium.ttc'].find((f) => fs.existsSync(f));
const FB = ['/System/Library/Fonts/PingFang.ttc'].find((f) => fs.existsSync(f));

// 取一只宠物的展示图（优先静态立绘，否则首帧）
function petImg(id) {
  const a = path.join(A, id, 'character-neutral.png');
  const b = path.join(A, id, 'frame-0.png');
  return fs.existsSync(a) ? a : (fs.existsSync(b) ? b : null);
}

function build({ w, h, out, titleSize, subSize, petH, layout }) {
  const bg = path.join(TMP, `bg-${w}x${h}.png`);
  m('-size', `${w}x${h}`, 'gradient:#FFE7F3-#E6E1FF', bg);

  // 放 2 只宠物（奶猫 + 小舞精灵），右侧/底部错落
  const cat = petImg('cat'), dancer = petImg('dancer'), rainbow = petImg('rainbow');
  let cur = bg;
  const place = (src, size, gravity, geom) => {
    if (!src) return;
    const next = path.join(TMP, `step-${Math.round(Math.random() * 1e6)}.png`);
    const sc = path.join(TMP, `sc-${Math.round(Math.random() * 1e6)}.png`);
    m(src, '-resize', size, sc);
    m(cur, sc, '-gravity', gravity, '-geometry', geom, '-compose', 'over', '-composite', next);
    cur = next;
  };

  if (layout === 'wide') {
    place(dancer, `x${Math.round(petH * 0.82)}`, 'East', `+250+18`);
    place(cat, `x${petH}`, 'East', `+40+30`);
  } else {
    place(rainbow, `x${Math.round(petH * 0.7)}`, 'South', `-${Math.round(w * 0.26)}+20`);
    place(dancer, `x${Math.round(petH * 0.82)}`, 'South', `+${Math.round(w * 0.26)}+10`);
    place(cat, `x${petH}`, 'South', `+0-6`);
  }

  // 文案（横版靠左，方版居中上）
  const fontArgs = FONT ? ['-font', FONT] : [];
  if (layout === 'wide') {
    m(cur, ...fontArgs, '-gravity', 'West',
      '-fill', '#3a2b5e', '-pointsize', String(titleSize), '-annotate', '+48-54', '码宠 CodePet',
      '-fill', '#5a4a7a', '-pointsize', String(subSize), '-annotate', `+50+26`, '你写代码，它升级、跳舞、会饿',
      '-fill', '#8a7ab0', '-pointsize', String(Math.round(subSize * 0.8)), '-annotate', `+50+74`, '开源 · 桌面养成桌宠 · mac / win',
      out);
  } else {
    m(cur, ...fontArgs, '-gravity', 'North',
      '-fill', '#3a2b5e', '-pointsize', String(titleSize), '-annotate', '+0+90', '码宠 CodePet',
      '-fill', '#5a4a7a', '-pointsize', String(subSize), '-annotate', '+0+220', '你写代码，它升级、跳舞、会饿',
      '-fill', '#8a7ab0', '-pointsize', String(Math.round(subSize * 0.82)), '-annotate', '+0+300', '开源 · 桌面养成桌宠 · mac / win',
      out);
  }
  console.log('✓', path.relative(process.cwd(), out), `(${w}×${h})`);
}

build({ w: 900, h: 383, out: path.join(OUT, 'cover.png'), titleSize: 76, subSize: 30, petH: 330, layout: 'wide' });
build({ w: 1080, h: 1080, out: path.join(OUT, 'cover-square.png'), titleSize: 96, subSize: 40, petH: 560, layout: 'square' });

fs.rmSync(TMP, { recursive: true, force: true });
console.log('完成。公众号发文用 docs/cover.png（横版主封面）。');
