import type { RecombinedPokemon, Move } from '../data/types'
import { Type } from '../data/types'
import { getTypeEffectiveness } from './TypeChart'
import { isPunchMove, hasMoveTag } from '../data/move-tags'

/** 固定等级 */
const LEVEL = 50

/** 属性一致加成 */
const STAB = 1.5

/**
 * 会心一击「等级 → 概率」对照表（Gen 6+ 分布）
 * stage 0 = 1/16（基础）、1 = 1/8、2 = 1/4、3 = 1/3、4+ = 1/2
 *
 * T13：原先超幸运用 `critRate *= 2` 的硬编码写法只能叠一层，
 * 无法表达「高会心招式 + 超幸运 + 聚气」的叠加，改为等级制。
 * 注意 stage 1 = 1/8 与旧的 (1/16)*2 完全等价，既有测试不受影响。
 */
const CRIT_STAGE_RATES = [1 / 16, 1 / 8, 1 / 4, 1 / 3, 1 / 2]

/**
 * T13：高会心率招式（会心等级 +1）
 * 判定依据为招式说明中的「容易击中要害」。
 */
export const HIGH_CRIT_MOVES = new Set([
  'slash',        // 劈开
  'razor-leaf',   // 飞叶快刀
  'night-slash',  // 暗袭要害
  'psycho-cut',   // 精神利刃
  'stone-edge',   // 尖石攻击
  'air-cutter',   // 空气利刃
  'drill-run',    // 直冲钻
  'shadow-claw',  // 暗影爪
  'cross-poison', // 十字毒刃
  'razor-wind',   // 旋风刀
  'sky-attack',   // 神鸟猛击
])

/**
 * T13：固定伤害招式——造成等于「使用者等级」的伤害。
 * 本项目等级恒为 50，因此固定造成 50 点伤害。
 */
export const FIXED_LEVEL_DAMAGE_MOVES = new Set([
  'seismic-toss', // 地球上投
  'night-shade',  // 黑夜魔影
])

/**
 * T13：按「目标当前 HP 比例」造成固定伤害的招式（猛撞）。
 * 造成 = floor(目标当前 HP / 2)（至少 1），同样不经过常规伤害公式。
 */
export const HALF_HP_DAMAGE_MOVES = new Set([
  'super-fang',   // 猛撞
])

/**
 * T13：伤害改用「目标」攻击力计算的招式（欺诈）。
 */
export const TARGET_ATTACK_MOVES = new Set([
  'foul-play',    // 欺诈
])

/**
 * T14：按「目标体重（kg）」查表决定威力的招式（踢倒 / 打草结）。
 * 对手越重威力越大。
 */
export const TARGET_WEIGHT_MOVES = new Set([
  'low-kick',    // 踢倒
  'grass-knot',  // 打草结
])

/**
 * T14：按「使用者 ÷ 目标 体重比」查表决定威力的招式（重磅冲撞 / 热压）。
 * 自己比对手越重威力越大。
 */
export const RELATIVE_WEIGHT_MOVES = new Set([
  'heavy-slam',  // 重磅冲撞
  'heat-crash',  // 热压
])

/**
 * T14：按目标体重（kg）查表——踢倒 / 打草结。
 *   ≤10→20, ≤25→40, ≤50→60, ≤100→80, ≤200→100, >200→120
 */
function targetWeightPower(targetKg: number): number {
  if (targetKg <= 10) return 20
  if (targetKg <= 25) return 40
  if (targetKg <= 50) return 60
  if (targetKg <= 100) return 80
  if (targetKg <= 200) return 100
  return 120
}

/**
 * T14：按体重比查表——重磅冲撞 / 热压。
 *   ratio = 使用者体重 / 目标体重
 *   ≥2→120, ≥1.5→100, ≥1.0→80, ≥0.6667→60, ≥0.5→40, else→20
 */
function relativeWeightPower(attackerKg: number, defenderKg: number): number {
  // 目标体重为 0 时比值为 Infinity → 归入最高档，避免除零异常
  const ratio = defenderKg > 0 ? attackerKg / defenderKg : Infinity
  if (ratio >= 2) return 120
  if (ratio >= 1.5) return 100
  if (ratio >= 1.0) return 80
  if (ratio >= 0.6667) return 60
  if (ratio >= 0.5) return 40
  return 20
}

/**
 * T14：解析招式的「实际威力」。
 * 体重类招式按体重查表返回威力；其余招式返回 move.power。
 * calculateDamage 用它替代直接读 move.power，使体重机制生效。
 */
