/**
 * 宠物图鉴：内置（config/pets.json，随包只读）+ 用户自定义（userData/pets/，可写）。
 * 自定义宠物的图片放在 userData/pets/<id>/，元数据存 userData/pets/custom-pets.json，
 * 由 petasset:// 协议提供给渲染进程（见 main.js）。
 *
 * 两种创建方式：
 *   single — 上传 1 张图 → character-neutral.png，做一只静态宠物。
 *   grid   — 上传 1 张 3×3 九宫格 → 切成 frame-0..8.png，做一只会跳舞的宠物（复用 frames 机制）。
 * 切图用 Electron 的 nativeImage，无需任何额外依赖。
 */
const fs = require('fs');
const path = require('path');
const { nativeImage } = require('electron');

let userDataDir = null;
function init(dir) { userDataDir = dir; }
function petsDir() { return path.join(userDataDir, 'pets'); }
function metaFile() { return path.join(petsDir(), 'custom-pets.json'); }

function builtIn() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/pets.json'), 'utf8')).pets || [];
  } catch { return []; }
}
function readCustom() {
  try { return JSON.parse(fs.readFileSync(metaFile(), 'utf8')).pets || []; } catch { return []; }
}
function writeCustom(list) {
  fs.mkdirSync(petsDir(), { recursive: true });
  fs.writeFileSync(metaFile(), JSON.stringify(
    { _说明: '用户自定义宠物。图片在同目录 <id>/，由 petasset:// 协议读取。', pets: list }, null, 2));
}

// 列表：内置 assetBase=assets/<id>（相对渲染页），自定义 assetBase=petasset://<id>（绝对）。
function list() {
  const bi = builtIn().map((p) => ({ ...p, assetBase: `assets/${p.id}`, custom: false }));
  const cu = readCustom().map((p) => ({ ...p, assetBase: `petasset://${p.id}`, custom: true }));
  return [...bi, ...cu];
}

// 自定义宠物的默认台词（用户没法逐条填，给一套通用的，保证还能"说话"）
const DEFAULT_LINES = {
  idle: ['我在这儿陪你～', '随时待命，开工吧！'],
  warm: ['热身好啦，一起动～', '手感来了！'],
  active: ['你好棒，继续冲！', '写得真顺，我也来劲了～'],
  beast: ['卷王上线！我超崇拜你！🔥', '今天这状态，封神了！'],
};

// 由名字生成英文 id 片段；纯中文/空 → 'mypet'。再保证全局唯一。
function slugify(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'mypet';
}
function uniqueId(base) {
  const taken = new Set([...builtIn(), ...readCustom()].map((p) => p.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/**
 * 创建自定义宠物。
 * @param {{name?:string, emoji?:string, persona?:string, srcPath:string, mode:'single'|'grid'}} opts
 * @returns 新宠物（含 assetBase），失败抛错。
 */
function create({ name, emoji, persona, srcPath, mode } = {}) {
  if (!srcPath || !fs.existsSync(srcPath)) throw new Error('图片不存在或已被移动');
  const img = nativeImage.createFromPath(srcPath);
  if (img.isEmpty()) throw new Error('无法读取图片（支持 PNG / JPG）');

  const id = uniqueId(slugify(name));
  const dir = path.join(petsDir(), id);
  fs.mkdirSync(dir, { recursive: true });

  const meta = {
    id,
    name: (name && name.trim()) || '我的宠物',
    emoji: (emoji && emoji.trim()) || '🐾',
    persona: (persona && persona.trim()) || '专属定制',
    lines: DEFAULT_LINES,
  };

  if (mode === 'grid') {
    const { width, height } = img.getSize();
    if (width < 3 || height < 3) throw new Error('九宫格图片太小');
    const tw = Math.floor(width / 3), th = Math.floor(height / 3);
    let k = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const tile = img.crop({ x: c * tw, y: r * th, width: tw, height: th });
        fs.writeFileSync(path.join(dir, `frame-${k}.png`), tile.toPNG());
        k++;
      }
    }
    meta.frames = 9;
    meta.fps = 5;
  } else {
    fs.writeFileSync(path.join(dir, 'character-neutral.png'), img.toPNG());
  }

  const cur = readCustom();
  cur.push(meta);
  writeCustom(cur);
  return { ...meta, assetBase: `petasset://${id}`, custom: true };
}

function remove(id) {
  if (!id) return false;
  writeCustom(readCustom().filter((p) => p.id !== id));
  try { fs.rmSync(path.join(petsDir(), id), { recursive: true, force: true }); } catch {}
  return true;
}

// petasset://<id>/<file> → 磁盘绝对路径（basename 防目录穿越）。
function resolveAsset(id, file) {
  return path.join(petsDir(), path.basename(String(id || '')), path.basename(String(file || '')));
}

module.exports = { init, list, create, remove, resolveAsset, petsDir };
