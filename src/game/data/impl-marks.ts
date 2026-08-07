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
  'shell-armor',   // 硬壳盔甲：不会被会心一击
  'battle-armor',  // 战斗盔甲：不会被会心一击
  'magic-guard',   // 魔法防守：免疫非直接伤害（天气/状态/反伤）
  'wonder-guard',  // 神奇守护：只受效果绝佳的招式伤害

  // ===== 被动/数值类特性（T5 批次）=====
  'sniper',        // 狙击手：会心一击伤害 ×2.25
  'super-luck',    // 超幸运：会心一击率翻倍
  'unaware',       // 纯朴：无视对方防御能力等级
  'toxic-boost',   // 中毒激升：中毒时物理招式 ×1.5
  'stall',         // 慢出：优先度 -7（最后出手）
  'skill-link',    // 连续攻击：多段招式固定最大段数
  'infiltrator',   // 穿透：无视墙/光幕/替身减伤
  'cloud-nine',    // 无关天气：压制全场天气效果

  // ===== T6 被动特性批次 =====
  'contrary',      // 唱反调：能力变化反转
  'simple',        // 单纯：能力变化翻倍
  'big-pecks',     // 健壮胸肌：防御不会被降低
  'trace',         // 复制：入场复制对方特性
  'download',      // 下载：依对方防御提升攻击/特攻
  'forewarn',      // 预知梦：提示对方最强招式
  'sheer-force',   // 强行：威力 +30%，抑制附加效果
  'anger-point',   // 愤怒穴位：被会心一击后攻击拉满
  'justified',     // 正义之心：被恶系命中攻击 +1
  'weak-armor',    // 碎裂铠甲：受物理攻击防御 -1、速度 +1
  'rattled',       // 胆怯：被虫/恶/幽灵命中速度 +1
  'solar-power',   // 太阳之力：晴天每回合损失 1/8 HP
  'hydration',     // 湿润之躯：雨天治愈异常状态
  'leaf-guard',    // 叶子防守：晴天免疫异常状态
  'arena-trap',    // 沙穴：地面系对手无法换人
  'shadow-tag',    // 踩影：对手无法换人
  'magnet-pull',   // 磁力：钢系对手无法换人
  'suction-cups',  // 吸盘：不会被吼叫/吹飞/龙尾强制拖出
  'scrappy',       // 胆量：普通/格斗可命中幽灵系

  // ===== T9 批次 =====
  'moxie',         // 自信过剩：击倒对手后攻击 +1
  'steadfast',     // 不屈之心：每次畏缩时速度 +1
  'analytic',      // 分析：本回合后手行动时伤害 ×1.3
  'truant',        // 懒惰：每隔一回合无法行动
  'stench',        // 恶臭：攻击招式 10% 追加畏缩
  'wonder-skin',   // 神奇皮肤：受到变化招式时命中率降为 50
  'aftermath',     // 引爆：因接触招式倒下时对攻击方造成 1/4 最大 HP 伤害
  'mold-breaker',  // 破格：无视防守方特性
  'magic-bounce',  // 魔法镜：反弹对手的变化招式
  'oblivious',     // 迟钝：免疫威吓与混乱
  'moody',         // 心情不定：回合末随机一项 +2、另一项 -1
  'imposter',      // 变身者：登场时变身为对手

  // ===== T11 批次 =====
  'cursed-body',   // 诅咒之躯：被接触招式命中后 30% 让该招式变为定身法状态
  'soundproof',    // 隔音：完全免疫声音类招式（move-tags 的 sound 标签）
  'normalize',     // 一般皮肤：所有招式属性变为一般，威力 ×1.2
  'forecast',      // 阴晴不定：随天气切换自身属性（晴→火/雨→水/雹→冰/沙→岩）
  'protean',       // 变幻自如：出招时自身属性变为该招式属性
  'wind-rider',    // 乘风：免疫风类招式伤害（含吹飞）并提升攻击
  // 以下两项「摘星」理由是**本游戏不存在对应机制 / 该特性本就无数值效果**，
  // 引擎已做出明确决策而非假装实现：
  'illuminate',    // 发光：原作只影响野生遇敌率，本游戏无遇敌率系统 → 战斗中确定无操作
  'anticipation',  // 危险预知：原作只是登场提示，无数值效果 → 仅设 _abilityData.anticipating 标记

  // ⚠️ 'neutralizing-gas'（化学变化气体）**故意不列入**：
  //    当前只实现了「屏蔽防守方特性 + 屏蔽伤害计算内的特性修正」的降级版，
  //    入场特性 / 回合末特性 / 攻击方主动特性 仍会正常生效，
  //    与「场上所有特性失效」的描述不符，因此保留星号。
])

