import { App, PluginSettingTab, Setting } from "obsidian";
import type JournalDashboardPlugin from "./main";

// ===== 类型定义 =====

export interface BoardColumnSettings {
  key: string; // 内部唯一标识（不影响标签、不写入看板文件）
  label: string; // 列显示名（今天）
  tags: string[]; // 匹配标签（含 #，第一个为写回标签）
  color: string; // 列顶条颜色（hex）
}

export const FILENAME_MODES = ["date", "week", "meeting-date", "prompt"] as const;
export type FilenameMode = (typeof FILENAME_MODES)[number];

export interface CreateCommandSettings {
  id: string; // 固定命令 id（journal-dashboard:create-daily）
  name: string; // 命令显示名
  template: string; // 模板文件路径
  folder: string; // 目标文件夹
  filenameMode: FilenameMode; // 自动文件名策略
}

export interface JournalDashboardSettings {
  // 基础路径
  dailyFolder: string;
  weeklyFolder: string;
  inboxFolder: string;
  boardFile: string;
  templateDir: string;
  userScriptsFolder: string;
  todaySection: string;
  // 任务看板
  columns: BoardColumnSettings[];
  defaultColumnKey: string; // 无标签任务默认列
  showBoard: boolean;
  doneCollapsed: boolean; // 已完成列初始收起
  // 面板卡片
  showTodayCard: boolean;
  showWeekCard: boolean;
  showRecentCard: boolean;
  showInboxCard: boolean;
  recentCount: number;
  inboxCount: number;
  // 创建命令
  commands: CreateCommandSettings[];
  // 模板库
  autoSetup: boolean; // 首次启用自动搭建
  forceOverwrite: boolean; // 一键搭建时强制覆写 Templater/日记/模板配置
}

// ===== 工具函数 =====

