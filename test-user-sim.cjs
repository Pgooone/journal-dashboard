// ============================================================
// 日记面板插件 · 用户模拟测试
// 以用户身份模拟：打开面板、任务归列、勾选、拖拽、添加任务、设置变更
// 使用 jsdom + obsidian API stub + 临时测试 vault（不碰真实日记）
// ============================================================
const fs = require("fs");
const path = require("path");
const Module = require("module");

// ---------- 0. jsdom 环境 ----------
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;
global.Node = dom.window.Node;
// polyfill Obsidian 的 DOM 扩展方法
const proto = dom.window.HTMLElement.prototype;
proto.addClass = function (...c) { this.classList.add(...c); return this; };
proto.removeClass = function (...c) { this.classList.remove(...c); return this; };
proto.empty = function () { this.replaceChildren(); return this; };
proto.toggleClass = function (c, on) { this.classList.toggle(c, on); return this; };
// prompt stub（默认返回 null 模拟取消）
dom.window.prompt = () => null;

// ---------- 1. 临时测试 vault ----------
const TEST_ROOT = path.join(require("os").tmpdir(), "jd-test-vault");
fs.rmSync(TEST_ROOT, { recursive: true, force: true });
const D = (p) => {
  const abs = path.join(TEST_ROOT, p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
};
const write = (p, c) => fs.writeFileSync(D(p), c, "utf8");

write("日记/每日/2026-08-11.md", `---
date: 2026-08-11
weekday: 星期二
week: 2026-W33
type: daily
mood: 🙂
tags:
  - daily
---

<< [[2026-08-10]] | [[2026-08-12]] >>

## 🎯 今日事
%% 看板标签：今天→#今天 明天→#明天 本周→#本周 以后→#以后；无标签任务默认归「今天」%%
- [ ] 写周报 #今天
- [ ] 无标签任务（应默认归今天）
- [ ] 买菜 #今天
  - [ ] 子任务A（不单独成卡）
  - [ ] 子任务B（不单独成卡）

## 📥 随手记
- 随便记点什么

## 🌙 晚间复盘
- 今天做成了什么：
`);

write("日记/每日/2026-08-10.md", `---
date: 2026-08-10
weekday: 星期一
week: 2026-W33
type: daily
mood: 😄
tags:
  - daily
---

## 🎯 今日事
- [ ] 明天要交的报告 #明天
- [x] 已完成的任务 #今天
- [ ] 以后再说 #later
- [ ] 多标签任务 #今天 #明天（应归今天，优先级）

## 📥 随手记
-
`);

write("日记/每日/Kanban-1786411859061.md", `---
kanban_plugin: '{"columns":[]}'
---
`);

write("日记/每日/2026-08-09.md", `---
date: 2026-08-09
weekday: 星期日
week: 2026-W32
type: daily
mood: 😣
tags:
  - daily
---

## 🎯 今日事
- [ ] 本周五的会议准备 #本周五（标签前缀不应误剥）
- [ ] 周报汇总 #本周
- [ ] 英文标签任务 #later

## 📥 随手记
-
`);

// ---------- 2. obsidian 模块 stub ----------
const notices = [];
class StubNotice { constructor(msg) { notices.push(msg); } }
class StubTFile {
  constructor(p, basename) { this.path = p; this.basename = basename; this.extension = "md"; this.stat = { ctime: Date.now() }; }
}
class StubTFolder {}
class StubWorkspaceLeaf {}
class StubItemView {
  constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.contentEl = document.createElement("div"); }
  registerEvent() {} registerDomEvent() {} registerInterval() {}
}
class StubSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = document.createElement("div"); } }
/**
 * 选择弹窗 stub：模拟 Obsidian Modal（构造函数只接收 app，
 * 选项按钮的 click 监听在 contentEl.createEl 时收集）。
 * open() 时自动触发第一个选项按钮（模拟用户点击第一项）。
 */
