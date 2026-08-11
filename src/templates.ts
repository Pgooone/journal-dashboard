// 内嵌模板内容 —— 发布版的唯一模板来源
// 模板使用简单占位符语法，由插件自主渲染（不依赖 Templater）：
//   {{date}} {{time}} {{weekday}} {{week}} {{week_range}} {{title}}
//   {{prev}} {{next}} {{prev_week}} {{next_week}} {{week_days}}
//   {{mood}} {{subject}} {{author}} {{status}} {{rating}}（交互占位符，渲染时弹窗）
//   {{cursor}}（光标定位标记）
// 插件在模板目录缺少对应文件时，会把这些内容安装过去（不覆盖已有文件）

export const TEMPLATES: Record<string, string> = {
  "TPL-日记.md": `---
date: {{date}}
weekday: {{weekday}}
week: {{week}}
type: daily
mood: {{mood}}
tags:
  - daily
---

<< [[{{prev}}]] | [[{{next}}]] >>

## 🎯 今日事
{{cursor}}

## ⏭ 明天

## 🗓 本周

## 🗂 以后

## 📥 随手记
-

## 🌙 晚间复盘
- 今天做成了什么：
- 卡在哪里：
- 明天第一件事：

\`\`\`journal-board

\`\`\``,

  "TPL-周记.md": `---
type: weekly
week: {{week}}
range: {{week_range}}
tags:
  - weekly
---

<< [[{{prev_week}}]] | [[{{next_week}}]] >>

## 📅 本周日记
{{week_days}}

## ✅ 本周完成

## 🚧 未完成 / 顺延

## 💡 收获与反思

## 🎯 下周三件事
- [ ] `,

  "TPL-会议.md": `---
type: meeting
date: {{date}} {{time}}
attendees:
project:
tags:
  - meeting
---

# {{subject}}

## 议程
-

## 记录
- {{cursor}}

## 决议
-

## 行动项
- [ ] 谁 / 什么时候前 / 做什么`,

  "TPL-项目.md": `---
type: project
status: {{status}}
start: {{date}}
due:
tags:
  - project
---

# {{title}}

## 目标与验收标准
-

## 里程碑
- [ ]

## 日志
- {{date}} 创建

## 相关笔记
- `,

  "TPL-读书.md": `---
type: book
author: {{author}}
status: 在读
rating: {{rating}}
started: {{date}}
tags:
  - book
---

# {{title}}

## 一句话总结

## 摘录

## 我的评论`,

  "TPL-速记.md": `---
created: {{date}} {{time}}
type: fleeting
tags:
  - inbox
---

{{cursor}}

来源：[[{{date}}]]`,
};