export function resolveMovePower(
  move: Move,
  attacker: RecombinedPokemon,
  defender: RecombinedPokemon,
): number {
  if (TARGET_WEIGHT_MOVES.has(move.name)) return targetWeightPower(defender.weightKg)
  if (RELATIVE_WEIGHT_MOVES.has(move.name)) return relativeWeightPower(attacker.weightKg, defender.weightKg)
  return move.power
}

/** 是否为等级固定伤害招式（供 BattleEngine 跳过反射壁/光墙减伤） */
export function isFixedLevelDamageMove(name: string): boolean {
  return FIXED_LEVEL_DAMAGE_MOVES.has(name)
}

/** 是否为「目标 HP 比例」固定伤害招式（同样跳过反射壁/光墙减伤） */
export function isHalfHpDamageMove(name: string): boolean {
  return HALF_HP_DAMAGE_MOVES.has(name)
}

/** 是否为高会心率招式 */
export function isHighCritMove(name: string): boolean {
  return HIGH_CRIT_MOVES.has(name)
}

/** 天气类型（与 BattleEngine 保持一致） */
export type WeatherKind = 'none' | 'sun' | 'rain' | 'sandstorm' | 'hail'

/** 随机因子 [0.85, 1.0] */
function randomFactor(): number {
  return 0.85 + Math.random() * 0.15
}

/**
 * 攻击方是否无视防守方特性（破格 / 涡轮火焰 / 兆级电压）
 * 单一事实来源：BattleEngine 与 DamageCalc 共用此判定。
 */
export function ignoresDefenderAbility(attacker: RecombinedPokemon): boolean {
  const a = attacker.ability.name
  return a === 'mold-breaker' || a === 'teravolt' || a === 'turboblaze'
}

/**
 * 招式的「实际属性」：一般皮肤（normalize）把所有招式变为一般属性。
 * 单一事实来源：BattleEngine 的免疫/相性判定与 DamageCalc 共用此函数，
 * 避免出现「相性算火、伤害算一般」这类前后不一致。
 */
export function effectiveMoveType(attacker: RecombinedPokemon, move: Move): Type {
  if (attacker.ability.name === 'normalize') return Type.Normal
  return move.type
}

/** 倍率明细中的一项（仅用于日志展示非 1 的因子） */
export interface DamagePart {
  label: string
  value: number
}

/** 伤害计算结果（含倍率明细，供日志展示） */
export interface DamageResult {
  base: number
  /** 非 1 的修正因子列表（属性一致 / 属性克制 / 特性 / 天气等） */
  parts: DamagePart[]
  damage: number
}

/**
 * 获取特性加成倍率（同时返回展示标签）
 */