class StubModal {
  constructor(app) { this.app = app; this._clicks = []; }
  setTitle() {}
  open() { setTimeout(() => this._clicks[0]?.(), 0); }
  close() {}
  get contentEl() {
    const modal = this;
    return {
      createEl: (tag, opts) => {
        const el = document.createElement(tag);
        el.textContent = opts?.text ?? "";
        el.addEventListener = (ev, fn) => { if (ev === "click") modal._clicks.push(fn); };
        return el;
      },
    };
  }
}
class StubSetting {
  constructor(containerEl) {
    this.el = document.createElement("div");
    this.el.className = "setting-item";
    containerEl.appendChild(this.el);
  }
  setName(n) {
    const e = document.createElement("div");
    e.className = "setting-item-name";
    e.textContent = n;
    this.el.appendChild(e);
    return this;
  }
  setDesc() { return this; }
  setHeading() { this.el.className += " setting-item-heading"; return this; }
  addText(cb) { cb({ setPlaceholder() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
  addToggle(cb) { cb({ setValue() { return this; }, onChange() { return this; } }); return this; }
  addSlider(cb) { cb({ setLimits() { return this; }, setValue() { return this; }, setDynamicTooltip() { return this; }, onChange() { return this; } }); return this; }
  addDropdown(cb) {
    cb({ selectEl: document.createElement("select"), addOption() { return this; }, setValue() { return this; }, onChange() { return this; } });
    return this;
  }
  addButton(cb) { cb({ setButtonText() { return this; }, setCta() { return this; }, setDestructive() { return this; }, onClick(cb2) { this._click = cb2; return this; } }); return this; }
}
class StubPlugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
  async loadData() { return null; }
  async saveData() {}
  addCommand() {} addRibbonIcon() {}
  registerView() {} addSettingTab() {}
  registerEvent() {} registerDomEvent() {} registerInterval() {}
}

// ---------- 3. vault / app stub（指向临时目录的真实文件系统） ----------
function walkMd(dir, base) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = path.join(base, e.name).replace(/\\/g, "/");
    if (e.isDirectory()) out.push(...walkMd(abs, rel));
    else if (e.name.endsWith(".md")) out.push(rel);
  }
  return out;
}
/** 简化 markdown 任务解析：模拟 Obsidian metadataCache.listItems */
function parseListItems(md) {
  const items = [];
  const stack = [];
  md.split("\n").forEach((line, i) => {
    const m = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
    if (!m) return;
    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    items.push({
      task: m[2] === " " ? " " : m[2].toLowerCase(),
      position: { start: { line: i, col: indent, offset: 0 } },
      parent: stack.length ? stack[stack.length - 1].index : -1,
    });
    stack.push({ indent, index: items.length - 1 });
  });
  return items;
}

const openedFiles = [];
let leafView = null;
let viewCreator = null;
let activeView = null; // 当前活动 MarkdownView（光标定位测试用）
let cursorPos = null;

