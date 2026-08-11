---
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

## 我的评论
