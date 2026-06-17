#!/usr/bin/env node
/**
 * 码宠 · 原创宠物立绘生成（OpenAI gpt-image-1）。生成的是可爱小动物宠物，不是人。
 *
 * 安全用法（key 绝不写进代码 / 不进 git）：
 *   1) 先去 platform.openai.com 吊销已泄露的旧 key，生成新 key
 *   2) 在你自己的终端运行（key 只留在你本机环境变量里）：
 *        export OPENAI_API_KEY=sk-你的新key
 *        node tools/gen-character.js list           # 看有哪些宠物
 *        node tools/gen-character.js cat            # 只生成「猫」的默认立绘
 *        node tools/gen-character.js cat all        # 生成猫的 4 个表情
 *        node tools/gen-character.js all            # 给每只宠物各生成 1 张默认立绘（做选择画廊）
 *
 * 产物：src/renderer/assets/<宠物id>/character-<表情>.png（透明背景）
 * 生成后在桌宠设置里选这只宠物即可（或重启）。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PETS = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/pets.json'), 'utf8')).pets;
const OUT_ROOT = path.join(__dirname, '../src/renderer/assets');

// 美术方向：照用户参考图校准（毛绒绒 + 星空大眼 + 粉腮红粉爪垫 + 圆滚坐姿 + 柔光）
const STYLE =
  'Super cute chibi kawaii baby animal mascot, irresistibly adorable plush-toy look. ' +
  'Extremely fluffy and soft with detailed downy fur texture. ' +
  'Enormous round glossy eyes filled with sparkling star-like highlights and dreamy reflections. ' +
  'Tiny cute mouth, rosy pink blush on chubby cheeks, soft pink inner ears, pink paw pads (paw beans). ' +
  'Big-head super-deformed chibi proportions, sitting front-facing full-body pose, little stubby paws. ' +
  'Soft dreamy glowing rim lighting, smooth airbrushed soft shading, soft white-and-pastel palette, ' +
  'hand-drawn kawaii anime illustration style. ' +
  'Single character centered with generous margin, fully transparent background. ' +
  'No scenery, no text, no humans, no watermark, no border.';

const EXPR = {
  neutral: 'calm gentle neutral expression, relaxed idle pose.',
  happy:   'big joyful smile, sparkling eyes, cheering pose, a little celebratory.',
  tired:   'sleepy half-closed eyes, small yawn, droopy tired posture, tiny "zzz".',
  working: 'focused determined look, a small spark of energy, busy "working hard" pose.',
};

function genOne(pet, exprName) {
  const prompt = `${STYLE} The creature is ${pet.desc}. Expression: ${EXPR[exprName]}`;
  const body = JSON.stringify({
    model: 'gpt-image-1', prompt, size: '1024x1024', background: 'transparent', n: 1, quality: 'high',
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com', path: '/v1/images/generations', method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        try {
          const b64 = JSON.parse(data).data?.[0]?.b64_json;
          if (!b64) return reject(new Error('响应里没有图片'));
          const dir = path.join(OUT_ROOT, pet.id);
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `character-${exprName}.png`);
          fs.writeFileSync(file, Buffer.from(b64, 'base64'));
          resolve(file);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ---------- CLI ----------
//   list                  列出宠物
//   (无参) / all           每只各出 1 张默认立绘
//   <pet> all              某只的 4 个表情
//   <pet> [<pet> ...]      指定一只或多只，各出 1 张（如 cat shiba duck）
const args = process.argv.slice(2);

if (args[0] === 'list') {
  console.log('可选宠物：');
  PETS.forEach((p) => console.log(`  ${p.emoji}  ${p.id.padEnd(8)} ${p.name} · ${p.persona}`));
  process.exit(0);
}

const KEY = process.env.OPENAI_API_KEY;
if (!KEY || KEY.length < 20) {
  console.error('✗ 未设置有效 OPENAI_API_KEY。先 export OPENAI_API_KEY=新key 再运行。');
  process.exit(1);
}

(async function main() {
  let jobs = [];
  if (args.length === 0 || args[0] === 'all') {
    jobs = PETS.map((p) => [p, 'neutral']);
  } else if (args.length === 2 && args[1] === 'all') {
    const pet = PETS.find((p) => p.id === args[0]);
    if (!pet) { console.error(`✗ 没有宠物「${args[0]}」。先 node tools/gen-character.js list`); process.exit(1); }
    jobs = Object.keys(EXPR).map((e) => [pet, e]);
  } else {
    const unknown = args.filter((id) => !PETS.find((p) => p.id === id));
    if (unknown.length) { console.error(`✗ 未知宠物：${unknown.join(', ')}。先 node tools/gen-character.js list`); process.exit(1); }
    jobs = args.map((id) => [PETS.find((p) => p.id === id), 'neutral']);
  }
  console.log(`将生成 ${jobs.length} 张立绘…`);
  for (const [pet, expr] of jobs) {
    process.stdout.write(`  ${pet.emoji} ${pet.name} / ${expr} … `);
    try { const f = await genOne(pet, expr); console.log('✓', path.relative(process.cwd(), f)); }
    catch (e) { console.log('✗', e.message); }
  }
  console.log('完成。到桌宠设置里选这只宠物即可。');
})();
