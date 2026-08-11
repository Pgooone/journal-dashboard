import { App, TFile } from "obsidian";
import type JournalDashboardPlugin from "./main";
import { replaceColumnTag } from "./settings";
import { parseTasks } from "./parse";

/**
 * 日记内嵌看板：通过 markdown 代码块（```journal-board）在日记阅读视图中
 * 渲染当前文件的任务看板。
 * - 任务按列分组（今天/明天/本周/以后 + 已完成），无标签默认归默认列
 * - 点击 ☐ 勾选/取消勾选，写回日记文件
 * - 拖拽卡片到时间列 → 自动改写标签；拖到已完成列 → 自动勾选完成
 * - 列标题显示完成度（待办/总数），与面板总看板规则一致
 */

interface DailyTask {
  file: TFile;
  line: number;
  text: string;
  tags: string[];
  done: boolean;
  section: string;
  /** 子任务进度：已完成 / 总数（无子任务为 0/0） */
  progress: [number, number];
  /** 子任务明细（行号/文本/done）——内嵌看板可展开子任务列表用 */
  childItems: { line: number; text: string; done: boolean }[];
}

/** 解析文件的根任务（含子任务进度与明细；嵌套子任务与空任务不单独显示） */
async function collectTasks(app: App, file: TFile): Promise<DailyTask[]> {
  const content = await app.vault.read(file);
  const all = parseTasks(content);
  const byLine = new Map(all.map((t) => [t.line, t]));
  return all
    .filter((t) => t.root && !t.empty)
    .map((t) => {
      const total = t.childLines.length;
      const done = t.childLines.filter((l) => byLine.get(l)?.done).length;
      const childItems = t.childLines.map((l) => {
        const c = byLine.get(l);
        return { line: l, text: c?.text ?? "", done: c?.done ?? false };
      });
      return {
        file,
        line: t.line,
        text: t.text,
        tags: t.tags,
        done: t.done,
        section: t.section,
        progress: [done, total] as [number, number],
        childItems,
      };
    });
}

/** 剥离任务行中的 checkbox 标记与列标签，得到显示文本 */
function displayText(text: string, plugin: JournalDashboardPlugin): string {
  let t = text.replace(/^\s*-\s*\[[ xX]\]\s*/, "");
  for (const col of plugin.settings.columns) {
    for (const tag of col.tags) {
      t = t.split(` ${tag}`).join("").split(`\t${tag}`).join("");
    }
  }
  // 来源双链弱化显示：⏪ [[2026-08-11 星期二]] → ⏪ 08-11
  t = t.replace(/⏪\s*\[\[([^\]]+)\]\]/g, (_m, name: string) => {
    const d = name.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    return `⏪ ${d ?? name}`;
  });
  return t.trim() || "（待填写）";
}

