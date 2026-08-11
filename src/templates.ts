// 内嵌模板内容 —— 发布版的唯一模板来源
// 插件在 90 Templates 中缺少对应文件时，会把这些内容安装过去（不覆盖已有文件）

export const TEMPLATES: Record<string, string> = {
  "TPL-日记.md": `<%*
// 用选择器而不是手打，保证 mood 取值统一，Dataview / Bases 才能聚合
const mood = await tp.system.suggester(
  ["😄 很好", "🙂 还行", "😐 一般", "😪 疲惫", "😣 糟糕"],
  ["😄", "🙂", "😐", "😪", "😣"],
  false,
  "今天心情如何？"
);
const day  = tp.date.now("YYYY-MM-DD", 0, tp.file.title, "YYYY-MM-DD");
const prev = tp.date.now("YYYY-MM-DD", -1, tp.file.title, "YYYY-MM-DD");
const next = tp.date.now("YYYY-MM-DD", 1, tp.file.title, "YYYY-MM-DD");
-%>
---
date: <% day %>
weekday: <% tp.date.now("dddd", 0, tp.file.title, "YYYY-MM-DD") %>
week: <% tp.date.now("gggg-[W]ww", 0, tp.file.title, "YYYY-MM-DD") %>
type: daily
mood: <% mood %>
tags:
  - daily
---

<< [[<% prev %>]] | [[<% next %>]] >>

## 🎯 今日事
%% 看板标签：今天→#今天 明天→#明天 本周→#本周 以后→#以后；无标签任务默认归「今天」%%
- [ ] <% tp.file.cursor(1) %> #今天
- [ ] #今天
- [ ] #今天

## 📥 随手记
-

## 🌙 晚间复盘
- 今天做成了什么：
- 卡在哪里：
- 明天第一件事：`,

  "TPL-周记.md": `---
type: weekly
week: <% tp.date.now("gggg-[W]ww", 0, tp.file.title, "gggg-[W]ww") %>
range: <% tp.date.weekday("MM-DD", 0, tp.file.title, "gggg-[W]ww") %> ~ <% tp.date.weekday("MM-DD", 6, tp.file.title, "gggg-[W]ww") %>
tags:
  - weekly
---

<< [[<% tp.date.now("gggg-[W]ww", -7, tp.file.title, "gggg-[W]ww") %>]] | [[<% tp.date.now("gggg-[W]ww", 7, tp.file.title, "gggg-[W]ww") %>]] >>

## 📅 本周日记
<%*
for (let i = 0; i < 7; i++) {
  const d = tp.date.weekday("YYYY-MM-DD", i, tp.file.title, "gggg-[W]ww");
  tR += \`![[\${d}]]\n\`;
}
-%>

## ✅ 本周完成

## 🚧 未完成 / 顺延

## 💡 收获与反思

## 🎯 下周三件事
- [ ] `,

  "TPL-会议.md": `<%*
const subject = await tp.system.prompt("会议主题", "未命名会议");
const stamp = tp.date.now("YYYY-MM-DD");
await tp.file.rename(\`\${stamp} \${subject}\`);
-%>
---
type: meeting
date: <% tp.date.now("YYYY-MM-DD HH:mm") %>
attendees:
project:
tags:
  - meeting
---

# <% subject %>

## 议程
-

## 记录
- <% tp.file.cursor(1) %>

## 决议
-

## 行动项
- [ ] 谁 / 什么时候前 / 做什么`,

  "TPL-项目.md": `---
type: project
status: <% await tp.system.suggester(["未开始","进行中","暂停","已完成"],["10-todo","50-doing","70-hold","90-done"], false, "项目状态") %>
start: <% tp.date.now("YYYY-MM-DD") %>
due:
tags:
  - project
---

# <% tp.file.title %>

## 目标与验收标准
-

## 里程碑
- [ ]

## 日志
- <% tp.date.now("YYYY-MM-DD") %> 创建

## 相关笔记
- `,

  "TPL-读书.md": `---
type: book
author: <% await tp.system.prompt("作者") %>
status: 在读
rating: <% await tp.system.suggester((i) => i, ["", "★★★★★", "★★★★☆", "★★★☆☆", "★★☆☆☆", "★☆☆☆☆"], false, "评分") %>
started: <% tp.date.now("YYYY-MM-DD") %>
tags:
  - book
---

# <% tp.file.title %>

## 一句话总结

## 摘录

## 我的评论`,

  "TPL-速记.md": `---
created: <% tp.date.now("YYYY-MM-DD HH:mm") %>
type: fleeting
tags:
  - inbox
---

<% tp.file.cursor() %>

来源：[[<% tp.date.now("YYYY-MM-DD") %>]]`,
};
