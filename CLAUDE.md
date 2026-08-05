# 宝可梦：重组 — 项目概况与开发规范

## 项目概述

《宝可梦：重组》是一款基于 Web 的宝可梦同人策略游戏，基于 **Svelte 5 + TypeScript + Vite** 构建。
战斗动画表现参考 [PokéRogue (pagefaultgames/pokerogue)](https://github.com/pagefaultgames/pokerogue) 的 Phaser 实现思路，以 CSS 动画 + 2D 精灵图实现等效效果。3D 模型（Three.js/Threlte）暂不引入，留待后续阶段按需加入。

**核心机制**：开局从 6 只随机重组的宝可梦中选 3 只，通过"战斗 → 交换(必选) → 改造(三选一)"的循环不断优化队伍，最终击败重组联盟冠军。

详细设计见项目文档：
- `游戏概念文档.docx` — 原始概念
- `游戏开发实现文档.md` — 完整开发实现方案

## 全局要求（必须遵守）

1. **全程中文沟通**：所有思考过程（thinking）、对话回复、代码注释、文档说明都使用中文。代码本身的标识符（变量名、函数名等）保持英文以符合编程规范。
2. **每次提交都要解释**：每次 git 提交后，向用户解释变更了什么（What）、为什么这样改（Why）、涉及的技术原理（How）。

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Svelte 5 + Vite |
| 语言 | TypeScript（严格模式）|
| 渲染 | CSS 动画 + 2D 精灵图（战斗动画）/ 后期可加入 Three.js (Threlte) |
| 状态 | Svelte Stores + runes ($state / $derived) |
| 数据 | PokeAPI + IndexedDB 缓存 |
| 测试 | Vitest |

## 目录结构

```
src/
├── main.ts                # 入口
├── App.svelte             # 根组件 + 路由（基于 GamePhase）
├── routes/                # 页面级组件
│   ├── Home.svelte        # 标题画面
│   ├── TeamSelect.svelte  # 开局选队
│   ├── Battle.svelte      # 战斗场景
│   ├── Reward.svelte      # 战后奖励(交换+改造)
│   ├── Victory.svelte     # 通关画面
│   └── GameOver.svelte    # 失败画面
├── components/            # 可复用组件（待建）
├── game/                  # 游戏逻辑（纯 TS）
│   ├── engine/            # 战斗引擎、伤害计算、属性克制
│   │   ├── TypeChart.ts   # 属性克制表 ✓
│   │   └── DamageCalc.ts  # 伤害计算 ✓
│   ├── factory/           # 重组生成器、敌方队伍生成、改造选项（待建）
│   ├── state/             # 游戏状态（待建）
│   └── data/
│       ├── types.ts       # 核心类型定义 ✓
│       └── combos/        # 预设组合库（待建）
├── api/                   # PokeAPI 客户端（待建）
├── stores/
│   ├── gameStore.ts       # 全局游戏 store ✓
│   └── battleStore.ts     # 战斗 store ✓
├── utils/
│   ├── random.ts          # 种子随机 ✓
│   └── helpers.ts         # 通用工具函数（待建）
└── styles/
    ├── variables.css      # CSS 自定义属性 ✓
    ├── global.css         # 全局样式 ✓
    └── animations.css     # 动画定义 ✓
```

## 开发阶段

1. **数据层 + 核心引擎** — PokeAPI 集成、缓存、伤害计算、重组引擎
2. **核心游戏循环** — 选队、战斗、关卡流程
3. **交换 + 改造系统** — 战后奖励流程
4. **UI 打磨 + 3D 模型** — 动画、主题、响应式
5. **额外系统** — 存档、设置、统计
