import { extractTags } from "./settings";

/**
 * 任务解析：直接解析 markdown 文本（不依赖 metadataCache，保证实时最新）。
 * 同时记录任务所在区块标题（## 开头），用于无标签任务的区块归属。
 */

export interface ParsedTask {
  line: number; // 0-based 行号（写回定位）
  text: string; // 完整行文本
  tags: string[]; // 行内标签（含 #）
  done: boolean;
  section: string; // 所在区块标题（## 开头行，无则为 ""）
  root: boolean; // 无缩进的根任务
  empty: boolean; // 无内容的任务行（- [ ] 后为空，模板预置填写位）
  parent: number; // 父任务索引（0-based，根任务为 -1）
  childLines: number[]; // 子任务行号（仅根任务有值）
}

/** 解析 markdown 文本中的所有任务行（含父子层级与子任务行号） */
export function parseTasks(content: string): ParsedTask[] {
  const lines = content.split("\n");
  const out: ParsedTask[] = [];
  let section = "";
  const stack: { indent: number; index: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+/.test(line.trim())) {
      section = line.trim();
      continue;
    }
    const m = line.match(/^(\s*)-\s*\[([ xX])\]\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].index : -1;
    out.push({
      line: i,
      text: line,
      tags: extractTags(line),
      done: /^[xX]$/.test(m[2]),
      section,
      root: indent === 0,
      empty: m[3].trim() === "",
      parent,
      childLines: [],
    });
    stack.push({ indent, index: out.length - 1 });
  }
  // 收集根任务的子任务行号
  for (const t of out) {
    if (t.parent >= 0 && out[t.parent]) out[t.parent].childLines.push(t.line);
  }
  return out;
}