function getAbilityDamageMod(
  attacker: RecombinedPokemon,
  defender: RecombinedPokemon,
  move: Move,
  /**
   * T13：本次伤害的攻击力取自「目标」（欺诈）。
   * 此时使用者自身「修正攻击数值」的特性不参与计算
   * （毅力 / 中毒激升 / 大力士 / 瑜珈之力 / 活力），
   * 而威力修正类特性（铁拳 / 技术高手 / 适应力 …）照常生效。
   */
  usesTargetAttack = false,
): { mod: number; label: string | null } {
  const aAbility = attacker.ability.name
  // 破格：完全无视防守方特性（置空后所有 dAbility 分支自然失效）
  const dAbility = ignoresDefenderAbility(attacker) ? '' : defender.ability.name
  const hpRatio = attacker.currentHp / attacker.maxHp

  // 茂盛/猛火/激流：HP ≤ 1/3 时对应属性 1.5 倍
  if (aAbility === 'overgrow' && move.type === 'grass' && hpRatio <= 1 / 3) return { mod: 1.5, label: '茂盛' }
  if (aAbility === 'blaze' && move.type === 'fire' && hpRatio <= 1 / 3) return { mod: 1.5, label: '猛火' }
  if (aAbility === 'torrent' && move.type === 'water' && hpRatio <= 1 / 3) return { mod: 1.5, label: '激流' }

  // 虫之预感：HP ≤ 1/3 时虫系 1.5 倍
  if (aAbility === 'swarm' && move.type === 'bug' && hpRatio <= 1 / 3) return { mod: 1.5, label: '虫之预感' }

  // 毅力：异常状态时物理攻击 1.5 倍
  if (!usesTargetAttack && aAbility === 'guts' && attacker.status && move.category === 'physical') return { mod: 1.5, label: '毅力' }

  // 中毒激升：中毒时物理攻击 1.5 倍
  if (!usesTargetAttack && aAbility === 'toxic-boost' && (attacker.status === 'poison' || attacker.status === 'bad_poison') && move.category === 'physical') return { mod: 1.5, label: '中毒激升' }

  // 强行：拥有附加效果的招式威力 +30%（附加效果在引擎中被抑制）
  if (aAbility === 'sheer-force' && move.category !== 'status') return { mod: 1.3, label: '强行' }

  // 引火：吸收过火系攻击后火系 1.5 倍
  if (aAbility === 'flash-fire' && move.type === 'fire' && attacker._abilityData?.flashFireActivated) return { mod: 1.5, label: '引火' }

  // 大力士/瑜珈之力：物理攻击 2 倍
  if (!usesTargetAttack && (aAbility === 'huge-power' || aAbility === 'pure-power') && move.category === 'physical') return { mod: 2, label: '大力士' }

  // 活力：物理攻击 1.5 倍（代价是命中降低，在 calcFinalAccuracy 处理）
  if (!usesTargetAttack && aAbility === 'hustle' && move.category === 'physical') return { mod: 1.5, label: '活力' }

  // 厚脂肪：火/冰伤害减半
  if (dAbility === 'thick-fat' && (move.type === 'fire' || move.type === 'ice')) return { mod: 0.5, label: '厚脂肪' }

  // 奇异鳞片：异常状态时物理防御 1.5 倍
  if (dAbility === 'marvel-scale' && defender.status && move.category === 'physical') return { mod: 0.67, label: '奇异鳞片' }

  // 适应力：属性一致加成从 1.5 变为 2（此处返回叠加在 STAB 之上的系数）
  if (aAbility === 'adaptability' && (move.type === attacker.types[0] || move.type === attacker.types[1])) return { mod: 1.33, label: '适应力' }

  // 铁拳：拳类招式 1.2 倍
  if (aAbility === 'iron-fist' && isPunchMove(move.name)) return { mod: 1.2, label: '铁拳' }

  // 舍身：反伤招式 1.2 倍
  if (aAbility === 'reckless' && hasMoveTag(move.name, 'recoil')) return { mod: 1.2, label: '舍身' }

  // 技术高手：威力 ≤ 60 的招式 1.5 倍
  if (aAbility === 'technician' && (move.power ?? 0) <= 60) return { mod: 1.5, label: '技术高手' }

  // 有色眼镜：效果不好的招式威力翻倍
  if (aAbility === 'tinted-lens') {
    const eff = getTypeEffectiveness(move.type, defender.types)
    if (eff > 0 && eff < 1) return { mod: 2, label: '有色眼镜' }
  }

  // 沙之力：沙暴时岩石/地面/钢 1.3 倍
  if (aAbility === 'sand-force' && (move.type === 'rock' || move.type === 'ground' || move.type === 'steel')) return { mod: 1.3, label: '沙之力' }

  // 分析：本回合后手行动时威力 1.3 倍（movedLast 由 BattleEngine.executeTurn 标记）
  if (aAbility === 'analytic' && attacker._abilityData?.movedLast === true) return { mod: 1.3, label: '分析' }

  // 多重鳞片：满血时伤害减半
  if (dAbility === 'multiscale' && defender.currentHp === defender.maxHp) return { mod: 0.5, label: '多重鳞片' }

  // 坚岩/过滤：效果绝佳伤害 ×0.75
  if ((dAbility === 'solid-rock' || dAbility === 'filter') && getTypeEffectiveness(move.type, defender.types) > 1) return { mod: 0.75, label: '坚岩/过滤' }

  // 友情防守：所有伤害 ×0.75
  if (dAbility === 'friend-guard') return { mod: 0.75, label: '友情防守' }

  return { mod: 1, label: null }
}

/**
 * 天气对伤害的影响（标准 Gen 5+ 规则）
 */
