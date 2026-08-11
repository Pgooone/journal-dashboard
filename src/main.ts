import {
  MarkdownRenderChild,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  TFile,
  TFolder,
  WorkspaceLeaf,
  type App,
} from "obsidian";
import { TEMPLATES } from "./templates";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "./view";
import { renderDailyBoard } from "./daily-board";
import {
  DEFAULT_SETTINGS,
  JournalDashboardSettingTab,
  mergeSettings,
  type CreateCommandSettings,
  type FilenameMode,
  type JournalDashboardSettings,
} from "./settings";

// ===== 工具函数 =====

/** 简易日期格式化（YYYY/MM/DD/HH/mm） */
function formatDate(d: Date, fmt: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm/g, (k) => map[k]);
}

/** ISO 8601 周编号，如 2026-W33 */
function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** 从 settings 派生一键搭建的目录清单（各路径所有祖先去重；默认值展开恰为原 10 个目录） */
function deriveFolders(s: JournalDashboardSettings): string[] {
  const set = new Set<string>();
  const add = (path: string) => {
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      set.add(cur);
    }
  };
  add(s.dailyFolder);
  add(s.weeklyFolder);
  add(s.inboxFolder);
  add(s.templateDir);
  add(s.userScriptsFolder);
  for (const c of s.commands) if (c.folder) add(c.folder);
  return [...set];
}

// ===== 模板渲染（自主渲染，不依赖 Templater） =====

/** 模板渲染上下文（由 buildContext 生成） */
interface RenderContext {
  date: string;
  time: string;
  weekday: string;
  week: string;
  weekRange: string;
  weekRangeFull: string; // YYYY-MM-DD ~ YYYY-MM-DD（日记/周记 week 字段用）
  prev: string;
  next: string;
  prevWeek: string;
  nextWeek: string;
  weekDays: string;
  title: string;
  subject: string;
}

/** 交互选项（选择弹窗用） */
interface Option {
  label: string;
  value: string;
}

const MOODS: Option[] = [
  { label: "😄 很好", value: "😄" },
  { label: "🙂 还行", value: "🙂" },
  { label: "😐 一般", value: "😐" },
  { label: "😪 疲惫", value: "😪" },
  { label: "😣 糟糕", value: "😣" },
];
const PROJECT_STATUS: Option[] = [
  { label: "未开始", value: "10-todo" },
  { label: "进行中", value: "50-doing" },
  { label: "暂停", value: "70-hold" },
  { label: "已完成", value: "90-done" },
];
const RATINGS: Option[] = [
  { label: "★★★★★", value: "★★★★★" },
  { label: "★★★★☆", value: "★★★★☆" },
  { label: "★★★☆☆", value: "★★★☆☆" },
  { label: "★★☆☆☆", value: "★★☆☆☆" },
  { label: "★☆☆☆☆", value: "★☆☆☆☆" },
  { label: "未评分", value: "" },
];

/** 通用选项选择弹窗 */
class OptionModal extends Modal {
  constructor(app: App, title: string, options: Option[], onPick: (v: string) => void) {
    super(app);
    this.setTitle(title);
    for (const o of options) {
      const btn = this.contentEl.createEl("button", { text: o.label });
      btn.addClass("jd-modal-option");
      btn.addEventListener("click", () => {
        this.close();
        onPick(o.value);
      });
    }
  }
}

export default class JournalDashboardPlugin extends Plugin {
  settings: JournalDashboardSettings = DEFAULT_SETTINGS;

  /** 模板目录：设置留空时使用插件内置模板目录 */
  private templateDir(): string {
    return this.settings.templateDir || `${this.manifest.dir}/templates`;
  }

