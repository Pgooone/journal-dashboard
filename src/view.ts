import { ItemView, Notice, WorkspaceLeaf, TFile } from "obsidian";
import type JournalDashboardPlugin from "./main";
import { escapeRe, replaceColumnTag } from "./settings";
import { parseTasks } from "./parse";

// 注意：不能与旧插件 my-template-library 的 viewType 相同，
// Obsidian 对重复注册直接抛错导致插件加载失败
export const DASHBOARD_VIEW_TYPE = "journal-dashboard-panel";

/** 简易日期格式化 */
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

/** 看板列（从设置派生；数组顺序 = 显示顺序 = 匹配优先级） */
interface BoardColumn {
  key: string;
  label: string;
  tag: string; // 写回源文件时使用的标签
  match: string[]; // 识别用的标签（含 #）
  color: string;
}

interface BoardTask {
  file: TFile;
  line: number; // 源文件中任务行的行号（0-based）
  text: string; // 任务行完整文本（含标签）
  tags: string[]; // 从行文本解析出的标签（含 #）
  done: boolean;
  section: string; // 所在区块标题（无标签任务的区块归属用）
  progress: [number, number]; // 子任务进度 [已完成, 总数]（无子任务 [0,0]）
}

/** 来源日期友好显示：今天/昨天/前天/MM-DD */
function formatSourceDate(basename: string): string {
  const m = basename.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return basename;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff === 2) return "前天";
  return `${m[2]}-${m[3]}`;
}

interface DailyMeta {
  file: TFile;
  date: string;
  weekday?: string;
  mood?: string;
  week?: string;
  taskCount: number;
}

