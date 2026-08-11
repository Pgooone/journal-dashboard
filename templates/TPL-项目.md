---
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
- 
