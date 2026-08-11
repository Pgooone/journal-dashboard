import { App, TFile } from "obsidian";
import type JournalDashboardPlugin from "./main";
import { extractTags } from "./settings";

/**
 * 日记内嵌看板：通过 markdown 代码块（```journal-board）在日记阅读视图中
 * 渲染当前文件的任务看板（按列分组、可勾选写回）。
 */

interface DailyTask {
  file: TFile;
  line: number;
  text: string;
  tags: string[];
  done: boolean;
}

/** 解析文件的根任务（嵌套子任务不单独成行） */
async function collectTasks(app: App, file: TFile): Promise<DailyTask[]> {
  const cache = app.metadataCache.getFileCache(file);
  const items = (cache?.listItems ?? []).filter(
    (i) => typeof i.task === "string" && (i.parent ?? -1) === -1
  );
  if (items.length === 0) return [];
  const lines = (await app.vault.cachedRead(file)).split("\n");
  const tasks: DailyTask[] = [];
  for (const item of items) {
    const text = lines[item.position.start.line] ?? "";
    tasks.push({
      file,
      line: item.position.start.line,
      text,
      tags: extractTags(text),
      done: /^[xX]$/.test(item.task ?? ""),
    });
  }
  return tasks;
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

/** 渲染日记内嵌看板（当前文件的任务按列显示，可勾选写回） */
export async function renderDailyBoard(
  app: App,
  plugin: JournalDashboardPlugin,
  el: HTMLElement,
  sourcePath: string
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(sourcePath);
  if (!(file instanceof TFile)) return;
  const tasks = await collectTasks(app, file);

  // 分列（标签匹配；无标签 → 默认列；已完成独立）
  const cols = plugin.settings.columns.map((c) => ({
    ...c,
    pending: [] as DailyTask[],
  }));
  const done: DailyTask[] = [];
  const defKey = plugin.settings.defaultColumnKey;
  for (const t of tasks) {
    if (t.done) {
      done.push(t);
      continue;
    }
    const all = t.tags.map((x) => x.toLowerCase());
    const hit = cols.find((c) => c.tags.some((m) => all.includes(m.toLowerCase())));
    const target = hit ?? cols.find((c) => c.key === defKey) ?? cols[0];
    if (target) target.pending.push(t);
  }

  // 渲染（紧凑列式布局）
  el.empty();
  el.addClass("jd-daily-board");
  const row = el.createDiv({ cls: "jd-db-cols" });
  for (const col of cols) {
    const colEl = row.createDiv({ cls: "jd-db-col" });
    colEl.style.setProperty("--jd-col-color", col.color);
    colEl.createDiv({
      cls: "jd-db-col-title",
      text: `${col.label} (${col.pending.length})`,
    });
    if (col.pending.length === 0) {
      colEl.createDiv({ cls: "jd-db-empty", text: "无" });
    } else {
      for (const t of col.pending) {
        colEl.appendChild(renderItem(app, plugin, t, el, sourcePath));
      }
    }
  }
  const doneEl = row.createDiv({ cls: "jd-db-col jd-db-done" });
  doneEl.createDiv({ cls: "jd-db-col-title", text: `✓ 已完成 (${done.length})` });
  if (done.length === 0) {
    doneEl.createDiv({ cls: "jd-db-empty", text: "无" });
  } else {
    for (const t of done) doneEl.appendChild(renderItem(app, plugin, t, el, sourcePath));
  }
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
  const box = document.createElement("span");
  box.className = "jd-db-check";
  box.textContent = t.done ? "☑" : "☐";
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
  await app.vault.process(t.file, (data) => {
    const lines = data.split("\n");
    if (t.line >= 0 && t.line < lines.length) {
      lines[t.line] = lines[t.line].replace(
        /(-\s*\[)([ xX])(\])/,
        (_m, a: string, b: string, c: string) => `${a}${b === " " ? "x" : " "}${c}`
      );
    }
    return lines.join("\n");
  });
  await renderDailyBoard(app, plugin, rootEl, sourcePath);
}