/** 渲染日记内嵌看板（当前文件的任务按列显示） */
export async function renderDailyBoard(
  app: App,
  plugin: JournalDashboardPlugin,
  el: HTMLElement,
  sourcePath: string
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(sourcePath);
  if (!(file instanceof TFile)) return;
  const tasks = await collectTasks(app, file);

  // 分列：标签优先；无标签按所在区块标题归属（如「## ⏭ 明天」→ 明天列）；否则默认列
  const cols = plugin.settings.columns.map((c) => ({
    ...c,
    pending: [] as DailyTask[],
    total: 0,
  }));
  const done: DailyTask[] = [];
  const defKey = plugin.settings.defaultColumnKey;
  const defCol = cols.find((c) => c.key === defKey) ?? cols[0];
  for (const t of tasks) {
    const all = t.tags.map((x) => x.toLowerCase());
    let target = cols.find((c) => c.tags.some((m) => all.includes(m.toLowerCase())));
    if (!target) {
      target =
        cols.find((c) => c.key !== defKey && t.section.includes(c.label)) ??
        defCol;
    }
    if (!target) continue;
    target.total++;
    if (t.done) done.push(t);
    else target.pending.push(t);
  }

  // 渲染
  el.empty();
  el.addClass("jd-daily-board");
  const row = el.createDiv({ cls: "jd-db-cols" });

  // 时间列：支持拖入换列（改写标签）
  for (const col of cols) {
    const colEl = row.createDiv({ cls: "jd-db-col" });
    colEl.style.setProperty("--jd-col-color", col.color);
    colEl.createDiv({
      cls: "jd-db-col-title",
      text: `${col.label} (${col.pending.length}/${col.total})`,
    });
    attachDrop(app, plugin, colEl, el, sourcePath, (file, line) => {
      // 物理移动：把任务行（含缩进子任务）剪切到目标区块（如 ## ⏭ 明天）
      const tagName = col.tags[0]?.replace(/^#/, "") ?? col.label;
      return moveTaskToSection(
        app,
        plugin,
        file,
        line,
        tagName,
        col.key === plugin.settings.defaultColumnKey
      );
    });
    if (col.pending.length === 0) {
      colEl.createDiv({ cls: "jd-db-empty", text: "无" });
    } else {
      for (const t of col.pending) colEl.appendChild(renderItem(app, plugin, t, el, sourcePath));
    }
  }

  // 已完成列：支持拖入自动勾选
  const doneEl = row.createDiv({ cls: "jd-db-col jd-db-done" });
  doneEl.createDiv({ cls: "jd-db-col-title", text: `✓ 已完成 (${done.length})` });
  attachDrop(app, plugin, doneEl, el, sourcePath, (file, line) =>
    rewriteLine(app, file, line, (l) =>
      l.replace(/-\s*\[([ xX])\]/, (_m, b: string) => (b === " " ? "- [x]" : "- [ ]"))
    )
  );
  if (done.length === 0) {
    doneEl.createDiv({ cls: "jd-db-empty", text: "无" });
  } else {
    for (const t of done) doneEl.appendChild(renderItem(app, plugin, t, el, sourcePath));
  }
}

/** 列拖放处理：解析 payload 后执行写回并重渲染 */
function attachDrop(
  app: App,
  plugin: JournalDashboardPlugin,
  colEl: HTMLElement,
  rootEl: HTMLElement,
  sourcePath: string,
  apply: (file: TFile, line: number) => Promise<void>
) {
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
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const line = parseInt(lineStr, 10);
    if (Number.isNaN(line)) return;
    void apply(file, line).then(() => renderDailyBoard(app, plugin, rootEl, sourcePath));
  });
}

/** 原子读改写指定行 */
async function rewriteLine(
  app: App,
  file: TFile,
  line: number,
  updater: (lineText: string) => string
): Promise<void> {
  await app.vault.process(file, (data) => {
    const lines = data.split("\n");
    if (line >= 0 && line < lines.length) {
      lines[line] = updater(lines[line]);
    }
    return lines.join("\n");
  });
}

/**
 * 拖拽换列 = 物理移动：把任务行（含缩进子任务）剪切到目标区块
 * （如 ## ⏭ 明天）末尾，并去除列标签（区块归属接管）。
 * 今天列（默认列）匹配「## 🎯 今日事」区块；目标区块不存在时回退为标签替换。
 */
async function moveTaskToSection(
  app: App,
  plugin: JournalDashboardPlugin,
  file: TFile,
  line: number,
  tagName: string,
  isTodayCol: boolean
): Promise<void> {
  await app.vault.process(file, (data) => {
    const lines = data.split("\n");
    if (line < 0 || line >= lines.length) return data;

    // 找目标区块标题：今天列匹配「今日」标题（todaySection 前缀或含"今日"，
    // 兼容用户自定义标题如「## 🎯 今日任务」），其他列匹配标题含列名（如 ## ⏭ 明天）
    let titleIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) {
        const match =
          isTodayCol
            ? lines[i].trim().startsWith(plugin.settings.todaySection) ||
              lines[i].includes("今日")
            : lines[i].includes(tagName);
        if (match) {
          titleIdx = i;
          break;
        }
      }
    }
    if (titleIdx === -1) {
      // 无目标区块：只清除列标签，不追加任何 #xx（保持行干净；
      // 区块完整时不会走到此分支）
      lines[line] = replaceColumnTag(lines[line], plugin.settings.columns, "");
      return lines.join("\n");
    }

    // 目标插入位置：区块内最后一行（下一个 ## 标题前）
    let insertAt = titleIdx;
    for (let i = titleIdx + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) break;
      insertAt = i;
    }

    // 收集源任务块：根任务 + 其后连续缩进的子任务
    let blockEnd = line;
    for (let i = line + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s+-\s*\[/.test(l)) blockEnd = i; // 缩进子任务
      else if (/^-\s*\[/.test(l)) break; // 新的根任务
      else if (l.trim() !== "") break; // 非任务内容
    }
    const block = lines.slice(line, blockEnd + 1);
    // 根任务去除列标签（子任务行标签不动），区块归属接管
    block[0] = replaceColumnTag(block[0], plugin.settings.columns, "");
    // 追加来源双链（已有 ⏪ 链接不重复，追溯链指向最初来源）
    if (!block[0].includes("⏪")) {
      block[0] += ` ⏪ [[${file.basename}]]`;
    }

    // 删除源块；若目标位置在源块之后需偏移行号
    lines.splice(line, block.length);
    let target = insertAt;
    if (target >= line) target -= block.length;
    lines.splice(target + 1, 0, ...block);
    return lines.join("\n");
  });
}

