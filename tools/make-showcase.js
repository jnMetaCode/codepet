#!/usr/bin/env node
/**
 * 把 9 只宠物的立绘拼成 3×3 九宫格 → docs/pets-showcase.png。
 * 依赖 ImageMagick（montage / convert）。macOS: brew install imagemagick
 *
 *   node tools/make-showcase.js
 *
 * 取图规则：每只宠物用 character-neutral.png；小舞精灵用 frame-0.png。
 * 还没生成立绘的宠物，用浅色占位格（写宠物名）补上，保证九宫格不缺格。
 * 先把 9 只都生成立绘，出来的九宫格才好看：
 *   node tools/gen-character.js all
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/pets.json'), 'utf8')).pets;
const ASSETS = path.join(ROOT, 'src/renderer/assets');
const TMP = path.join(ROOT, 'docs/.showcase-tmp');
const OUT = path.join(ROOT, 'docs/pets-showcase.png');
const TILE = 512; // 每格尺寸

function have(bin) {
  try { execFileSync('command', ['-v', bin], { stdio: 'ignore', shell: '/bin/bash' }); return true; }
  catch { return false; }
}
// IMv7 用 `magick`，IMv6 回退 `convert`
const CONVERT = have('magick') ? 'magick' : 'convert';
if (!have('montage') || !have(CONVERT)) {
  console.error('✗ 需要 ImageMagick。macOS: brew install imagemagick');
  process.exit(1);
}
// 占位格用的中文字体（macOS 自带苹方）；找不到就让 IM 用默认
const CJK_FONT = ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc']
  .find((f) => fs.existsSync(f));

function tileFor(pet) {
  const neutral = path.join(ASSETS, pet.id, 'character-neutral.png');
  const frame0 = path.join(ASSETS, pet.id, 'frame-0.png');
  if (fs.existsSync(neutral)) return neutral;
  if (fs.existsSync(frame0)) return frame0;
  return null; // 占位
}

fs.mkdirSync(TMP, { recursive: true });
const tiles = [];
let missing = 0;

for (const pet of PETS) {
  const src = tileFor(pet);
  const out = path.join(TMP, `${pet.id}.png`);
  if (src) {
    // 统一缩放到 TILE，居中，透明背景
    execFileSync(CONVERT, [src, '-resize', `${TILE}x${TILE}`, '-background', 'none',
      '-gravity', 'center', '-extent', `${TILE}x${TILE}`, out]);
  } else {
    missing++;
    // 浅色占位格 + 宠物名（emoji 渲染不稳，用中文名占位）
    const fontArgs = CJK_FONT ? ['-font', CJK_FONT] : [];
    execFileSync(CONVERT, ['-size', `${TILE}x${TILE}`, 'xc:#FBF7FF', ...fontArgs,
      '-gravity', 'center', '-pointsize', '44', '-fill', '#B7A6D6',
      '-annotate', '0', `${pet.name}\n(待生成立绘)`, out]);
  }
  tiles.push(out);
}

execFileSync('montage', [...tiles, '-tile', '3x3', '-geometry', '+12+12',
  '-background', 'white', OUT]);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`✓ 九宫格已生成：${path.relative(process.cwd(), OUT)}`);
if (missing) console.log(`  注意：${missing} 只还没立绘（用占位格）。先跑 node tools/gen-character.js all 再重拼。`);
