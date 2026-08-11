---
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
  tR += `![[${d}]]\n`;
}
-%>

## ✅ 本周完成

## 🚧 未完成 / 顺延

## 💡 收获与反思

## 🎯 下周三件事
- [ ] 