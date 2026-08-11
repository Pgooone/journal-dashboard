<%*
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
- [ ] <% tp.file.cursor(1) %> #今天
- [ ] #今天
- [ ] #今天

## 📥 随手记
- 

## 🌙 晚间复盘
- 今天做成了什么：
- 卡在哪里：
- 明天第一件事：