function renderItem(
  app: App,
  plugin: JournalDashboardPlugin,
  t: DailyTask,
  rootEl: HTMLElement,
  sourcePath: string
): HTMLElement {
  const item = document.createElement("div");
  item.className = "jd-db-item" + (t.done ? " done" : "");
  item.draggable = !t.done;

  // 拖拽源：记录 文件路径::行号
  if (!t.done) {
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", `${t.file.path}::${t.line}`);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => {
      document
        .querySelectorAll(".jd-drop-hover")
        .forEach((el) => el.removeClass("jd-drop-hover"));
    });
  }

  // 第一行：勾选框 + 任务文字 + 进度徽章（有子任务时可点击展开子任务列表）
  const main = document.createElement("div");
  main.className = "jd-db-main";
  // 勾选/取消勾选（自绘勾选框，CSS 绘制不受 Obsidian 预览样式影响）
  const box = document.createElement("span");
  box.className = "jd-db-check" + (t.done ? " checked" : "");
  box.addEventListener("click", (e) => {
    e.stopPropagation();
    void toggleTask(app, plugin, t, rootEl, sourcePath);
  });
  main.appendChild(box);
  main.appendChild(document.createTextNode(displayText(t.text, plugin)));

  // 子任务进度徽章（点击展开/收起子任务列表）
  const [pDone, pTotal] = t.progress;
  let childrenEl: HTMLElement | null = null;
  if (pTotal > 0) {
    const badge = document.createElement("span");
    badge.className = "jd-db-progress-badge jd-db-progress-toggle";
    badge.textContent = `${pDone}/${pTotal} ▸`;
    main.appendChild(badge);

    // 第二行：进度条
    const bar = document.createElement("div");
    bar.className = "jd-db-progress";
    const fill = document.createElement("div");
    fill.className = "jd-db-progress-fill";
    fill.style.width = `${Math.round((pDone / pTotal) * 100)}%`;
    bar.appendChild(fill);

    // 第三行：可展开子任务列表（每个子任务可勾选，实时更新根进度）
    childrenEl = document.createElement("div");
    childrenEl.className = "jd-db-children";
    childrenEl.style.display = "none";
    for (const c of t.childItems) {
      const cRow = document.createElement("div");
      cRow.className = "jd-db-child" + (c.done ? " done" : "");
      const cBox = document.createElement("span");
      cBox.className = "jd-db-check" + (c.done ? " checked" : "");
      cBox.addEventListener("click", (e) => {
        e.stopPropagation();
        void rewriteLine(app, t.file, c.line, (l) =>
          l.replace(/(-\s*\[)([ xX])(\])/, (_m, a: string, b: string, cc: string) => `${a}${b === " " ? "x" : " "}${cc}`)
        ).then(() => renderDailyBoard(app, plugin, rootEl, sourcePath));
      });
      cRow.appendChild(cBox);
      const cText = document.createElement("span");
      cText.className = "jd-db-child-text";
      cText.textContent = c.text.replace(/^\s*-\s*\[[ xX]\]\s*/, "").trim() || "（待填写）";
      cRow.appendChild(cText);
      childrenEl.appendChild(cRow);
    }

    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = childrenEl!.style.display !== "none";
      childrenEl!.style.display = open ? "none" : "";
      badge.textContent = `${pDone}/${pTotal} ${open ? "▸" : "▾"}`;
    });

    item.appendChild(main);
    item.appendChild(bar);
    item.appendChild(childrenEl);
    return item;
  }

  item.appendChild(main);
  return item;
}

/** 勾选/取消勾选：只改该行，完成后重渲染整个看板块 */
async function toggleTask(
  app: App,
  plugin: JournalDashboardPlugin,
  t: DailyTask,
  rootEl: HTMLElement,
  sourcePath: string
) {
  await rewriteLine(app, t.file, t.line, (l) =>
    l.replace(
      /(-\s*\[)([ xX])(\])/,
      (_m, a: string, b: string, c: string) => `${a}${b === " " ? "x" : " "}${c}`
    )
  );
  await renderDailyBoard(app, plugin, rootEl, sourcePath);
}
