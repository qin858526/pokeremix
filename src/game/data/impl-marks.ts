/**
 * Demo 实现标记：标记哪些特性和技能已完全实现
 * 未标记的仅存在于数据库中，效果未实现
 *
 * 技能标记从 MOVE_EFFECTS 推导，但排除仅有数据定义、引擎未实现实际效果的招式
 */

import { MOVE_EFFECTS } from './move-effects'

/** 已完全实现（含战斗逻辑）的特性名称列表 */
export const IMPLEMENTED_ABILITIES = new Set([
  'overgrow',      // 茂盛：低 HP 草系 1.5 倍
  'blaze',         // 猛火：低 HP 火系 1.5 倍
  'torrent',       // 激流：低 HP 水系 1.5 倍
  'swarm',         // 虫之预感：低 HP 虫系 1.5 倍
  'static',        // 静电：接触 30% 麻痹
  'poison-point',  // 毒刺：接触 30% 中毒
  'effect-spore',  // 孢子：接触 30% 中毒/麻痹/睡眠
  'flash-fire',    // 引火：吸收火系技能，火系 1.5 倍
  'intimidate',    // 威吓：入场降对方攻击
  'guts',          // 毅力：异常状态物理 1.5 倍
  'shed-skin',     // 蜕皮：回合末 33% 治愈异常
  'cute-charm',    // 迷人之躯：接触 30% 迷惑
  'compound-eyes', // 复眼：命中率 x1.3
  'shield-dust',   // 鳞粉：不受技能附加效果影响
  'serene-grace',  // 天恩：技能附加效果概率翻倍
  'rock-head',     // 石头脑袋：不会受到反伤
  'clear-body',    // 洁净身躯：能力不会被降低
  'natural-cure',  // 自然回复：交换时治愈异常状态
  'speed-boost',   // 加速：每回合末速度提升 1 级
  'rain-dish',     // 雨盘：下雨时回复 HP
  'rough-skin',    // 粗糙皮肤：接触攻击受伤
  'levitate',      // 飘浮：地面系免疫
  'water-absorb',  // 储水：水系免疫并回复
  'volt-absorb',   // 蓄电：电系免疫并回复
  'drought',       // 日照：出场时放晴
  'thick-fat',     // 厚脂肪：火/冰伤害减半
  'marvel-scale',  // 奇异鳞片：异常状态防御提升
  'early-bird',    // 早起：睡眠回合减半
  'synchronize',   // 同步：传递异常状态
  'sturdy',        // 结实：满血抵挡一击必杀
  'own-tempo',     // 自我中心：不会混乱
  'water-veil',    // 水幕：不会烧伤
  'immunity',      // 免疫：不会中毒
  'limber',        // 柔软：不会麻痹
  'insomnia',      // 不眠：不会睡眠
  'vital-spirit',  // 干劲：不会睡眠
  'magma-armor',   // 熔岩铠甲：不会冰冻
  'hustle',        // 活力：攻击提升但命中降低
  'hyper-cutter',  // 超强攻击：攻击不会降低
  'huge-power',    // 大力士：物理攻击 2 倍
  'pure-power',    // 瑜珈之力：物理攻击 2 倍
  'drizzle',       // 降雨：出场时下雨
  'sand-stream',   // 扬沙：出场时沙暴
  'swift-swim',    // 悠游自如：下雨时速度翻倍
  'chlorophyll',   // 叶绿素：大晴天时速度翻倍
  'sand-rush',     // 拨沙：沙暴时速度翻倍
  'pressure',      // 压力：对方 PP 消耗翻倍
  'lightning-rod', // 避雷针：电系免疫并回复
  'dry-skin',      // 干燥皮肤：水系回复，火系增伤
  'adaptability',  // 适应力：属性一致加成提升
  'iron-fist',     // 铁拳：拳类招式 1.2 倍
  'reckless',      // 舍身：反伤招式 1.2 倍
  'technician',    // 技术高手：低威力招式 1.5 倍
  'tinted-lens',   // 有色眼镜：效果不好时威力翻倍
  'sand-force',    // 沙之力：沙暴时岩/地/钢 1.3 倍
  'multiscale',    // 多重鳞片：满血伤害减半
  'solid-rock',    // 坚岩：效果绝佳伤害 ×0.75
  'filter',        // 过滤：效果绝佳伤害 ×0.75
  'friend-guard',  // 友情防守：伤害 ×0.75
  'keen-eye',      // 锐利目光：命中不会降低
  'sand-veil',     // 沙隐：沙暴时闪避提升
  'snow-cloak',    // 雪隐：冰雹时闪避提升
  'no-guard',      // 无防守：双方攻击必定命中
  'quick-feet',    // 飞毛腿：麻痹不减速
  'storm-drain',   // 引水：水系免疫，特攻提升
  'sap-sipper',    // 食草：草系免疫，攻击提升
  'motor-drive',   // 电动机：电系免疫，速度提升
  'flame-body',    // 火焰之躯：接触 30% 烧伤
  'poison-touch',  // 毒手：接触 30% 中毒
  'poison-heal',   // 毒疗：中毒时回复 HP
  'ice-body',      // 冰体：冰雹时回复 HP
  'regenerator',   // 再生力：交换时回复 33% HP
  'defiant',       // 不服输：能力降低时攻击 +2
  'competitive',   // 好胜：能力降低时特攻 +2
  'inner-focus',   // 精神力：不会畏缩
  'white-smoke',   // 白烟：能力不会被降低
  'liquid-ooze',   // 储液：吸取招式会伤害攻击者
  'tangled-feet',  // 蹒跚：混乱时闪避提升
  'overcoat',      // 防尘：免疫粉尘类招式
  'prankster',     // 恶作剧之心：变化招式优先度+1，对恶系无效
  'color-change',  // 变色：被招式命中后属性变为该招式属性
])