/** 生成唯一列 key */
export function genKey(): string {
  return `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 标签归一化：去空白、去前导 #、空则丢弃、补 # 前缀 */
export function normalizeTag(t: string): string {
  const s = t.trim().replace(/^#+/, "");
  return s ? "#" + s : "";
}

/** 正则元字符转义（用户标签进正则前必须转义） */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 从行文本提取标签（Obsidian 标签语法，中文/字母/数字/_/-// 均可） */
export function extractTags(text: string): string[] {
  return text.match(/#[\p{L}\p{N}_/-]+/gu) ?? [];
}

function isFilenameMode(v: unknown): v is FilenameMode {
  return typeof v === "string" && (FILENAME_MODES as readonly string[]).includes(v);
}

// ===== 默认设置（与 my-template-library 现有硬编码逐项一致） =====

export const DEFAULT_SETTINGS: JournalDashboardSettings = {
  dailyFolder: "日记/每日",
  weeklyFolder: "日记/每周",
  inboxFolder: "",
  boardFile: "日记/每日/Kanban-1786411859061.md",
  templateDir: "",
  userScriptsFolder: "",
  todaySection: "## 🎯 今日事",
  columns: [
    { key: "today", label: "今天", tags: ["#今天"], color: "#FF5733" },
    { key: "tomorrow", label: "明天", tags: ["#明天"], color: "#FFA500" },
    { key: "thisweek", label: "本周", tags: ["#本周"], color: "#4A90D9" },
    { key: "later", label: "以后", tags: ["#以后", "#later"], color: "#8E8E93" },
  ],
  defaultColumnKey: "today",
  showBoard: true,
  doneCollapsed: true,
  showTodayCard: true,
  showWeekCard: true,
  showRecentCard: true,
  showInboxCard: false,
  recentCount: 7,
  inboxCount: 5,
  commands: [
    { id: "create-daily", name: "新建日记", template: ".obsidian/plugins/journal-dashboard/templates/TPL-日记.md", folder: "日记/每日", filenameMode: "date" },
    { id: "create-weekly", name: "新建周记", template: ".obsidian/plugins/journal-dashboard/templates/TPL-周记.md", folder: "日记/每周", filenameMode: "week" },
  ],
  autoSetup: true,
  forceOverwrite: false,
};

// ===== 合并（数组字段需单独重建，避免 {...defaults, ...data} 的数组覆盖陷阱） =====

export function mergeSettings(data: unknown): JournalDashboardSettings {
  const d = (data ?? {}) as Record<string, unknown>;
  const s: JournalDashboardSettings = { ...DEFAULT_SETTINGS, ...d };

  // columns：逐项校验 + tags 归一化
  if (Array.isArray(d.columns) && d.columns.length > 0) {
    s.columns = (d.columns as Record<string, unknown>[]).map((c, i) => ({
      key: typeof c.key === "string" && c.key ? c.key : genKey(),
      label: typeof c.label === "string" && c.label ? c.label : `列 ${i + 1}`,
      color: typeof c.color === "string" && c.color ? c.color : "#888888",
      tags: Array.isArray(c.tags)
        ? (c.tags as unknown[])
            .filter((t): t is string => typeof t === "string")
            .map(normalizeTag)
            .filter(Boolean)
        : [],
    }));
  } else {
    s.columns = DEFAULT_SETTINGS.columns.map((c) => ({ ...c, tags: [...c.tags] }));
  }

  // commands：按 id 关联默认值合并，缺失的默认 id 自动补齐
  const byId = new Map<string, CreateCommandSettings>();
  for (const c of DEFAULT_SETTINGS.commands) byId.set(c.id, { ...c });
  if (Array.isArray(d.commands)) {
    for (const c of d.commands as Record<string, unknown>[]) {
      if (typeof c.id !== "string" || !c.id) continue;
      const def = byId.get(c.id);
      byId.set(c.id, {
        id: c.id,
        name: typeof c.name === "string" && c.name ? c.name : def?.name ?? c.id,
        template:
          typeof c.template === "string" && c.template
            ? c.template
            : def?.template ?? "",
        folder:
          typeof c.folder === "string" && c.folder ? c.folder : def?.folder ?? "",
        filenameMode: isFilenameMode(c.filenameMode)
          ? c.filenameMode
          : def?.filenameMode ?? "prompt",
      });
    }
  }
  s.commands = [...byId.values()];

  // defaultColumnKey 失效回退（列被删时）
  if (!s.columns.some((c) => c.key === s.defaultColumnKey)) {
    s.defaultColumnKey = s.columns[0]?.key ?? "";
  }

  // 数值兜底
  s.recentCount = Math.max(1, Math.min(50, Number(s.recentCount) || 7));
  s.inboxCount = Math.max(1, Math.min(50, Number(s.inboxCount) || 5));
  return s;
}

// ===== 设置界面 =====

export class JournalDashboardSettingTab extends PluginSettingTab {
  plugin: JournalDashboardPlugin;
  /** 列列表删除按钮状态同步（renderColumnRows 内赋值） */
  private syncDeleteButtons: () => void = () => {};
  /** 默认列下拉重建（renderDefaultColumn 内赋值） */
  private refreshDefaultDropdown: () => void = () => {};

  constructor(app: App, plugin: JournalDashboardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private async save() {
    await this.plugin.saveSettings();
    this.plugin.refreshDashboardViews();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderPaths(containerEl);
    this.renderBoardSection(containerEl);
    this.renderCardsSection(containerEl);
    this.renderCommandsSection(containerEl);
    this.renderTemplateSection(containerEl);
  }

  // ===== 基础路径 =====
  private renderPaths(containerEl: HTMLElement) {
    new Setting(containerEl).setName("基础路径").setHeading();

    const paths: { key: keyof JournalDashboardSettings; name: string; desc: string }[] = [
      { key: "dailyFolder", name: "日记文件夹", desc: "面板看板与今日卡片的任务数据源" },
      { key: "weeklyFolder", name: "周记文件夹", desc: "「打开本周周记」跳转目标" },
      { key: "inboxFolder", name: "收件箱文件夹", desc: "收件箱速记卡片的扫描目录" },
      { key: "boardFile", name: "看板文件", desc: "「打开完整看板」跳转的 task-list-kanban 看板文件路径" },
      { key: "templateDir", name: "模板目录", desc: "留空则使用插件内置模板（.obsidian/plugins/journal-dashboard/templates）；填写自定义目录时模板安装到该目录" },
      { key: "userScriptsFolder", name: "脚本文件夹", desc: "Templater user_scripts_folder（留空则不配置脚本目录）" },
      { key: "todaySection", name: "今日事标题", desc: "新增任务追加到该标题区块下（写回定位用）" },
    ];
    for (const p of paths) {
      new Setting(containerEl)
        .setName(p.name)
        .setDesc(p.desc)
        .addText((t) =>
          t
            .setPlaceholder(String(DEFAULT_SETTINGS[p.key]))
            .setValue(String(this.plugin.settings[p.key] ?? ""))
            .onChange(async (v) => {
              (this.plugin.settings[p.key] as string) = v.trim();
              await this.save();
            })
        );
    }
  }

  // ===== 任务看板 =====
  private renderBoardSection(containerEl: HTMLElement) {
    new Setting(containerEl).setName("任务看板").setHeading();

    new Setting(containerEl)
      .setName("显示看板区块")
      .setDesc("面板顶部是否渲染任务看板")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showBoard).onChange(async (v) => {
          this.plugin.settings.showBoard = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("已完成列默认收起")
      .setDesc("重启面板后已完成列保持收起（展开状态仅会话内有效）")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.doneCollapsed).onChange(async (v) => {
          this.plugin.settings.doneCollapsed = v;
          await this.save();
        })
      );

    // ---- 列管理 ----
    new Setting(containerEl).setName("看板列").setHeading();
    this.renderColumnRows(containerEl);
    this.renderDefaultColumn(containerEl);
  }

  /** 列列表：每行独立 DOM，行内修改不重渲染（防焦点丢失） */
  private renderColumnRows(containerEl: HTMLElement) {
    const listEl = document.createElement("div");
    listEl.className = "jd-settings-columns";

    const renderRow = (col: BoardColumnSettings): HTMLDivElement => {
      const row = document.createElement("div");
      row.className = "jd-settings-row";

      const nameEl = document.createElement("input");
      nameEl.type = "text";
      nameEl.placeholder = "列名";
      nameEl.value = col.label;
      nameEl.addEventListener("input", () => {
        col.label = nameEl.value.trim() || col.label;
      });
      nameEl.addEventListener("change", () => void this.save());

      const tagsEl = document.createElement("input");
      tagsEl.type = "text";
      tagsEl.placeholder = "标签，逗号分隔（如 #今天,#今日）";
      tagsEl.value = col.tags.join(",");
      tagsEl.addEventListener("input", () => {
        col.tags = tagsEl.value
          .split(/[,，]/)
          .map(normalizeTag)
          .filter(Boolean);
      });
      tagsEl.addEventListener("change", () => void this.save());

      const colorEl = document.createElement("input");
      colorEl.type = "color";
      colorEl.className = "jd-col-color";
      colorEl.value = col.color;
      colorEl.addEventListener("change", () => {
        col.color = colorEl.value;
        void this.save();
      });

      const delBtn = document.createElement("button");
      delBtn.className = "jd-settings-del";
      delBtn.textContent = "删除";
      delBtn.addEventListener("click", () => {
        const idx = this.plugin.settings.columns.indexOf(col);
        if (idx === -1 || this.plugin.settings.columns.length <= 1) return;
        this.plugin.settings.columns.splice(idx, 1);
        if (this.plugin.settings.defaultColumnKey === col.key) {
          this.plugin.settings.defaultColumnKey =
            this.plugin.settings.columns[0]?.key ?? "";
        }
        row.remove();
        this.syncDeleteButtons();
        this.refreshDefaultDropdown();
        void this.save();
      });

      row.appendChild(nameEl);
      row.appendChild(tagsEl);
      row.appendChild(colorEl);
      row.appendChild(delBtn);
      return row;
    };

    const addBtn = document.createElement("button");
    addBtn.className = "jd-settings-add";
    addBtn.textContent = "＋ 添加列";
    addBtn.addEventListener("click", () => {
      const col: BoardColumnSettings = {
        key: genKey(),
        label: "新列",
        tags: ["#新列"],
        color: "#888888",
      };
      this.plugin.settings.columns.push(col);
      const row = renderRow(col);
      listEl.appendChild(row);
      this.syncDeleteButtons();
      this.refreshDefaultDropdown();
      void this.save();
      (row.querySelector("input") as HTMLInputElement | null)?.focus();
    });

    this.syncDeleteButtons = () => {
      const n = this.plugin.settings.columns.length;
      for (const btn of Array.from(
        listEl.querySelectorAll<HTMLButtonElement>(".jd-settings-del")
      )) {
        btn.disabled = n <= 1;
      }
      addBtn.disabled = n >= 12;
    };
    for (const col of this.plugin.settings.columns) listEl.appendChild(renderRow(col));
    this.syncDeleteButtons();

    containerEl.appendChild(listEl);
    containerEl.appendChild(addBtn);
  }

  /** 无标签任务默认列下拉（列增删时全量重建选项，不整页重渲染） */
  private renderDefaultColumn(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("无标签任务默认列")
      .setDesc("任务没有匹配任何列标签时归入的列（与模板预置 #今天 一致）")
      .addDropdown((dd) => {
        this.refreshDefaultDropdown = () => {
          // 清空全部选项（DOM 层），再按当前列重建
          dd.selectEl.querySelectorAll("option").forEach((o) => o.remove());
          for (const c of this.plugin.settings.columns) {
            dd.addOption(c.key, c.label);
          }
          dd.setValue(this.plugin.settings.defaultColumnKey);
        };
        this.refreshDefaultDropdown();
        dd.onChange(async (v) => {
          this.plugin.settings.defaultColumnKey = v;
          await this.save();
        });
      });
  }

  // ===== 面板卡片 =====
  private renderCardsSection(containerEl: HTMLElement) {
    new Setting(containerEl).setName("面板卡片").setHeading();

    const toggles: { key: keyof JournalDashboardSettings; name: string; desc: string }[] = [
      { key: "showTodayCard", name: "今日卡片", desc: "今日日记、心情、未完成数" },
      { key: "showWeekCard", name: "本周卡片", desc: "本周周记入口" },
      { key: "showRecentCard", name: "最近日记", desc: "最近日记列表" },
      { key: "showInboxCard", name: "收件箱速记", desc: "收件箱最新速记" },
    ];
    for (const t of toggles) {
      new Setting(containerEl)
        .setName(t.name)
        .setDesc(t.desc)
        .addToggle((tg) =>
          tg.setValue(Boolean(this.plugin.settings[t.key])).onChange(async (v) => {
            (this.plugin.settings[t.key] as boolean) = v;
            await this.save();
          })
        );
    }

    new Setting(containerEl)
      .setName("最近日记条数")
      .addSlider((sl) =>
        sl
          .setLimits(1, 50, 1)
          .setValue(this.plugin.settings.recentCount)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.recentCount = v;
            await this.save();
          })
      );

    new Setting(containerEl)
      .setName("收件箱速记条数")
      .addSlider((sl) =>
        sl
          .setLimits(1, 50, 1)
          .setValue(this.plugin.settings.inboxCount)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.inboxCount = v;
            await this.save();
          })
      );
  }

  // ===== 创建命令 =====
  private renderCommandsSection(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("创建命令")
      .setHeading()
      .setDesc("命令名称修改后立即生效；Templater 文件夹映射仅在运行「一键搭建」时同步");

    const modeLabels: Record<FilenameMode, string> = {
      date: "自动日期 YYYY-MM-DD",
      week: "ISO 周编号",
      "meeting-date": "会议 + 日期",
      prompt: "Templater 弹窗",
    };

    for (const cmd of this.plugin.settings.commands) {
      const s = new Setting(containerEl).setDesc(`命令 id：${cmd.id}`);
      s.addText((t) =>
        t
          .setPlaceholder("命令名称")
          .setValue(cmd.name)
          .onChange(async (v) => {
            cmd.name = v.trim() || cmd.name;
            await this.save();
            this.plugin.syncCreateCommands();
          })
      );
      s.addText((t) =>
        t
          .setPlaceholder("模板路径")
          .setValue(cmd.template)
          .onChange(async (v) => {
            cmd.template = v.trim();
            await this.save();
          })
      );
      s.addText((t) =>
        t
          .setPlaceholder("目标文件夹")
          .setValue(cmd.folder)
          .onChange(async (v) => {
            cmd.folder = v.trim();
            await this.save();
          })
      );
      s.addDropdown((dd) => {
        for (const [mode, label] of Object.entries(modeLabels)) {
          dd.addOption(mode, label);
        }
        dd.setValue(cmd.filenameMode);
        dd.onChange(async (v) => {
          cmd.filenameMode = v as FilenameMode;
          await this.save();
        });
      });
    }
  }

  // ===== 模板库 =====
  private renderTemplateSection(containerEl: HTMLElement) {
    new Setting(containerEl).setName("模板库").setHeading();

    new Setting(containerEl)
      .setName("首次启用自动搭建")
      .setDesc("插件首次加载时自动创建目录结构并安装模板（幂等，不覆盖已有文件）")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoSetup).onChange(async (v) => {
          this.plugin.settings.autoSetup = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("强制覆写外部配置")
      .setDesc("一键搭建时强制覆写 Templater / 日记 / 模板插件配置；默认仅填空缺项（保留你已有的设置）")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.forceOverwrite).onChange(async (v) => {
          this.plugin.settings.forceOverwrite = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("一键搭建/恢复模板库")
      .setDesc("创建目录结构、安装缺失模板、同步 Templater 与核心插件配置")
      .addButton((b) =>
        b
          .setButtonText("立即运行")
          .setCta()
          .onClick(async () => {
            await this.plugin.setup();
          })
      );
  }
}