const app = {
  vault: {
    adapter: {
      exists: async (p) => fs.existsSync(path.join(TEST_ROOT, p)),
      read: async (p) => fs.readFileSync(path.join(TEST_ROOT, p), "utf8"),
      write: async (p, c) => fs.writeFileSync(path.join(TEST_ROOT, p), c),
    },
    getMarkdownFiles: () =>
      walkMd(TEST_ROOT, "").map((p) => new StubTFile(p, path.basename(p, ".md"))),
    getAbstractFileByPath: (p) => {
      const abs = path.join(TEST_ROOT, p);
      if (!fs.existsSync(abs)) return null;
      return fs.statSync(abs).isDirectory() ? new StubTFolder() : new StubTFile(p, path.basename(p, ".md"));
    },
    read: async (f) => fs.readFileSync(path.join(TEST_ROOT, f.path), "utf8"),
    create: async (p, content) => {
      fs.mkdirSync(path.dirname(path.join(TEST_ROOT, p)), { recursive: true });
      fs.writeFileSync(path.join(TEST_ROOT, p), content);
      return new StubTFile(p, path.basename(p, ".md"));
    },
    cachedRead: async (f) => fs.readFileSync(path.join(TEST_ROOT, f.path), "utf8"),
    process: async (f, fn) => {
      const abs = path.join(TEST_ROOT, f.path);
      const out = fn(fs.readFileSync(abs, "utf8"));
      fs.writeFileSync(abs, out);
    },
    on: () => () => {},
    createFolder: async (p) => fs.mkdirSync(path.join(TEST_ROOT, p), { recursive: true }),
  },
  metadataCache: {
    getFileCache: (f) => {
      const content = fs.readFileSync(path.join(TEST_ROOT, f.path), "utf8");
      return { listItems: parseListItems(content) };
    },
  },
  workspace: {
    onLayoutReady: () => {}, // 测试跳过自动搭建
    getLeavesOfType: () => (leafView ? [{ app, view: leafView }] : []),
    getRightLeaf: () => ({ app, view: null, setViewState: async (s) => { if (viewCreator) { leafView = viewCreator({ app }); await leafView.onOpen?.(); } } }),
    revealLeaf: () => {},
    getLeaf: () => ({
      openFile: async (f) => {
        openedFiles.push(f);
        activeView = {
          file: f,
          editor: { setCursor: (l, c) => { cursorPos = [l, c]; } },
        };
      },
    }),
    getActiveViewOfType: () => activeView,
  },
  commands: { commands: {}, removeCommand: () => {}, executeCommandById: () => {} },
  plugins: {
    plugins: {
      "templater-obsidian": {
        templater: { create_new_note_from_template: async () => { openedFiles.push("CREATE_NOTE"); } },
      },
    },
  },
  internalPlugins: { getPluginById: () => null },
};

const obsidianStub = {
  Plugin: StubPlugin, Notice: StubNotice, TFile: StubTFile, TFolder: StubTFolder,
  WorkspaceLeaf: StubWorkspaceLeaf, ItemView: StubItemView,
  PluginSettingTab: StubSettingTab, Setting: StubSetting, Modal: StubModal,
  MarkdownView: class {},
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return obsidianStub;
  return origLoad.call(this, request, parent, isMain);
};

// ---------- 4. 加载插件（真实构建产物） ----------
const PLUGIN_DIR = __dirname;
const mod = require(path.join(PLUGIN_DIR, "main.js"));
const JournalDashboardPlugin = mod.default;

// ---------- 5. 测试工具 ----------
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function readFile(p) { return fs.readFileSync(path.join(TEST_ROOT, p), "utf8"); }
const colTitleText = (col) => col.querySelector(".jd-col-title")?.textContent ?? "";
const cardTexts = (col) => Array.from(col.querySelectorAll(".jd-card-item")).map((c) => c.querySelector(".jd-card-item-text")?.textContent ?? "");
const cardCount = (col) => col.querySelectorAll(".jd-card-item").length;

