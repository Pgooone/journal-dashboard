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
}

/** 解析文件的根任务（直接读文件，保证实时最新；嵌套子任务与空任务不显示） */
async function collectTasks(app: App, file: TFile): Promise<DailyTask[]> {
  const content = await app.vault.read(file);
  return parseTasks(content)
    .filter((t) => t.root && !t.empty)
    .map((t) => ({
      file,
      line: t.line,
      text: t.text,
      tags: t.tags,
      done: t.done,
      section: t.section,
    }));
}

/** 剥离任务行中的 checkbox 标记与列标签，得到显示文本 */
function displayText(text: string, plugin: JournalDashboardPlugin): string {
  let t = text.replace(/^\s*-\s*\[[ xX]\]\s*/, "");
  for (const col of plugin.settings.columns) {
    for (const tag of col.tags) {
      t = t.split(` ${tag}`).join("").split(`\t${tag}`).join("");
    }
  }
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
      const tag = col.tags[0] ?? "#" + col.key;
      return rewriteLine(app, file, line, (l) =>
        replaceColumnTag(l, plugin.settings.columns, tag)
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

  // 勾选/取消勾选（原生勾选框，显示可靠）
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "jd-db-check";
  box.checked = t.done;
  box.addEventListener("click", (e) => {
    e.stopPropagation();
    void toggleTask(app, plugin, t, rootEl, sourcePath);
  });
  item.appendChild(box);
  item.appendChild(document.createTextNode(displayText(t.text, plugin)));
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