function getWeatherDamageMod(move: Move, weather: WeatherKind): { mod: number; label: string | null } {
  if (weather === 'sun') {
    if (move.type === 'fire') return { mod: 1.5, label: '晴天·火' }
    if (move.type === 'water') return { mod: 0.5, label: '晴天·水减' }
  } else if (weather === 'rain') {
    if (move.type === 'water') return { mod: 1.5, label: '下雨·水' }
    if (move.type === 'fire') return { mod: 0.5, label: '下雨·火减' }
  } else if (weather === 'sandstorm') {
    if (move.type === 'rock') return { mod: 1.5, label: '沙暴·岩' }
  } else if (weather === 'hail') {
    if (move.type === 'ice') return { mod: 1.5, label: '冰雹·冰' }
  }
  return { mod: 1, label: null }
}

/** 把倍率格式化为可读字符串（1.5 / 0.5 / 2 / 1.33） */
function fmtMult(v: number): string {
  if (Number.isInteger(v)) return String(v)
  return String(Math.round(v * 100) / 100)
}

/** 把倍率明细拼成日志后缀，如 （属性一致×1.5｜猛火×1.5｜晴天·火×1.5） */
export function formatBreakdown(parts: DamagePart[]): string {
  if (!parts.length) return ''
  return '（' + parts.map(p => `${p.label}×${fmtMult(p.value)}`).join('｜') + '）'
}

/** 场地类修正（不依附于任何一方的全场效果） */
export interface FieldMods {
  /** 玩水（water-sport）生效中：火系招式伤害减半 */
  waterSport?: boolean
  /**
   * 化学变化气体（neutralizing-gas）生效中：
   * 本次伤害计算里所有「特性」相关修正一律失效（攻守双方 + 会心特性）。
   */
  neutralizingGas?: boolean
}

/**
 * 计算伤害（参照第 5 代+ 公式）
 * 固定：等级 50, IV 全 31, EV 全 0
 * 返回伤害与倍率明细，供日志展示。
 */