async function main() {
  console.log("══ 测试 0：插件加载与启用 ══");
  const plugin = new JournalDashboardPlugin(app, { id: "journal-dashboard", name: "日记面板", version: "1.0.0" });
  await plugin.onload();
  check("onload 无异常", true);
  // 测试设置页渲染
  let settingsTab = null;
  const origAddSettingTab = StubPlugin.prototype.addSettingTab;
  StubPlugin.prototype.addSettingTab = function (tab) { settingsTab = tab; };
  // 重新构造（上述 hook 已在 onload 前设置过？不——重新做一次）
  const plugin2 = new JournalDashboardPlugin(app, { id: "journal-dashboard", name: "日记面板", version: "1.0.0" });
  await plugin2.onload();
  const p2Tab = settingsTab; // 固定 plugin2 的 tab（后续 plugin3.onload 会覆盖 settingsTab 变量）
  p2Tab.display();
  check("设置页 display 无异常", true);
  check("设置页有「基础路径」分组", Array.from(p2Tab.containerEl.querySelectorAll(".setting-item-name")).some((e) => e.textContent === "基础路径"));
  check("设置页有「任务看板」分组", Array.from(p2Tab.containerEl.querySelectorAll(".setting-item-name")).some((e) => e.textContent === "任务看板"));
  check("设置页有「创建命令」分组", Array.from(p2Tab.containerEl.querySelectorAll(".setting-item-name")).some((e) => e.textContent === "创建命令"));
  check("设置页有「模板库」分组", Array.from(p2Tab.containerEl.querySelectorAll(".setting-item-name")).some((e) => e.textContent === "模板库"));

  console.log("══ 测试 1：打开日记面板（ribbon 路径） ══");
  // 模拟 registerView hook
  const realRegisterView = StubPlugin.prototype.registerView;
  StubPlugin.prototype.registerView = function (type, creator) { viewCreator = creator; };
  // 重新加载插件（第三次，含 viewCreator hook）
  const plugin3 = new JournalDashboardPlugin(app, { id: "journal-dashboard", name: "日记面板", version: "1.0.0" });
  await plugin3.onload();
  await plugin3.activateView();
  check("面板 view 已创建", !!leafView);
  const view = leafView;
  const root = view.contentEl;
  check("面板根元素类名 journal-dashboard", root.className.includes("journal-dashboard"));

  console.log("══ 测试 2：看板渲染与任务归列 ══");
  await new Promise((r) => setTimeout(r, 50)); // 等待异步 render 完成
  const board = root.querySelector(".jd-board");
  check("看板区块存在", !!board);
  const cols = Array.from(root.querySelectorAll(".jd-col"));
  check(`渲染 5 列（4 时间列 + 已完成）`, cols.length === 5, `实际 ${cols.length}`);
  const colByTitle = {};
  for (const c of cols) {
    colByTitle[colTitleText(c).replace(/^\s*✓\s*/, "").replace(/\s*\(\d+\)\s*.*$/, "").trim()] = c;
  }

  check("今天列 5 个任务", cardCount(colByTitle["今天"]) === 5, `实际 ${cardCount(colByTitle["今天"])}`);
  const todayTexts = cardTexts(colByTitle["今天"]);
  check("今天列包含：写周报", todayTexts.some((t) => t.includes("写周报")));
  check("今天列包含：无标签任务（默认归今天）", todayTexts.some((t) => t.includes("无标签任务")));
  check("今天列包含：多标签任务（#今天 #明天 按优先级归今天）", todayTexts.some((t) => t.includes("多标签任务")));
  check("今天列包含：#本周五 任务（无列标签默认归今天）", todayTexts.some((t) => t.includes("本周五的会议准备")));
  check("今天列卡片文本无 - [ ] 前缀（与勾选图标不重复）", todayTexts.every((t) => !/^-\s*\[/.test(t)), `文本: ${todayTexts.join(" | ")}`);
  check("今天列文本已剥离 #今天 标签", todayTexts.every((t) => !t.includes("#今天")));
  check("今天列文本保留 #本周五（前缀不误剥）", todayTexts.some((t) => t.includes("#本周五")), `文本: ${todayTexts.join(" | ")}`);

  check("明天列 1 个任务", cardCount(colByTitle["明天"]) === 1, `实际 ${cardCount(colByTitle["明天"])}`);
  check("本周列 1 个任务", cardCount(colByTitle["本周"]) === 1, `实际 ${cardCount(colByTitle["本周"])}`);
  check("以后列 2 个任务（#以后 + #later）", cardCount(colByTitle["以后"]) === 2, `实际 ${cardCount(colByTitle["以后"])}`);
  const doneCol = colByTitle["已完成"];
  check("已完成列计数含 1 个任务", /\(\s*1\s*\)/.test(colTitleText(doneCol)), colTitleText(doneCol));
  check("已完成列默认收起（无卡片）", cardCount(doneCol) === 0);

  console.log("══ 测试 3：勾选/取消勾选（写回日记） ══");
  const todayCol = colByTitle["今天"];
  const wbCard = Array.from(todayCol.querySelectorAll(".jd-card-item")).find((c) => c.querySelector(".jd-card-item-text")?.textContent.includes("写周报"));
  const wbBox = wbCard.querySelector(".jd-check");
  wbBox.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  const f11 = readFile("日记/每日/2026-08-11.md");
  check("「写周报」行变为 - [x]", f11.includes("- [x] 写周报 #今天"), f11.split("\n").find((l) => l.includes("写周报")));
  check("frontmatter 未被破坏", f11.includes("date: 2026-08-11") && f11.includes("mood: 🙂"));
  check("子任务缩进原样保留", f11.includes("  - [ ] 子任务A（不单独成卡）") && f11.includes("  - [ ] 子任务B（不单独成卡）"));
  check("其它任务行未受影响", f11.includes("- [ ] 无标签任务（应默认归今天）") && f11.includes("- [ ] 买菜 #今天"));
  // 再点一次取消勾选
  wbBox.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  check("再点恢复 - [ ]", readFile("日记/每日/2026-08-11.md").includes("- [ ] 写周报 #今天"));

  console.log("══ 测试 4：拖拽换列（写回标签） ══");
  // 拖「写周报」到明天列：替换标签（行号动态获取）
  const wbLine = readFile("日记/每日/2026-08-11.md").split("\n").findIndex((l) => l.includes("写周报"));
  const fdt = { setData: () => {}, getData: () => `日记/每日/2026-08-11.md::${wbLine}`, effectAllowed: "move" };
  const dragEvt = new dom.window.Event("dragstart", { bubbles: true, cancelable: true });
  dragEvt.dataTransfer = fdt;
  wbCard.dispatchEvent(dragEvt);
  const dropEvt = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  dropEvt.dataTransfer = fdt;
  colByTitle["明天"].dispatchEvent(dropEvt);
  await new Promise((r) => setTimeout(r, 30));
  const afterDrop = readFile("日记/每日/2026-08-11.md").split("\n");
  check("拖到明天列：行标签变为 #明天", afterDrop.some((l) => l.includes("写周报") && l.includes("#明天")), afterDrop.find((l) => l.includes("写周报")));

  // 拖「无标签任务」到以后列：行尾追加标签
  const f11after = readFile("日记/每日/2026-08-11.md");
  const noTagLine = f11after.split("\n").findIndex((l) => l.includes("无标签任务"));
  const fdt2 = { setData: () => {}, getData: () => `日记/每日/2026-08-11.md::${noTagLine}` };
  const dragEvt2 = new dom.window.Event("dragstart", { bubbles: true, cancelable: true });
  dragEvt2.dataTransfer = fdt2;
  const noTagCard = Array.from(todayCol.querySelectorAll(".jd-card-item")).find((c) => c.querySelector(".jd-card-item-text")?.textContent.includes("无标签任务"));
  noTagCard.dispatchEvent(dragEvt2);
  const dropEvt2 = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  dropEvt2.dataTransfer = fdt2;
  colByTitle["以后"].dispatchEvent(dropEvt2);
  await new Promise((r) => setTimeout(r, 30));
  check("无标签任务拖到以后列：行尾追加 #以后", readFile("日记/每日/2026-08-11.md").split("\n").some((l) => l.includes("无标签任务") && l.includes("#以后")));

  console.log("══ 测试 5：新增任务 ══");
  dom.window.prompt = () => "测试新任务";
  const addBtn = Array.from(colByTitle["明天"].querySelectorAll("button")).find((b) => b.textContent.includes("明天"));
  addBtn.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  const f11afterAdd = readFile("日记/每日/2026-08-11.md");
  check("今日日记已追加任务", f11afterAdd.includes("- [ ] 测试新任务 #明天"));
  const lines = f11afterAdd.split("\n");
  const addIdx = lines.findIndex((l) => l.includes("测试新任务"));
  const nextHead = lines.slice(addIdx + 1).findIndex((l) => /^##\s/.test(l));
  check("追加位置在「今日事」区块内（下一个标题前）", nextHead !== -1 || lines.slice(addIdx + 1).every((l) => !l.trim()), `下一标题距 ${nextHead}`);

  console.log("══ 测试 6：设置变更即时生效 ══");
  // 加一列
  plugin3.settings.columns.push({ key: "col-nextweek", label: "下周", tags: ["#下周"], color: "#00AA00" });
  plugin3.refreshDashboardViews();
  await new Promise((r) => setTimeout(r, 30));
  const cols2 = Array.from(root.querySelectorAll(".jd-col"));
  check("新增列后渲染 6 列", cols2.length === 6, `实际 ${cols2.length}`);
  const titles2 = cols2.map((c) => colTitleText(c).replace(/\s*\(\d+\)\s*$/, ""));
  check("新列「下周」出现", titles2.includes("下周"));
  // 关闭今日卡片
  plugin3.settings.showTodayCard = false;
  plugin3.refreshDashboardViews();
  await new Promise((r) => setTimeout(r, 30));
  check("关闭今日卡片开关后卡片消失", !root.querySelector(".jd-today"));
  plugin3.settings.showTodayCard = true;
  plugin3.refreshDashboardViews();
  await new Promise((r) => setTimeout(r, 30));
  check("重新开启今日卡片恢复", !!root.querySelector(".jd-today"));

  console.log("══ 测试 7：设置页动态列管理 ══");
  // 使用 plugin2 的设置页 tab（已在测试 0 调用过 display）
  const tabPlugin = p2Tab.plugin;
  const sTabEl = p2Tab.containerEl;
  const rowCount = () => sTabEl.querySelectorAll(".jd-settings-row").length;
  const before = rowCount();
  check("初始渲染 4 个列行", before === 4, `实际 ${before}`);
  const addColBtn = sTabEl.querySelector(".jd-settings-add");
  addColBtn.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  check("点击「＋ 添加列」后新增一行", rowCount() === before + 1, `实际 ${rowCount()}`);
  check("新增列已加入设置", tabPlugin.settings.columns.length === before + 1);
  const delBtns = Array.from(sTabEl.querySelectorAll(".jd-settings-del"));
  delBtns[delBtns.length - 1].dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  check("点击删除后行减少", rowCount() === before, `实际 ${rowCount()}`);
  check("删除后设置列数恢复", tabPlugin.settings.columns.length === before);
  // 只有 1 列时删除按钮禁用
  while (tabPlugin.settings.columns.length > 1) {
    const btns = Array.from(sTabEl.querySelectorAll(".jd-settings-del"));
    btns[btns.length - 1].dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  }
  const lastDel = sTabEl.querySelector(".jd-settings-del");
  check("仅剩 1 列时删除按钮禁用", lastDel.disabled === true);
  check("仅剩 1 列时添加按钮可用", sTabEl.querySelector(".jd-settings-add").disabled === false);

  console.log("══ 测试 8：打开完整看板 ══");
  openedFiles.length = 0;
  const openBoardBtn = Array.from(root.querySelectorAll(".jd-board-header button")).find((b) => b.textContent.includes("打开完整看板"));
  openBoardBtn.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  check("点击打开完整看板 → 打开看板文件", openedFiles.some((f) => f.path === "日记/每日/Kanban-1786411859061.md"), JSON.stringify(openedFiles));

  console.log("══ 测试 9：新建日记（插件自主渲染，内嵌模板回退） ══");
  // 测试 vault 没有插件模板文件 → 走内嵌 TEMPLATES 回退
  fs.rmSync(path.join(TEST_ROOT, "日记/每日/2026-08-11.md"), { force: true });
  plugin3.executeCreateCommand("create-daily");
  await new Promise((r) => setTimeout(r, 80));
  const newDaily = readFile("日记/每日/2026-08-11.md");
  check("日记文件已创建", fs.existsSync(path.join(TEST_ROOT, "日记/每日/2026-08-11.md")));
  check("frontmatter date 渲染", newDaily.includes("date: 2026-08-11"));
  check("frontmatter weekday 渲染（星期二）", newDaily.includes("weekday: 星期二"));
  check("frontmatter week 渲染格式", /week: \d{4}-W\d{2}/.test(newDaily));
  check("mood 渲染（选择器第一个选项 😄）", newDaily.includes("mood: 😄"));
  check("无占位符残留", !newDaily.includes("{{"), newDaily.slice(0, 120));
  check("今日事含 3 个 #今天 任务", (newDaily.match(/#今天/g) ?? []).length === 3);
  check("{{cursor}} 已移除", !newDaily.includes("{{cursor}}"));
  check("互链渲染 [[prev]] [[next]]", /<< \[\[2026-08-10\]\] \| \[\[2026-08-12\]\] >>/.test(newDaily));
  check("创建后打开文件", openedFiles.some((f) => f.path === "日记/每日/2026-08-11.md"));
  const cursorLine = cursorPos ? cursorPos[0] : -1;
  const cursorLineText = newDaily.split("\n")[cursorLine] ?? "";
  check("光标定位到首个任务内容处", /^- \[ \]  #今天$/.test(cursorLineText), `line ${cursorLine}: "${cursorLineText}"`);

  console.log("══ 测试 10：新建周记（自主渲染） ══");
  fs.mkdirSync(path.join(TEST_ROOT, "日记/每周"), { recursive: true });
  openedFiles.length = 0;
  plugin3.executeCreateCommand("create-weekly");
  await new Promise((r) => setTimeout(r, 80));
  const weeklyFiles = fs.readdirSync(path.join(TEST_ROOT, "日记/每周")).filter((f) => f.endsWith(".md"));
  check("周记文件已创建（ISO 周命名）", weeklyFiles.length === 1 && /^\d{4}-W\d{2}\.md$/.test(weeklyFiles[0]), weeklyFiles.join(","));
  const newWeekly = readFile(`日记/每周/${weeklyFiles[0]}`);
  check("周记 week 渲染", /week: \d{4}-W\d{2}/.test(newWeekly));
  check("周记 range 渲染（MM-DD ~ MM-DD）", /range: \d{2}-\d{2} ~ \d{2}-\d{2}/.test(newWeekly));
  const weekDays = newWeekly.match(/!\[\[(\d{4}-\d{2}-\d{2})\]\]/g) ?? [];
  check("本周日记嵌入 7 天", weekDays.length === 7, `实际 ${weekDays.length}`);
  check("周记无占位符残留", !newWeekly.includes("{{"));

  console.log("══ 测试 11：模板文件优先（用户可编辑模板生效） ══");
  // 复制真实插件模板到测试 vault → 走文件分支
  const tplDir = path.join(TEST_ROOT, ".obsidian/plugins/journal-dashboard/templates");
  fs.mkdirSync(tplDir, { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_DIR, "templates/TPL-日记.md"), path.join(tplDir, "TPL-日记.md"));
  // 修改模板内容验证用户编辑生效
  const custom = fs.readFileSync(path.join(tplDir, "TPL-日记.md"), "utf8").replace("## 🎯 今日事", "## 🎯 今日任务（用户自定义标题）");
  fs.writeFileSync(path.join(tplDir, "TPL-日记.md"), custom);
  fs.rmSync(path.join(TEST_ROOT, "日记/每日/2026-08-11.md"), { force: true });
  plugin3.executeCreateCommand("create-daily");
  await new Promise((r) => setTimeout(r, 80));
  const customDaily = readFile("日记/每日/2026-08-11.md");
  check("用户修改的模板标题生效", customDaily.includes("## 🎯 今日任务（用户自定义标题）"));
  check("文件分支渲染正常（mood 选择）", customDaily.includes("mood: 😄"));
  check("文件分支无占位符残留", !customDaily.includes("{{"));

  // ---------- 汇总 ----------
  console.log(`\n════ 结果：${pass} 通过 / ${fail} 失败 ════`);
  if (failures.length) {
    console.log("失败项：");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
  // 清理（等待遗留异步 render 完成）
  await new Promise((r) => setTimeout(r, 100));
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
}

main().catch((e) => {
  console.error("测试运行异常:", e);
  process.exitCode = 1;
});
