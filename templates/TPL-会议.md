<%*
const subject = await tp.system.prompt("会议主题", "未命名会议");
const stamp = tp.date.now("YYYY-MM-DD");
await tp.file.rename(`${stamp} ${subject}`);
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
- [ ] 谁 / 什么时候前 / 做什么
