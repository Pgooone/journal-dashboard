import { Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { TEMPLATES } from "./templates";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "./view";
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

/** 按 filenameMode 生成自动文件名；prompt 返回 undefined（由 Templater 弹窗输入） */
function computeFilename(mode: FilenameMode): string | undefined {
  switch (mode) {
    case "date":
      return formatDate(new Date(), "YYYY-MM-DD");
    case "week":
      return isoWeek(new Date());
    case "meeting-date":
      return `会议 ${formatDate(new Date(), "YYYY-MM-DD")}`;
    default:
      return undefined;
  }
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

/** 从 settings.commands 派生 Templater 文件夹模板映射（日记/周记/速记/会议） */
function deriveTemplaterMappings(s: JournalDashboardSettings) {
  const wanted = new Set([
    "create-daily",
    "create-weekly",
    "create-fleeting",
    "create-meeting",
  ]);
  return s.commands
    .filter((c) => wanted.has(c.id) && c.template && c.folder)
    .map((c) => ({ folder: c.folder, template: c.template }));
}

export default class JournalDashboardPlugin extends Plugin {
  settings: JournalDashboardSettings = DEFAULT_SETTINGS;

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

  /** 用模板创建笔记（调用 Templater 渲染，确保日期/选择器/光标正常） */
  async createNote(cmd: CreateCommandSettings) {
    const tp = (this.app as any).plugins.plugins["templater-obsidian"];
    if (!tp || !tp.templater) {
      new Notice("请先安装并启用 Templater 插件");
      return;
    }
    const template = this.app.vault.getAbstractFileByPath(cmd.template);
    const folder = this.app.vault.getAbstractFileByPath(cmd.folder);
    if (!(template instanceof TFile)) {
      new Notice(`模板不存在：${cmd.template}\n请先运行「一键搭建/恢复模板库」`);
      return;
    }
    if (!(folder instanceof TFolder)) {
      new Notice(`文件夹不存在：${cmd.folder}\n请先运行「一键搭建/恢复模板库」`);
      return;
    }
    try {
      const filename = computeFilename(cmd.filenameMode);
      await tp.templater.create_new_note_from_template(
        template,
        folder,
        filename,
        true
      );
    } catch (e) {
      console.error("[日记面板] 创建笔记失败", e);
      new Notice(`创建失败：${(e as Error).message}`);
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
      const target = `${s.templateDir}/${name}`;
      if (!(await adapter.exists(target))) {
        await adapter.write(target, content);
        notice.push(`新建模板 ${name}`);
      }
    }

    // 3. Templater 配置（默认仅填空缺项，保留用户已有配置；forceOverwrite 时直接写）
    const tplDataPath = ".obsidian/plugins/templater-obsidian/data.json";
    const templaterInstalled = await adapter.exists(
      ".obsidian/plugins/templater-obsidian/manifest.json"
    );
    if (templaterInstalled) {
      const data = await this.readJson(tplDataPath);
      if (s.forceOverwrite || !data.templates_folder)
        data.templates_folder = s.templateDir;
      if (s.forceOverwrite || !data.trigger_on_file_creation_mode)
        data.trigger_on_file_creation_mode = "folder";
      if (s.forceOverwrite || !data.folder_templates || data.folder_templates.length === 0)
        data.folder_templates = deriveTemplaterMappings(s);
      if (s.forceOverwrite || !data.user_scripts_folder)
        data.user_scripts_folder = s.userScriptsFolder;
      await this.writeJson(tplDataPath, data);
      notice.push("写入 Templater 文件夹模板映射");
    }

    // 4. 核心插件「模板」
    const tplCore = await this.readJson(".obsidian/templates.json");
    if (s.forceOverwrite || !tplCore.folder) tplCore.folder = s.templateDir;
    await this.writeJson(".obsidian/templates.json", tplCore);

    // 5. 核心插件「日记」
    const daily = await this.readJson(".obsidian/daily-notes.json");
    if (s.forceOverwrite || !daily.folder) daily.folder = s.dailyFolder;
    if (s.forceOverwrite || !daily.format) daily.format = "YYYY-MM-DD";
    if (s.forceOverwrite || !daily.template)
      daily.template = `${s.templateDir}/TPL-日记.md`;
    await this.writeJson(".obsidian/daily-notes.json", daily);

    // 6. 运行时同步（立即生效，无需重启）
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
      // Templater（已启用时同步内存设置）
      const tp = (this.app as any).plugins.plugins["templater-obsidian"];
      if (tp && tp.settings) {
        if (!tp.settings.templates_folder)
          tp.settings.templates_folder = this.settings.templateDir;
        if (!tp.settings.folder_templates || tp.settings.folder_templates.length === 0)
          tp.settings.folder_templates = deriveTemplaterMappings(this.settings);
        if (!tp.settings.user_scripts_folder)
          tp.settings.user_scripts_folder = this.settings.userScriptsFolder;
        if (typeof tp.saveSettings === "function") tp.saveSettings();
      }
      // 核心插件「模板」
      const templates = (
        this.app as any
      ).internalPlugins.getPluginById("templates")?.instance;
      if (templates && templates.options && !templates.options.folder)
        templates.options.folder = this.settings.templateDir;
      // 核心插件「日记」
      const dn = (this.app as any).internalPlugins.getPluginById("daily-notes")?.instance;
      if (dn && dn.options) {
        if (!dn.options.folder) dn.options.folder = this.settings.dailyFolder;
        if (!dn.options.format) dn.options.format = "YYYY-MM-DD";
        if (!dn.options.template)
          dn.options.template = `${this.settings.templateDir}/TPL-日记.md`;
      }
    } catch (e) {
      console.warn("[日记面板] 运行时同步失败", e);
    }
  }
}