/**
 * MOVE_EFFECTS 中有定义但引擎未实现其特殊机制的招式。
 * （纯伤害类/基础效果类招式不受影响——它们打伤害没问题）
 */
const UNIMPLEMENTED_MOVE_MECHANICS = new Set([
  // ---- 绑定类已实现：4~5 回合无法换人 + 每回合末扣 1/8 ----

  // ---- 封锁类已实现（T10）：挑衅/无理取闹/再来一次/定身法/封锁 ----

  // ---- 回复类已实现：精神觉醒/治愈铃声/治愈波动/祈愿/水流环 ----

  // ---- 强制换人类已实现：吼叫/吹飞/龙尾（吸盘·扎根可挡）----

  // ---- 能力/场地清除类已实现（T10）：白雾/清雾 ----

  // ---- 接力棒已实现（T10）：换人并交接能力等级 ----

  // ---- 其他已实现（T10）：黑眼神/灭亡之歌/电磁悬浮/同命/玩水 ----

  // ---- 仍未实现：依赖尚未落地的系统 ----
  'embargo',      // 需要道具系统
  'magic-room',   // 需要道具系统
  'wide-guard',   // 需要多目标（spread）招式，当前招式数据无多目标招式

  // ---- 恢复诚实星号：二段蓄力（two-turn）机制引擎完全未实现 ----
  // 这些招式在 move-effects.ts 标了 kind:'two-turn'，但 BattleEngine 里
  // 没有任何蓄力/半无敌回合的实现（全局搜索 'two-turn' 只出现在数据表里）。
  // 之前它们靠「在 MOVE_EFFECTS 里有键」被自动摘星，属于假摘星，
  // 按用户铁律恢复星号。注意 razor-wind / sky-attack 的「高会心率」是真实现的
  //（见 DamageCalc.HIGH_CRIT_MOVES），但招牌的蓄力机制没实现 → 仍带星号，诚实。
  'solar-beam',   // 日光束：晴天免蓄力等机制未实现
  'fly',          // 飞天：第一回合升空（半无敌）未实现
  'dig',          // 挖洞：第一回合潜地（半无敌）未实现
  'dive',         // 潜水：第一回合潜水（半无敌）未实现
  'skull-bash',   // 火箭头锤：第一回合提防御后攻击未实现
  'razor-wind',   // 旋风刀：蓄力回合未实现（高会心率已实现）
  'sky-attack',   // 神鸟猛击：蓄力回合未实现（高会心率已实现）
  'focus-punch',  // 真气拳：蓄力 + 受击打断未实现
  // ---- 恢复诚实星号：空操作占位（机制未实现）----
  'laser-focus',  // 磨砺：数据为 selfStatChanges:[] 空操作，「下次必定会心」未实现
])

/**
 * T12：纯伤害招式白名单（不在 MOVE_EFFECTS 中，但引擎已能完整正确地表现其规范效果）。
 *
 * 背景：原先「已实现」被绑死在 MOVE_EFFECTS（特殊效果表）上，导致 137 个
 * physical/special 招式因为「没有特殊效果可登记」反而被一刀切打上星号——
 * 但它们本来就只是按威力打伤害，星号属于误标。
 *
 * 入选标准（必须全部满足，判定依据为正统宝可梦中的**规范效果**）：
 *   1. 不在 MOVE_EFFECTS 中；
 *   2. 规范效果就是「按威力造成基础伤害」，且
 *      - 无任何二次效果（异常状态 / 能力升降 / 畏缩，哪怕只有 10% 也不算）；
 *      - 无特殊伤害公式（对方攻击力 / 固定伤害 / 按 HP / 体重 / 速度 /
 *        亲密度 / 先后手 / 地形 / 天气 / 能力等级 / 道具 …）；
 *      - 无特殊命中（必中、天气改变命中、一击必杀）；
 *      - 非多段、非充能、非反伤、非吸收、非变身/复制、非高会心率。
 *   3. 仅带「先制度」的招式可入选——priority 是 Move 数据字段，
 *      BattleEngine 的出手顺序计算已完整支持，不存在未实现部分。
 *
 * ⚠️ 铁律：星号要诚实。拿不准的一律不入白名单（保留星号）。
 *    宁可少摘星，绝不误摘星。
 */