export function calculateDamage(
  attacker: RecombinedPokemon,
  defender: RecombinedPokemon,
  move: Move,
  weather: WeatherKind = 'none',
  rng: () => number = Math.random,
  field: FieldMods = {},
): DamageResult {
  if (move.category === 'status') return { base: 0, parts: [], damage: 0 }

  // T13 固定伤害：地球上投 / 黑夜魔影 —— 造成等于使用者等级的伤害。
  // 不受属性一致 / 属性克制 / 能力等级 / 会心 / 随机因子影响；
  // 属性免疫（黑夜魔影→一般系、地球上投→幽灵系）由 BattleEngine 的
  // isImmuneToMove 前置拦截，走不到这里。
  if (FIXED_LEVEL_DAMAGE_MOVES.has(move.name)) {
    return { base: LEVEL, parts: [], damage: LEVEL }
  }

  // T13 按 HP 比例固定伤害：猛撞（super-fang）—— 造成 = floor(目标当前 HP / 2)。
  // 与地球上投同一条「固定伤害」路径：不受属性一致 / 属性克制 / 能力等级 /
  // 会心 / 随机因子影响；属性免疫（猛撞→一般系对幽灵无效）由 BattleEngine 的
  // isImmuneToMove 前置拦截，走不到这里。至少造成 1 点，避免退化成 0 伤害。
  if (HALF_HP_DAMAGE_MOVES.has(move.name)) {
    const dmg = Math.max(1, Math.floor(defender.currentHp / 2))
    return { base: dmg, parts: [], damage: dmg }
  }

  // 化学变化气体：本次计算屏蔽一切特性修正
  const gas = field.neutralizingGas === true

  // 一般皮肤：招式属性视为一般属性（第 7 代+ 额外获得 ×1.2 威力修正）
  // 直接替换本函数内的 move 引用，下游 STAB / 相性 / 特性 / 天气全部自动跟随
  const normalized = !gas
    && attacker.ability.name === 'normalize'
    && move.type !== Type.Normal
  if (normalized) move = { ...move, type: Type.Normal }

  // T13 欺诈（foul-play）：伤害改用「目标」的攻击力计算，
  // 并且连同目标的攻击能力等级一起取用（使用者自身的攻击等级完全不参与）。
  const usesTargetAttack = move.category === 'physical' && TARGET_ATTACK_MOVES.has(move.name)
  const atkSource = usesTargetAttack ? defender : attacker

  // 攻击 / 特攻（考虑能力变化）
  const atkStage = atkSource.statStages[
    move.category === 'physical' ? 'attack' : 'spAttack'
  ]
  // 纯朴/单纯：无视对方能力变化（此处处理攻击方无视防御方能力等级）
  const defStage = attacker.ability.name === 'unaware' && !gas
    ? 0
    : defender.statStages[
      move.category === 'physical' ? 'defense' : 'spDefense'
    ]

  // 能力变化倍率（Gen 5+）
  const atkMultiplier = atkStage >= 0 ? (2 + atkStage) / 2 : 2 / (2 - atkStage)
  const defMultiplier = defStage >= 0 ? (2 + defStage) / 2 : 2 / (2 - defStage)

  const baseStat = move.category === 'physical'
    ? atkSource.baseStats.attack
    : atkSource.baseStats.spAttack
  const defStat = move.category === 'physical'
    ? defender.baseStats.defense
    : defender.baseStats.spDefense

  const effectiveAtk = Math.floor(baseStat * atkMultiplier)
  const effectiveDef = Math.floor(defStat * defMultiplier)

  // 基础伤害
  // T14：威力经 resolveMovePower 解析——体重类招式（踢倒/打草结/重磅冲撞/热压）
  // 按体重查表得到实际威力，其余招式返回 move.power。
  const resolvedPower = resolveMovePower(move, attacker, defender)
  const base = Math.floor(
    (Math.floor((2 * LEVEL) / 5 + 2) * (resolvedPower || 1) * effectiveAtk) / effectiveDef / 50 + 2,
  )

  // 修正系数
  const parts: DamagePart[] = []
  let modifier = 1

  // 烧伤：物理伤害减半
  if (attacker.status === 'burn' && move.category === 'physical') {
    modifier *= 0.5
    parts.push({ label: '灼伤', value: 0.5 })
  }

  // 属性一致加成（技能属性与攻击方任一属性相同）
  const isStab = move.type === attacker.types[0] || move.type === attacker.types[1]
  if (isStab) {
    modifier *= STAB
    parts.push({ label: '属性一致', value: STAB })
  }

  // 属性克制
  const effMult = getTypeEffectiveness(move.type, defender.types)
  if (effMult !== 1) {
    modifier *= effMult
    parts.push({ label: '属性克制', value: effMult })
  }

  // 一般皮肤：变属性的招式威力 ×1.2
  if (normalized) {
    modifier *= 1.2
    parts.push({ label: '一般皮肤', value: 1.2 })
  }

  // 特性加成（化学变化气体生效时整段失效）
  const ab = gas ? { mod: 1, label: null } : getAbilityDamageMod(attacker, defender, move, usesTargetAttack)
  if (ab.mod !== 1) {
    modifier *= ab.mod
    if (ab.label) parts.push({ label: ab.label, value: ab.mod })
  }

  // 天气加成
  const w = getWeatherDamageMod(move, weather)
  if (w.mod !== 1) {
    modifier *= w.mod
    if (w.label) parts.push({ label: w.label, value: w.mod })
  }

  // 玩水：全场火系招式伤害减半
  if (field.waterSport && move.type === 'fire') {
    modifier *= 0.5
    parts.push({ label: '玩水', value: 0.5 })
  }

  // 会心一击：由「会心等级」决定概率，硬壳盔甲/战斗铠甲免疫
  //   高会心率招式（劈开/尖石攻击…）+1、超幸运 +1、聚气 +2
  // 聚气是招式效果而非特性，因此不受化学变化气体屏蔽。
  let critStage = 0
  if (HIGH_CRIT_MOVES.has(move.name)) critStage += 1
  if (attacker.ability.name === 'super-luck' && !gas) critStage += 1
  if (attacker._abilityData?.focusEnergy === true) critStage += 2
  const critRate = CRIT_STAGE_RATES[Math.min(critStage, CRIT_STAGE_RATES.length - 1)]
  let isCritical = rng() < critRate
  // 破格无视硬壳盔甲/战斗铠甲的会心免疫；化学变化气体同样让两者失效
  if (!gas && !ignoresDefenderAbility(attacker)
    && (defender.ability.name === 'shell-armor' || defender.ability.name === 'battle-armor')) {
    isCritical = false
  }
  if (isCritical) {
    const critMod = attacker.ability.name === 'sniper' && !gas ? 2.25 : 1.5
    modifier *= critMod
    parts.push({ label: '会心一击', value: critMod })
  }

  modifier *= randomFactor() // 随机因子（不计入展示明细）

  return { base, parts, damage: Math.max(1, Math.floor(base * modifier)) }
}

/**
 * 检查是否有属性免疫
 */
export function isImmune(
  move: Move,
  defender: RecombinedPokemon,
): boolean {
  return getTypeEffectiveness(move.type, defender.types) === 0
}