export class DashboardView extends ItemView {
  /** 已完成列展开/收起状态（会话级） */
  private showDone = false;
  private plugin: JournalDashboardPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: JournalDashboardPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.showDone = !plugin.settings.doneCollapsed;
  }

  getViewType(): string {
    return DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "日记面板";
  }

  getIcon(): string {
    return "calendar-days";
  }

  async onOpen() {
    this.render();
    // 文件变化时自动刷新
    this.registerEvent(this.app.vault.on("create", () => void this.render()));
    this.registerEvent(this.app.vault.on("delete", () => void this.render()));
    this.registerEvent(this.app.vault.on("modify", () => void this.render()));
  }

  /** 从设置派生列定义（用户增删列后自动生效） */
  private get cols(): BoardColumn[] {
    return this.plugin.settings.columns.map((c) => ({
      key: c.key,
      label: c.label,
      tag: c.tags[0] ?? "#" + c.key,
      match: c.tags,
      color: c.color,
    }));
  }

  /** 无标签任务默认列 key（失效时回退第一列） */
  private get defaultColKey(): string {
    const key = this.plugin.settings.defaultColumnKey;
    return this.cols.some((c) => c.key === key) ? key : (this.cols[0]?.key ?? "");
  }

  /**
   * 标签剥离正则：每次调用新建（规避全局正则 lastIndex 状态污染）；
   * 负向断言 `(?![\p{L}\p{N}_/-])` 确保只匹配完整标签 token，
   * 防止 #本周 误剥 #本周五 的前缀。
   */
  private stripRe(): RegExp {
    const tags = this.cols
      .flatMap((c) => c.match)
      .map((t) => escapeRe(t.slice(1)))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    return new RegExp(
      `[ \\t]*#(?:${tags.join("|")})(?![\\p{L}\\p{N}_/\\-])`,
      "gu"
    );
  }

  /** 收集日记元数据（frontmatter + 任务数） */
  private collectDailies(): DailyMeta[] {
    const dailies: DailyMeta[] = [];
    const folder = this.plugin.settings.dailyFolder;
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/"));
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter as Record<string, unknown> | undefined;
      dailies.push({
        file,
        date: (fm?.date as string) || file.basename,
        weekday: (fm?.weekday as string) || undefined,
        mood: (fm?.mood as string) || undefined,
        week: (fm?.week as string) || undefined,
        taskCount: (cache?.listItems ?? []).filter((t) => t.task === " ").length,
      });
    }
    return dailies.sort((a, b) => b.date.localeCompare(a.date));
  }

  private el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls: string,
    text?: string
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  async render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("journal-dashboard");

    await this.renderBoard(root);

    const today = formatDate(new Date(), "YYYY-MM-DD");
    const thisWeek = this.weekOf(new Date());
    const dailies = this.collectDailies();
    const todayMeta = dailies.find((d) => d.date === today);

    // ===== 今日卡片 =====
    if (this.plugin.settings.showTodayCard) {
      const todayCard = this.el("div", "jd-card jd-today");
      const todayTitle = this.el("div", "jd-card-title", `📔 ${today}`);
      todayCard.appendChild(todayTitle);
      if (todayMeta) {
        const moodRow = this.el("div", "jd-mood", todayMeta.mood ? `心情 ${todayMeta.mood}` : "心情：未记录");
        todayCard.appendChild(moodRow);
        const taskInfo = this.el(
          "div",
          "jd-tasks",
          `未完成任务 ${todayMeta.taskCount} 项`
        );
        todayCard.appendChild(taskInfo);
        const openBtn = this.el("button", "jd-btn", "打开今日日记");
        openBtn.addEventListener("click", () => this.openFile(todayMeta!.file));
        todayCard.appendChild(openBtn);
      } else {
        todayCard.appendChild(this.el("div", "jd-empty", "今天还没有写日记"));
        const createBtn = this.el("button", "jd-btn jd-btn-primary", "✏️ 新建今日日记");
        createBtn.addEventListener("click", () => this.createDaily());
        todayCard.appendChild(createBtn);
      }
      root.appendChild(todayCard);
    }

    // ===== 本周入口 =====
    if (this.plugin.settings.showWeekCard) {
      const weekCard = this.el("div", "jd-card");
      weekCard.appendChild(this.el("div", "jd-card-title", `📅 本周 ${thisWeek}`));
      const weekFiles = dailies.filter((d) => d.week === thisWeek);
      const weekBtn = this.el("button", "jd-btn", "打开本周周记");
      weekBtn.addEventListener("click", () => this.openWeekly(thisWeek));
      weekCard.appendChild(weekBtn);
      if (weekFiles.length > 0) {
        const weekSummary = this.el(
          "div",
          "jd-tasks",
          `本周已写 ${weekFiles.length} 篇日记`
        );
        weekCard.appendChild(weekSummary);
      }
      root.appendChild(weekCard);
    }

    // ===== 最近日记 =====
    if (this.plugin.settings.showRecentCard) {
      const recentCard = this.el("div", "jd-card");
      recentCard.appendChild(this.el("div", "jd-card-title", "🕘 最近日记"));
      if (dailies.length === 0) {
        recentCard.appendChild(this.el("div", "jd-empty", "还没有日记"));
      } else {
        const list = this.el("div", "jd-list");
        for (const d of dailies.slice(0, this.plugin.settings.recentCount)) {
          const item = this.el("div", "jd-item");
          const left = this.el(
            "span",
            "jd-item-date",
            `${d.date} ${d.weekday ?? ""}`
          );
          const right = this.el(
            "span",
            "jd-item-meta",
            `${d.mood ?? ""} ${d.taskCount > 0 ? `${d.taskCount} 待办` : ""}`
          );
          item.appendChild(left);
          item.appendChild(right);
          item.addEventListener("click", () => this.openFile(d.file));
          list.appendChild(item);
        }
        recentCard.appendChild(list);
      }
      root.appendChild(recentCard);
    }

    // ===== 收件箱速记 =====
    if (this.plugin.settings.showInboxCard) {
      const inboxCard = this.el("div", "jd-card");
      inboxCard.appendChild(this.el("div", "jd-card-title", "📥 收件箱速记"));
      const inboxFiles = this.app.vault
        .getMarkdownFiles()
        .filter((f) => f.path.startsWith(this.plugin.settings.inboxFolder + "/"))
        .sort((a, b) => b.stat.ctime - a.stat.ctime)
        .slice(0, this.plugin.settings.inboxCount);
      if (inboxFiles.length === 0) {
        inboxCard.appendChild(this.el("div", "jd-empty", "收件箱是空的"));
      } else {
        const list = this.el("div", "jd-list");
        for (const f of inboxFiles) {
          const item = this.el("div", "jd-item jd-item-inbox", f.basename);
          item.addEventListener("click", () => this.openFile(f));
          list.appendChild(item);
        }
        inboxCard.appendChild(list);
      }
      root.appendChild(inboxCard);
    }
  }

  // ================= 看板区块 =================

  /** 收集看板任务：日记文件夹下所有日记的根任务（直接解析文件，不依赖 metadataCache） */
  private async collectBoardTasks(): Promise<BoardTask[]> {
    const tasks: BoardTask[] = [];
    const folder = this.plugin.settings.dailyFolder;
    const boardFile = this.plugin.settings.boardFile;
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/") && f.path !== boardFile);
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const all = parseTasks(content);
      const lineDone = new Map<number, boolean>();
      for (const t of all) lineDone.set(t.line, t.done);
      for (const t of all) {
        if (!t.root || t.empty) continue; // 空任务（模板预置填写位）不显示
        const total = t.childLines.length;
        const done = t.childLines.filter((l) => lineDone.get(l)).length;
        tasks.push({
          file,
          line: t.line,
          text: t.text,
          tags: t.tags,
          done: t.done,
          section: t.section,
          progress: [done, total],
        });
      }
    }
    return tasks;
  }

  /**
   * 任务归列：标签优先；无标签时按所在区块标题归属
   * （标题包含列名 → 该列，如「## ⏭ 明天」→ 明天列）；否则默认列。
   * 已完成也计算归属列（用于列完成度统计）。
   */
  private classifyTask(t: BoardTask): { column: BoardColumn; done: boolean } {
    const all = t.tags.map((x) => x.toLowerCase());
    for (const col of this.cols) {
      if (col.match.some((m) => all.includes(m.toLowerCase()))) {
        return { column: col, done: t.done };
      }
    }
    const def = this.cols.find((c) => c.key === this.defaultColKey) ?? this.cols[0];
    for (const col of this.cols) {
      if (col.key !== def.key && t.section.includes(col.label)) {
        return { column: col, done: t.done };
      }
    }
    return { column: def, done: t.done };
  }

  /** 任务来源日期数值（用于列内排序，新→旧） */
  private dateValue(t: BoardTask): number {
    const m = t.file.basename.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : 0;
  }

  private async renderBoard(root: HTMLElement) {
    if (!this.plugin.settings.showBoard) return;
    const board = this.el("div", "jd-card jd-board");

    // 标题栏 + 打开完整看板入口
    const header = this.el("div", "jd-board-header");
    header.appendChild(this.el("div", "jd-board-title", "📋 任务看板"));
    const openBtn = this.el("button", "jd-btn", "打开完整看板");
    openBtn.addEventListener("click", () => this.openFullBoard());
    header.appendChild(openBtn);
    board.appendChild(header);

    // 快速新增（内联输入 + 选择列；回车提交，Esc 取消）
    const addRow = this.el("div", "jd-board-add");
    const addInput = document.createElement("input");
    addInput.className = "jd-board-add-input";
    addInput.placeholder = "新任务（回车添加到「今天」）";
    const addSel = document.createElement("select");
    addSel.className = "jd-board-add-select";
    for (const c of this.cols) {
      const o = document.createElement("option");
      o.value = c.key;
      o.textContent = c.label;
      addSel.appendChild(o);
    }
    addSel.value = this.defaultColKey;
    const addGo = this.el("button", "jd-btn jd-board-add-btn", "＋ 添加");
    const doAdd = () => {
      const col = this.cols.find((c) => c.key === addSel.value) ?? this.cols[0];
      const text = addInput.value.trim();
      if (text && col) {
        addInput.value = "";
        void this.addTask(col, text);
      }
    };
    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doAdd();
      } else if (e.key === "Escape") {
        addInput.value = "";
        addInput.blur();
      }
    });
    addGo.addEventListener("click", doAdd);
    addRow.appendChild(addInput);
    addRow.appendChild(addSel);
    addRow.appendChild(addGo);
    board.appendChild(addRow);

    // 分桶：未完成任务按列、已完成入已完成列；每列统计总数（含已完成）用于完成度
    const tasks = await this.collectBoardTasks();
    const buckets = new Map<string, BoardTask[]>();
    const totals = new Map<string, number>();
    for (const col of this.cols) {
      buckets.set(col.key, []);
      totals.set(col.key, 0);
    }
    const doneTasks: BoardTask[] = [];
    for (const t of tasks) {
      const { column, done } = this.classifyTask(t);
      if (done) doneTasks.push(t);
      else buckets.get(column.key)!.push(t);
      totals.set(column.key, (totals.get(column.key) ?? 0) + 1);
    }
    // 列内按来源日期排序（新 → 旧，今天的任务在最上）
    for (const list of buckets.values()) list.sort((a, b) => this.dateValue(b) - this.dateValue(a));
    doneTasks.sort((a, b) => this.dateValue(b) - this.dateValue(a));

    const colsEl = this.el("div", "jd-board-cols");

    // 时间列（标题显示完成度：待办/总数）
    for (const col of this.cols) {
      const colTasks = buckets.get(col.key) ?? [];
      const total = totals.get(col.key) ?? 0;
      const colEl = this.el("div", "jd-col");
      colEl.style.setProperty("--jd-col-color", col.color);
      colEl.appendChild(
        this.el(
          "div",
          "jd-col-title",
          `${col.label} (${colTasks.length}/${total})`
        )
      );
      this.attachDrop(colEl, col);
      for (const t of colTasks) colEl.appendChild(this.renderCard(t));
      colsEl.appendChild(colEl);
    }

    // 已完成列（默认收起）
    const doneCol = this.el("div", "jd-col jd-col-done");
    const doneTitle = this.el(
      "div",
      "jd-col-title",
      `✓ 已完成 (${doneTasks.length}) ${this.showDone ? "▾" : "▸"}`
    );
    doneTitle.addEventListener("click", () => {
      this.showDone = !this.showDone;
      void this.render();
    });
    doneCol.appendChild(doneTitle);
    if (this.showDone) {
      for (const t of doneTasks) doneCol.appendChild(this.renderCard(t));
    }
    colsEl.appendChild(doneCol);

    board.appendChild(colsEl);
    root.appendChild(board);
  }

  /** 渲染单张任务卡片 */
  private renderCard(task: BoardTask): HTMLElement {
    const card = this.el("div", "jd-card-item" + (task.done ? " done" : ""));
    card.draggable = !task.done;
    card.setAttribute("data-path", task.file.path);
    card.setAttribute("data-line", String(task.line));

    // checkbox：自绘勾选框（CSS 绘制，不受 Obsidian 预览样式影响），点击勾选/取消勾选写回
    const box = document.createElement("span");
    box.className = "jd-check" + (task.done ? " checked" : "");
    box.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.toggleTask(task);
    });
    card.appendChild(box);

    // 任务文本（剥离 checkbox 标记与列标签显示，避免与勾选图标重复）
    const display = task.text
      .replace(/^\s*-\s*\[[ xX]\]\s*/, "")
      .replace(this.stripRe(), "")
      .trim();
    card.appendChild(this.el("span", "jd-card-item-text", display || "（待填写）"));

    // 子任务进度徽章 + 进度条
    const [pDone, pTotal] = task.progress;
    if (pTotal > 0) {
      card.appendChild(
        this.el("span", "jd-progress-badge", `${pDone}/${pTotal}`)
      );
      const bar = this.el("div", "jd-progress");
      const fill = this.el("div", "jd-progress-fill");
      fill.style.width = `${Math.round((pDone / pTotal) * 100)}%`;
      bar.appendChild(fill);
      card.appendChild(bar);
    }

    card.appendChild(this.el("span", "jd-card-item-meta", formatSourceDate(task.file.basename)));

    if (!task.done) {
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("text/plain", `${task.file.path}::${task.line}`);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => {
        document
          .querySelectorAll(".jd-drop-hover")
          .forEach((el) => el.removeClass("jd-drop-hover"));
      });
    }
    return card;
  }

  /** 拖拽换列：drop 时把源行标签替换/追加为目标列标签 */
  private attachDrop(colEl: HTMLElement, column: BoardColumn) {
    colEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      colEl.addClass("jd-drop-hover");
    });
    colEl.addEventListener("dragleave", () => {
      colEl.removeClass("jd-drop-hover");
    });
    colEl.addEventListener("drop", (e) => {
      e.preventDefault();
      colEl.removeClass("jd-drop-hover");
      const payload = e.dataTransfer?.getData("text/plain");
      if (!payload) return;
      const [path, lineStr] = payload.split("::");
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return;
      const line = parseInt(lineStr, 10);
      if (Number.isNaN(line)) return;
      void this.modifyTaskLine(
        { file, line, text: "", tags: [], done: false, section: "", progress: [0, 0] },
        (l) =>
          // 移除全部列标签后追加目标标签，避免多标签并存导致拖拽无效
          replaceColumnTag(l, this.plugin.settings.columns, column.tag)
      );
    });
  }

  /** 勾选/取消勾选：- [ ] ↔ - [x]，只动该行，其余内容（frontmatter/子任务缩进）原样保留 */
  private async toggleTask(task: BoardTask) {
    await this.modifyTaskLine(task, (l) =>
      l.replace(
        /(-\s*\[)([ xX])(\])/,
        (_m, a: string, b: string, c: string) => `${a}${b === " " ? "x" : " "}${c}`
      )
    );
  }

  /** 原子读改写源文件的指定行 */
  private async modifyTaskLine(
    task: BoardTask,
    updater: (lineText: string) => string
  ) {
    await this.app.vault.process(task.file, (data) => {
      const lines = data.split("\n");
      if (task.line >= 0 && task.line < lines.length) {
        lines[task.line] = updater(lines[task.line]);
      }
      return lines.join("\n");
    });
  }

  /** 新增任务：写入今日日记对应区块末尾（内容来自看板内联输入框） */
  private async addTask(column: BoardColumn, text: string) {
    if (!text || !text.trim()) return;
    const today = formatDate(new Date(), "YYYY-MM-DD");
    const target = this.app.vault.getAbstractFileByPath(
      `${this.plugin.settings.dailyFolder}/${today}.md`
    );
    if (!(target instanceof TFile)) {
      new Notice(`今日日记 ${today}.md 不存在，请先新建日记`);
      return;
    }
    const section = this.plugin.settings.todaySection;
    await this.app.vault.process(target, (data) => {
      const lines = data.split("\n");
      // 优先插入到包含目标列标签的区块（如 ## ⏭ 明天）；找不到则用今日事区块
      const tagName = column.match[0]?.replace(/^#/, "") ?? "";
      let titleIdx = lines.findIndex((l) => l.trim().startsWith(section));
      if (tagName) {
        const taggedIdx = lines.findIndex(
          (l) => /^##\s+/.test(l) && l.includes(tagName)
        );
        if (taggedIdx !== -1) titleIdx = taggedIdx;
      }
      if (titleIdx === -1) {
        if (lines[lines.length - 1]?.trim() !== "") lines.push("");
        lines.push("", section, `- [ ] ${text.trim()} ${column.tag}`);
        return lines.join("\n");
      }
      // 在区块内最后一个非空、非注释行之后插入
      let insertAt = titleIdx;
      for (let i = titleIdx + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i])) break;
        const t = lines[i].trim();
        if (t !== "" && !t.startsWith("%%")) insertAt = i;
      }
      lines.splice(insertAt + 1, 0, `- [ ] ${text.trim()} ${column.tag}`);
      return lines.join("\n");
    });
  }

  /** 打开 task-list-kanban 完整看板（独立视图，TextFileView 渲染） */
  private openFullBoard() {
    const f = this.app.vault.getAbstractFileByPath(this.plugin.settings.boardFile);
    if (f instanceof TFile) this.openFile(f);
    else new Notice(`看板文件不存在：${this.plugin.settings.boardFile}`);
  }

  private openFile(file: TFile) {
    this.app.workspace.getLeaf(false).openFile(file);
  }

  /** 打开/创建本周周记（周记文件名为 gggg-[W]ww） */
  private openWeekly(week: string) {
    const target = `${this.plugin.settings.weeklyFolder}/${week}.md`;
    const file = this.app.vault.getAbstractFileByPath(target);
    if (file instanceof TFile) {
      this.openFile(file);
    } else {
      new Notice(`周记 ${week} 不存在，请用「新建周记」命令创建`);
    }
  }

  private createDaily() {
    this.plugin.executeCreateCommand("create-daily");
  }

  private weekOf(d: Date): string {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(
      ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
    );
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  }
}