/**
 * MOVE_EFFECTS 中有定义但引擎未实现其特殊机制的招式。
 * （纯伤害类/基础效果类招式不受影响——它们打伤害没问题）
 */
const UNIMPLEMENTED_MOVE_MECHANICS = new Set([
  // ---- 绑定类（火旋涡/潮旋/绑紧/流沙地狱/死缠烂打/夹住/紧束）----
  'fire-spin', 'whirlpool', 'bind', 'sand-tomb', 'infestation', 'clamp', 'wrap',

  // ---- 场地类（反射壁/光墙/神秘守护）----
  'reflect', 'light-screen', 'safeguard',

  // ---- 撒钉类----
  'spikes', 'toxic-spikes', 'stealth-rock',

  // ---- 封锁类（挑衅/无理取闹/再来一次/封印/石化功）----
  'taunt', 'torment', 'encore', 'disable', 'imprison',

  // ---- 回复类（ Refresh / 治愈铃声 / 治愈波动 / 祈愿）----
  'refresh', 'heal-bell', 'heal-pulse', 'wish',

  // ---- 寄生种子/扎根----
  'leech-seed', 'ingrain',

  // ---- 强制换人类----
  'roar', 'whirlwind', 'dragon-tail',

  // ---- 能力/场地清除类----
  'haze', 'defog',

  // ---- 接力棒----
  'baton-pass',

  // ---- 其他未实现机制----
  'mean-look', 'perish-song', 'aqua-ring', 'magnet-rise',
  'destiny-bond', 'embargo', 'magic-room', 'water-sport', 'wide-guard',
])

/** 已完全实现（含特殊效果逻辑）的技能名称列表 */
const IMPLEMENTED_MOVES_SET = new Set(
  Object.keys(MOVE_EFFECTS).filter(k => !UNIMPLEMENTED_MOVE_MECHANICS.has(k)),
)
IMPLEMENTED_MOVES_SET.add('tackle')
export const IMPLEMENTED_MOVES = IMPLEMENTED_MOVES_SET

export function abilityLabel(name: string, nameZh: string): string {
  return IMPLEMENTED_ABILITIES.has(name) ? nameZh : `${nameZh}*`
}

export function moveLabel(name: string, nameZh: string): string {
  return IMPLEMENTED_MOVES.has(name) ? nameZh : `${nameZh}*`
}