  async onload() {
    this.settings = mergeSettings(await this.loadData());

    // 创建命令组：用模板直接创建笔记（名称/模板/文件夹可设置）
    this.registerCreateCommands();

    // 日记面板
    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.addCommand({
      id: "open-dashboard",
      name: "打开日记面板",
      callback: () => void this.activateView(),
    });
    this.addRibbonIcon("calendar-days", "打开日记面板", () => void this.activateView());

    // 设置界面
    this.addSettingTab(new JournalDashboardSettingTab(this.app, this));

    // 日记内嵌看板：```journal-board 代码块 → 阅读/编辑视图渲染当天看板
    // 稳定容器 + vault.modify 事件：编辑日记后看板实时刷新
    this.registerMarkdownCodeBlockProcessor("journal-board", (source, el, ctx) => {
      const host = new MarkdownRenderChild(el);
      ctx.addChild(host);
      const rerender = () => renderDailyBoard(this.app, this, el, ctx.sourcePath);
      host.registerEvent(
        this.app.vault.on("modify", (f) => {
          if (f.path === ctx.sourcePath) void rerender();
        })
      );
      // 编辑模式（CodeMirror）容器可能因布局未就绪而宽度为 0，
      // 延迟到布局完成后再渲染，避免内容被挤压为 0 宽
      const render = () => {
        if (el.offsetWidth === 0 && el.isConnected) {
          requestAnimationFrame(render);
          return;
        }
        void rerender();
      };
      render();
      return rerender();
    });

    // 首次启用时自动搭建（幂等；可关闭）
    if (this.settings.autoSetup) {
      this.app.workspace.onLayoutReady(() => void this.setup());
    }
  }

  /** 从设置注册创建命令 */
  private registerCreateCommands() {
    for (const cmd of this.settings.commands) {
      this.addCommand({
        id: cmd.id,
        name: cmd.name,
        callback: () => void this.createNote(cmd),
      });
    }
  }

  /** 命令名变更时同步（removeCommand + 重注册；快捷键按 id 存储不受影响） */
  syncCreateCommands() {
    const commands = (this.app as any).commands as
      | { commands: Record<string, { name: string }>; removeCommand(id: string): void }
      | undefined;
    if (!commands) return;
    for (const cmd of this.settings.commands) {
      const id = `${this.manifest.id}:${cmd.id}`;
      const existing = commands.commands?.[id];
      if (existing && existing.name !== cmd.name) {
        commands.removeCommand(id);
        this.addCommand({
          id: cmd.id,
          name: cmd.name,
          callback: () => void this.createNote(cmd),
        });
      }
    }
  }

  /** 供 view 等调用：执行指定 id 的创建命令 */
  executeCreateCommand(id: string) {
    const cmd = this.settings.commands.find((c) => c.id === id);
    if (cmd) void this.createNote(cmd);
  }

