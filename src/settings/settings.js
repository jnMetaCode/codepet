/**
 * 设置窗口逻辑：读/写 config（git 仓库、Claude 开关、经验权重）。
 * 通过 window.codepet（preload 暴露）与主进程通信。
 */

let cfg = null;
let repos = [];

const $ = (id) => document.getElementById(id);

function renderRepos() {
  const box = $('repos');
  box.innerHTML = '';
  if (!repos.length) {
    box.innerHTML = '<div class="empty">还没配置仓库。添加后才会统计 git 提交。</div>';
    return;
  }
  repos.forEach((dir, i) => {
    const el = document.createElement('div');
    el.className = 'repo';
    const span = document.createElement('span');
    span.textContent = dir;
    const btn = document.createElement('button');
    btn.className = 'del';
    btn.textContent = '移除';
    btn.onclick = () => { repos.splice(i, 1); renderRepos(); };
    el.appendChild(span);
    el.appendChild(btn);
    box.appendChild(el);
  });
}

let petList = [];

// 缩略图 URL：内置宠物 assetBase=assets/<id>（设置窗在 ../renderer/ 下）；自定义=petasset://<id>（绝对）。
function petThumbUrl(p) {
  const file = p.frames ? 'frame-0.png' : 'character-neutral.png';
  const base = p.custom ? p.assetBase : `../renderer/${p.assetBase}`;
  return `${base}/${file}`;
}

async function renderPetGrid() {
  const grid = $('pet-grid');
  petList = await window.codepet.getPets();
  const curPet = (cfg.avatar && cfg.avatar.pet) || (petList[0] && petList[0].id);
  grid.innerHTML = '';
  petList.forEach((p) => {
    const cell = document.createElement('div');
    cell.className = 'pet-cell' + (p.id === curPet ? ' sel' : '');
    const face = document.createElement('div');
    face.className = 'face';
    face.textContent = p.emoji;
    const img = new Image();
    const url = petThumbUrl(p);
    img.onload = () => { face.textContent = ''; face.style.backgroundImage = `url("${url}")`; };
    img.src = url;
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.innerHTML = `${p.name}<br><span style="color:#999;font-size:10px">${p.persona || ''}</span>`;
    cell.appendChild(face); cell.appendChild(nm);
    if (p.custom) {
      const del = document.createElement('button');
      del.className = 'del-pet'; del.textContent = '×'; del.title = '删除这只自定义宠物';
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`删除自定义宠物「${p.name}」？`)) return;
        await window.codepet.deletePet(p.id);
        if ((cfg.avatar && cfg.avatar.pet) === p.id) {
          cfg = await window.codepet.setConfig({ avatar: { pet: 'cat' } });
        }
        await renderPetGrid();
      };
      cell.appendChild(del);
    }
    cell.onclick = async () => {
      cfg = await window.codepet.setConfig({ avatar: { pet: p.id } });
      grid.querySelectorAll('.pet-cell').forEach((c) => c.classList.remove('sel'));
      cell.classList.add('sel');
    };
    grid.appendChild(cell);
  });
}

// 上传图片创建自定义宠物：mode = 'single' | 'grid'
async function uploadCustomPet(mode) {
  const msg = $('custom-msg');
  const srcPath = await window.codepet.pickImage();
  if (!srcPath) return;
  msg.style.color = '#888';
  msg.textContent = '处理中…';
  const res = await window.codepet.createPet({
    name: $('cp-name').value, emoji: $('cp-emoji').value, persona: $('cp-persona').value,
    srcPath, mode,
  });
  if (!res || !res.ok) {
    msg.style.color = '#c33';
    msg.textContent = '✗ ' + ((res && res.error) || '创建失败');
    return;
  }
  // 立即切到新宠物
  cfg = await window.codepet.setConfig({ avatar: { pet: res.pet.id } });
  $('cp-name').value = ''; $('cp-emoji').value = ''; $('cp-persona').value = '';
  await renderPetGrid();
  msg.style.color = '#2a8';
  msg.textContent = `✓ 已创建「${res.pet.name}」${res.pet.frames ? '（会跳舞）' : ''}，已切换为当前宠物`;
}

$('up-single').onclick = () => uploadCustomPet('single');
$('up-grid').onclick = () => uploadCustomPet('grid');

async function refreshHooks() {
  const st = await window.codepet.hooksStatus();
  const btn = $('hooks-toggle');
  const lbl = $('hooks-status');
  if (st.installed) {
    btn.textContent = '已开启 · 点击卸载';
    btn.classList.remove('primary');
    lbl.textContent = '✅ 实时联动中，桌宠会即时响应你的 Claude Code';
  } else {
    btn.textContent = '⚡ 开启实时联动';
    btn.classList.add('primary');
    lbl.textContent = '未开启（当前用 jsonl 回填，每分钟刷新一次）';
  }
}

$('hooks-toggle').onclick = async () => {
  const st = await window.codepet.hooksStatus();
  $('hooks-toggle').disabled = true;
  if (st.installed) await window.codepet.hooksUninstall();
  else await window.codepet.hooksInstall();
  await refreshHooks();
  $('hooks-toggle').disabled = false;
};

$('auto-launch').onchange = async (e) => {
  await window.codepet.setAutoLaunch(e.target.checked);
};

async function load() {
  cfg = await window.codepet.getConfig();
  await renderPetGrid();
  await refreshHooks();
  $('auto-launch').checked = await window.codepet.getAutoLaunch();
  repos = (cfg.git && cfg.git.repos ? cfg.git.repos : []).slice();
  $('cc-enabled').checked = !(cfg.claude && cfg.claude.enabled === false);
  $('w-commit').value = cfg.exp.perCommit;
  $('w-line').value = cfg.exp.perLine;
  $('w-cc').value = cfg.exp.perCcRequest;
  $('w-sess').value = cfg.exp.perCcSession;
  $('w-levelup').value = cfg.exp.levelUpExp;
  renderRepos();
}

$('add-repo').onclick = async () => {
  const dir = await window.codepet.pickDir();
  if (dir && !repos.includes(dir)) { repos.push(dir); renderRepos(); }
};

$('save').onclick = async () => {
  await window.codepet.setConfig({
    claude: { enabled: $('cc-enabled').checked },
    git: { repos },
    exp: {
      perCommit: parseFloat($('w-commit').value) || 0,
      perLine: parseFloat($('w-line').value) || 0,
      perCcRequest: parseFloat($('w-cc').value) || 0,
      perCcSession: parseFloat($('w-sess').value) || 0,
      levelUpExp: parseFloat($('w-levelup').value) || 100,
    },
  });
  const s = $('saved');
  s.classList.add('show');
  setTimeout(() => s.classList.remove('show'), 1500);
};

load();