const PLAIN_DAMAGE_MOVES: string[] = [
  'aqua-jet',        // 水流喷射：40 威力，仅先制 +1
  'aqua-tail',       // 水流尾：90 威力
  'cut',             // 居合斩：50 威力
  'dragon-claw',     // 龙爪：80 威力
  'dragon-pulse',    // 龙之波动：85 威力
  'high-horsepower', // 十万马力：95 威力
  'hydro-pump',      // 水炮：110 威力
  'mega-kick',       // 百万吨重踢：120 威力
  'mega-punch',      // 百万吨重拳：80 威力
  'peck',            // 啄：35 威力
  'pound',           // 拍击：40 威力
  'power-gem',       // 力量宝石：80 威力
  'quick-attack',    // 电光一闪：40 威力，仅先制 +1
  'rock-throw',      // 落石：50 威力
  'scratch',         // 抓：40 威力
  'seed-bomb',       // 种子炸弹：80 威力
  'slam',            // 摔打：80 威力
  'strength',        // 怪力：80 威力
  'tackle',          // 撞击：40 威力
  'vacuum-wave',     // 真空波：40 威力，仅先制 +1
  'water-gun',       // 水枪：40 威力
  'wing-attack',     // 翅膀攻击：60 威力
  'x-scissor',       // 十字剪：80 威力
]

/**
 * T13：招牌机制已在引擎内真实实现、但机制无法用 MOVE_EFFECTS 表达的招式。
 *
 * 与 PLAIN_DAMAGE_MOVES 的区别：这些招式**有**特殊机制，
 * 只是该机制的落点在 DamageCalc / BattleEngine 的代码里而不是效果表里。
 *
 * ⚠️ 铁律：只有「机制已实现 + 有针对性测试覆盖」才能进这张表。
 *    每一条后面都注明实现位置，方便审计。
 */
const T13_MECHANIC_MOVES: string[] = [
  // ---- 特殊伤害来源：DamageCalc.calculateDamage / TARGET_ATTACK_MOVES ----
  'foul-play',     // 欺诈：伤害改用「目标」的攻击力 + 目标的攻击能力等级

  // ---- 固定伤害：DamageCalc.calculateDamage / FIXED_LEVEL_DAMAGE_MOVES ----
  'seismic-toss',  // 地球上投：固定造成 = 使用者等级（50）的伤害
  'night-shade',   // 黑夜魔影：固定造成 = 使用者等级（50）的伤害

  // ---- 按 HP 比例固定伤害：DamageCalc.calculateDamage / HALF_HP_DAMAGE_MOVES ----
  'super-fang',    // 猛撞：固定造成 = floor(目标当前 HP / 2)（至少 1）

  // ---- 高会心率：DamageCalc 会心等级制 / HIGH_CRIT_MOVES（会心等级 +1）----
  'slash',         // 劈开
  'razor-leaf',    // 飞叶快刀
  'night-slash',   // 暗袭要害
  'psycho-cut',    // 精神利刃
  'stone-edge',    // 尖石攻击
  'air-cutter',    // 空气利刃
  'drill-run',     // 直冲钻
]

/**
 * T14：体重 / 亲密度 / 性别机制已在引擎内真实实现的招式。
 *
 * 与 T13_MECHANIC_MOVES 同理，机制落点在 DamageCalc / BattleEngine 代码里：
 *   - 亲密度：报恩 / 迁怒按用户铁律直接设为满威力 102（moves.ts 的 power:102）；
 *   - 体重：踢倒 / 打草结按目标体重、重磅冲撞 / 热压按体重比
 *     （DamageCalc.resolveMovePower）；
 *   - 性别：迷人（迷恋 infatuation + 门控）/ 诱惑（特攻 -2 + 门控）
 *     （BattleEngine.canAttract / applyStatusEffect / canAct）。
 */
const T14_MECHANIC_MOVES: string[] = [
  'return',      // 报恩：满威力 102
  'frustration', // 迁怒：满威力 102
  'low-kick',    // 踢倒：按目标体重
  'grass-knot',  // 打草结：按目标体重
  'heavy-slam',  // 重磅冲撞：按体重比
  'heat-crash',  // 热压：按体重比
  'attract',     // 迷人：迷恋 + 性别门控
  'captivate',   // 诱惑：特攻 -2 + 性别门控
]

/** 已完全实现（含特殊效果逻辑）的技能名称列表 */
const IMPLEMENTED_MOVES_SET = new Set(
  Object.keys(MOVE_EFFECTS).filter(k => !UNIMPLEMENTED_MOVE_MECHANICS.has(k)),
)
for (const m of PLAIN_DAMAGE_MOVES) IMPLEMENTED_MOVES_SET.add(m)
for (const m of T13_MECHANIC_MOVES) IMPLEMENTED_MOVES_SET.add(m)
for (const m of T14_MECHANIC_MOVES) IMPLEMENTED_MOVES_SET.add(m)
export const IMPLEMENTED_MOVES = IMPLEMENTED_MOVES_SET

export function abilityLabel(name: string, nameZh: string): string {
  return IMPLEMENTED_ABILITIES.has(name) ? nameZh : `${nameZh}*`
}

export function moveLabel(name: string, nameZh: string): string {
  return IMPLEMENTED_MOVES.has(name) ? nameZh : `${nameZh}*`
}