  /** 设置变更后刷新所有已打开的面板 */
  refreshDashboardViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)) {
      if (leaf.view instanceof DashboardView) void leaf.view.render();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** 打开日记面板（侧边栏，已打开则聚焦） */
  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | undefined =
      workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
      }
    }
    if (!leaf) return;
    workspace.revealLeaf(leaf);
  }

  // ================= 创建笔记（自主渲染，直接写入） =================

  /** 按 filenameMode 生成文件名（交互模式可能取消，返回 null） */
  private async computeFilename(
    mode: FilenameMode,
    onSubject?: (s: string) => void
  ): Promise<string | null> {
    switch (mode) {
      case "date":
        return formatDate(new Date(), "YYYY-MM-DD");
      case "week":
        return isoWeek(new Date());
      case "meeting-date": {
        const subject = await this.promptInput("会议主题", "未命名会议");
        onSubject?.(subject);
        return `会议 ${formatDate(new Date(), "YYYY-MM-DD")} ${subject}`;
      }
      default: {
        const v = window.prompt("新笔记名称（留空取消）：", "");
        return v?.trim() ? v.trim() : null;
      }
    }
  }

  /** 生成模板渲染上下文（日期/周/互链/本周日记等） */
  private buildContext(title: string, subject: string): RenderContext {
    const now = new Date();
    const dayMs = 86400000;
    const date = formatDate(now, "YYYY-MM-DD");
    const prev = formatDate(new Date(now.getTime() - dayMs), "YYYY-MM-DD");
    const next = formatDate(new Date(now.getTime() + dayMs), "YYYY-MM-DD");
    const week = isoWeek(now);
    // 本周一（getDay: 0=周日 → 7）
    const monday = new Date(now.getTime() - ((now.getDay() || 7) - 1) * dayMs);
    const sunday = new Date(monday.getTime() + 6 * dayMs);
    const mmdd = (d: Date) => formatDate(d, "MM-DD");
    const yyyymmdd = (d: Date) => formatDate(d, "YYYY-MM-DD");
    const weekDays: string[] = [];
    for (let i = 0; i < 7; i++) {
      weekDays.push(`![[${yyyymmdd(new Date(monday.getTime() + i * dayMs))}]]`);
    }
    return {
      date,
      time: formatDate(now, "HH:mm"),
      weekday: now.toLocaleDateString("zh-CN", { weekday: "long" }),
      week,
      weekRange: `${mmdd(monday)} ~ ${mmdd(sunday)}`,
      weekRangeFull: `${yyyymmdd(monday)} ~ ${yyyymmdd(sunday)}`,
      prev,
      next,
      prevWeek: isoWeek(new Date(now.getTime() - 7 * dayMs)),
      nextWeek: isoWeek(new Date(now.getTime() + 7 * dayMs)),
      weekDays: weekDays.join("\n"),
      title,
      subject,
    };
  }

  /** 通用选项选择弹窗（Esc/关闭时回退默认值，命令不挂起） */
  private pickOption(title: string, options: Option[]): Promise<string> {
    return new Promise((resolve) => {
      const modal = new OptionModal(this.app, title, options, (v) => resolve(v));
      modal.onClose = () => resolve(options[0]?.value ?? "");
      modal.open();
    });
  }

  /** 文本输入（Obsidian 环境 window.prompt 可用） */
  private async promptInput(promptText: string, def = ""): Promise<string> {
    const v = window.prompt(promptText, def);
    return v?.trim() || def;
  }

  /**
   * 渲染模板：替换静态占位符 → 交互占位符（弹窗）→ {{cursor}} 定位标记。
   * 返回最终内容与光标位置（行/列，0-based）。
   */
  private async renderTemplate(
    raw: string,
    ctx: RenderContext
  ): Promise<{ content: string; cursor: { line: number; col: number } | null }> {
    let content = raw;
    const statics: [string, string][] = [
      ["{{date}}", ctx.date],
      ["{{time}}", ctx.time],
      ["{{weekday}}", ctx.weekday],
      ["{{week}}", ctx.week],
      ["{{week_range}}", ctx.weekRange],
      ["{{week_range_full}}", ctx.weekRangeFull],
      ["{{prev}}", ctx.prev],
      ["{{next}}", ctx.next],
      ["{{prev_week}}", ctx.prevWeek],
      ["{{next_week}}", ctx.nextWeek],
      ["{{week_days}}", ctx.weekDays],
      ["{{title}}", ctx.title],
    ];
    for (const [ph, v] of statics) content = content.split(ph).join(v);

    if (content.includes("{{mood}}")) {
      const mood = await this.pickOption("今天心情如何？", MOODS);
      content = content.split("{{mood}}").join(mood);
    }
    if (content.includes("{{status}}")) {
      const status = await this.pickOption("项目状态", PROJECT_STATUS);
      content = content.split("{{status}}").join(status);
    }
    if (content.includes("{{rating}}")) {
      const rating = await this.pickOption("评分", RATINGS);
      content = content.split("{{rating}}").join(rating);
    }
    if (content.includes("{{subject}}")) {
      const subject = ctx.subject || (await this.promptInput("会议主题", "未命名会议"));
      content = content.split("{{subject}}").join(subject);
    }
    if (content.includes("{{author}}")) {
      const author = await this.promptInput("作者", "");
      content = content.split("{{author}}").join(author);
    }

    // 统一任务行尾空格（- [ ] / - [x] 后补一个空格），保证 Obsidian 预览一致渲染为勾选框
    content = content.replace(/^[ \t]*-[ \t]*\[([ xX])\][ \t]*$/gm, (_m, s: string) => `- [${s}] `);

    let cursor: { line: number; col: number } | null = null;
    const idx = content.indexOf("{{cursor}}");
    if (idx !== -1) {
      const before = content.slice(0, idx);
      cursor = {
        line: before.split("\n").length - 1,
        col: before.length - before.lastIndexOf("\n") - 1,
      };
      // 保留行尾空格（如 "- [ ] {{cursor}}" → "- [ ] "），
      // 否则任务行无尾空格会被 Obsidian 预览渲染为普通列表
      content = content.replace("{{cursor}}", " ");
    }
    return { content, cursor };
  }

  /** 用模板创建笔记（插件自主渲染，直接写入文件，不依赖 Templater） */
  async createNote(cmd: CreateCommandSettings) {
    const folder = this.app.vault.getAbstractFileByPath(cmd.folder);
    if (!(folder instanceof TFolder)) {
      new Notice(`文件夹不存在：${cmd.folder}\n请先在设置中确认路径`);
      return;
    }

    // 1. 读取模板：优先模板目录文件，缺失时回退内嵌默认
    let templateContent: string | undefined;
    const templateFile = this.app.vault.getAbstractFileByPath(cmd.template);
    if (templateFile instanceof TFile) {
      templateContent = await this.app.vault.read(templateFile);
    } else {
      const name = cmd.template.split("/").pop() ?? "";
      templateContent = TEMPLATES[name];
      if (!templateContent) {
        new Notice(`模板不存在：${cmd.template}`);
        return;
      }
    }

    // 2. 文件名（交互模式可能取消）
    let subject = "";
    const filename = await this.computeFilename(cmd.filenameMode, (s) => (subject = s));
    if (!filename) return;

    // 3. 渲染
    const ctx = this.buildContext(filename, subject);
    const { content, cursor } = await this.renderTemplate(templateContent, ctx);

    // 4. 创建文件
    let file: TFile;
    try {
      file = await this.app.vault.create(`${cmd.folder}/${filename}.md`, content);
    } catch (e) {
      console.error("[日记面板] 创建笔记失败", e);
      new Notice(`创建失败：${(e as Error).message}`);
      return;
    }

    // 5. 打开并定位光标
    await this.app.workspace.getLeaf(false).openFile(file);
    if (cursor) {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view && view.file?.path === file.path) {
        view.editor.setCursor(cursor.line, cursor.col);
      }
    }
  }

  /** 一键搭建/恢复模板库（幂等；forceOverwrite 时强制覆写外部配置） */
  async setup() {
    const notice: string[] = [];
    const adapter = this.app.vault.adapter;
    const s = this.settings;

    // 1. 创建目录结构（已存在则跳过）
    for (const folder of deriveFolders(s)) {
      if (!(await adapter.exists(folder))) {
        await this.app.vault.createFolder(folder);
        notice.push(`新建文件夹 ${folder}`);
      }
    }

    // 2. 安装模板（目标已存在则跳过，不覆盖用户修改）
    for (const [name, content] of Object.entries(TEMPLATES)) {
      const target = `${this.templateDir()}/${name}`;
      if (!(await adapter.exists(target))) {
        await adapter.write(target, content);
        notice.push(`新建模板 ${name}`);
      }
    }

    // 3. 核心插件「日记」
    const daily = await this.readJson(".obsidian/daily-notes.json");
    if (s.forceOverwrite || !daily.folder) daily.folder = s.dailyFolder;
    if (s.forceOverwrite || !daily.format) daily.format = "YYYY-MM-DD";
    if (s.forceOverwrite || !daily.template)
      daily.template = `${this.templateDir()}/TPL-日记.md`;
    await this.writeJson(".obsidian/daily-notes.json", daily);

    // 4. 运行时同步（立即生效，无需重启）
    this.syncRuntime();

    if (notice.length > 0) {
      new Notice(`模板库搭建完成：\n${notice.join("\n")}`);
    } else {
      new Notice("模板库已是最新状态");
    }
  }

  async readJson(path: string): Promise<Record<string, any>> {
    const adapter = this.app.vault.adapter;
    try {
      if (await adapter.exists(path)) {
        return JSON.parse(await adapter.read(path));
      }
    } catch (e) {
      console.warn(`[日记面板] 读取 ${path} 失败`, e);
    }
    return {};
  }

  async writeJson(path: string, data: Record<string, any>) {
    await this.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
  }

  syncRuntime() {
    try {
      // 核心插件「日记」
      const dn = (this.app as any).internalPlugins.getPluginById("daily-notes")?.instance;
      if (dn && dn.options) {
        if (!dn.options.folder) dn.options.folder = this.settings.dailyFolder;
        if (!dn.options.format) dn.options.format = "YYYY-MM-DD";
        if (!dn.options.template)
          dn.options.template = `${this.templateDir()}/TPL-日记.md`;
      }
    } catch (e) {
      console.warn("[日记面板] 运行时同步失败", e);
    }
  }
}
