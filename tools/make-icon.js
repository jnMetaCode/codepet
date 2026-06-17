#!/usr/bin/env node
/**
 * 生成 App 图标：把某只宠物立绘放进「圆角粉彩渐变」徽章里，导出 electron-builder 需要的
 *   build/icon.png (1024) · build/icon.icns (mac) · build/icon.ico (win)
 * 依赖 ImageMagick（magick）；macOS 的 .icns 用系统自带 iconutil 生成（最稳）。
 *
 *   node tools/make-icon.js            # 默认用奶猫(cat)
 *   node tools/make-icon.js rainbow    # 换一只宠物当 logo
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const petId = process.argv[2] || 'cat';
const SRC = path.join(ROOT, `src/renderer/assets/${petId}/character-neutral.png`);
const FRAME0 = path.join(ROOT, `src/renderer/assets/${petId}/frame-0.png`);
const pet = fs.existsSync(SRC) ? SRC : (fs.existsSync(FRAME0) ? FRAME0 : null);
if (!pet) { console.error(`✗ 找不到宠物 ${petId} 的立绘。先 node tools/gen-character.js ${petId}`); process.exit(1); }

const has = (b) => { try { execFileSync('command', ['-v', b], { stdio: 'ignore', shell: '/bin/bash' }); return true; } catch { return false; } };
const MAGICK = has('magick') ? 'magick' : (has('convert') ? 'convert' : null);
if (!MAGICK) { console.error('✗ 需要 ImageMagick：brew install imagemagick'); process.exit(1); }

const BUILD = path.join(ROOT, 'build');
const TMP = path.join(BUILD, '.icon-tmp');
fs.mkdirSync(TMP, { recursive: true });
const m = (...a) => execFileSync(MAGICK, a, { stdio: ['ignore', 'ignore', 'inherit'] });

// 1) 圆角粉彩渐变徽章（1024，macOS 风圆角 ≈22%）
const grad = path.join(TMP, 'grad.png');
const mask = path.join(TMP, 'mask.png');
const badge = path.join(TMP, 'badge.png');
m('-size', '1024x1024', 'gradient:#FFE6F2-#E4E0FF', grad);
m('-size', '1024x1024', 'xc:none', '-draw', 'roundrectangle 0,0,1023,1023,224,224', mask);
m(grad, mask, '-alpha', 'set', '-compose', 'DstIn', '-composite', badge);

// 2) 放上宠物（等比缩放居中，略微下移）+ 落地软阴影
const petScaled = path.join(TMP, 'pet.png');
const shadow = path.join(TMP, 'shadow.png');
m(pet, '-resize', '720x720', petScaled);
// 由宠物轮廓生成一层柔和阴影
m(petScaled, '-background', 'black', '-shadow', '55x16+0+10', shadow);
const master = path.join(BUILD, 'icon.png');
// 依次叠加：徽章底 → 阴影 → 宠物
m(badge,
  shadow, '-gravity', 'center', '-geometry', '+0+48', '-compose', 'over', '-composite',
  petScaled, '-gravity', 'center', '-geometry', '+0+30', '-compose', 'over', '-composite',
  master);
console.log('✓ build/icon.png (1024)');

// 3) .icns —— 用 iconutil（系统自带，最稳）
if (has('iconutil')) {
  const iconset = path.join(TMP, 'icon.iconset');
  fs.mkdirSync(iconset, { recursive: true });
  const sizes = [[16, ''], [16, '@2x'], [32, ''], [32, '@2x'], [128, ''], [128, '@2x'], [256, ''], [256, '@2x'], [512, ''], [512, '@2x']];
  for (const [s, x] of sizes) {
    const px = x === '@2x' ? s * 2 : s;
    m(master, '-resize', `${px}x${px}`, path.join(iconset, `icon_${s}x${s}${x}.png`));
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(BUILD, 'icon.icns')]);
  console.log('✓ build/icon.icns (mac)');
} else {
  console.log('… 跳过 .icns（无 iconutil，非 macOS）');
}

// 4) .ico（多尺寸）
m(master, '-define', 'icon:auto-resize=256,128,64,48,32,16', path.join(BUILD, 'icon.ico'));
console.log('✓ build/icon.ico (win)');

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`完成。electron-builder 会自动用 build/icon.*（当前 logo 宠物：${petId}）。`);
