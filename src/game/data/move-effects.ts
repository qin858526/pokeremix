/**
 * 技能效果定义：描述攻击技能的附加效果和变化类技能的主要效果
 * 数据驱动方式替代硬编码 switch-case
 */

import type { StatusCondition } from './types'

// ==================== 类型定义 ====================

export type StatName = 'attack' | 'defense' | 'spAttack' | 'spDefense' | 'speed' | 'accuracy' | 'evasion'

export interface StatChange {
  stat: StatName
  stages: number // 正 = 提升, 负 = 降低
  target: 'self' | 'enemy'
  chance: number // 0-100, 100 = 必定
}

export interface AttackSecondaryEffect {
  /** 触发概率 (0-100) */
  chance: number
  /** 异常状态（含特殊伪状态：畏缩/混乱/三攻随机/束缚） */
  status?: StatusCondition | 'flinch' | 'confuse' | 'tri-status' | 'trap'
  /** 能力变化（可能多项） */
  statChanges?: StatChange[]
}

export interface StatusMoveEffect {
  /** 自身能力变化 */
  selfStatChanges?: StatChange[]
  /** 对方能力变化 */
  enemyStatChanges?: StatChange[]
  /** 赋予异常状态 */
  inflictStatus?: StatusCondition
  /** 混乱 */
  confuse?: boolean
  /** 回复比例 (0-1) */
  healRatio?: number
}

export interface DrainEffect {
  /** 吸取比例 (占伤害的百分比 0-1) */
  ratio: number
}

export interface RecoilEffect {
  /** 反伤比例 (占伤害的百分比 0-1) */
  ratio: number
}

export interface MultiHitEffect {
  min: number
  max: number
}

export type MoveEffect =
  | { kind: 'attack-secondary'; data: AttackSecondaryEffect }
  | { kind: 'status'; data: StatusMoveEffect }
  | { kind: 'drain'; data: DrainEffect }
  | { kind: 'recoil'; data: RecoilEffect }
  | { kind: 'multi-hit'; data: MultiHitEffect }
  | { kind: 'always-hit' }
  | { kind: 'recharge' }
  | { kind: 'two-turn' }

// ==================== 效果数据 ====================

/**
 * 技能效果映射表
 * key: move.name (PokeAPI 英文短横线名)
 */
export const MOVE_EFFECTS: Record<string, MoveEffect> = {
  // ======== 异常状态：烧伤 ========
  'ember': { kind: 'attack-secondary', data: { chance: 10, status: 'burn' } },
  'flamethrower': { kind: 'attack-secondary', data: { chance: 10, status: 'burn' } },
  'fire-blast': { kind: 'attack-secondary', data: { chance: 10, status: 'burn' } },
  'fire-punch': { kind: 'attack-secondary', data: { chance: 10, status: 'burn' } },
  'heat-wave': { kind: 'attack-secondary', data: { chance: 10, status: 'burn' } },
  'sacred-fire': { kind: 'attack-secondary', data: { chance: 50, status: 'burn' } },
  'scald': { kind: 'attack-secondary', data: { chance: 30, status: 'burn' } },
  'will-o-wisp': { kind: 'status', data: { inflictStatus: 'burn' } },

  // ======== 异常状态：冰冻 ========
  'ice-beam': { kind: 'attack-secondary', data: { chance: 10, status: 'freeze' } },
  'blizzard': { kind: 'attack-secondary', data: { chance: 10, status: 'freeze' } },
  'ice-punch': { kind: 'attack-secondary', data: { chance: 10, status: 'freeze' } },
  'powder-snow': { kind: 'attack-secondary', data: { chance: 10, status: 'freeze' } },
  'ice-fang': { kind: 'attack-secondary', data: { chance: 10, status: 'freeze' } },

  // ======== 异常状态：麻痹 ========
  'thunder-shock': { kind: 'attack-secondary', data: { chance: 10, status: 'paralysis' } },
  'thunderbolt': { kind: 'attack-secondary', data: { chance: 10, status: 'paralysis' } },
  'thunder': { kind: 'attack-secondary', data: { chance: 30, status: 'paralysis' } },
  'body-slam': { kind: 'attack-secondary', data: { chance: 30, status: 'paralysis' } },
  'thunder-punch': { kind: 'attack-secondary', data: { chance: 10, status: 'paralysis' } },
  'lick': { kind: 'attack-secondary', data: { chance: 30, status: 'paralysis' } },
  'spark': { kind: 'attack-secondary', data: { chance: 30, status: 'paralysis' } },
  'dragon-breath': { kind: 'attack-secondary', data: { chance: 30, status: 'paralysis' } },
  'bounce': { kind: 'attack-secondary', data: { chance: 30, status: 'paralysis' } },
  'zap-cannon': { kind: 'attack-secondary', data: { chance: 100, status: 'paralysis' } },
  'thunder-wave': { kind: 'status', data: { inflictStatus: 'paralysis' } },
  'glare': { kind: 'status', data: { inflictStatus: 'paralysis' } },
  'stun-spore': { kind: 'status', data: { inflictStatus: 'paralysis' } },

  // ======== 异常状态：中毒 ========
  'poison-sting': { kind: 'attack-secondary', data: { chance: 30, status: 'poison' } },
  'sludge': { kind: 'attack-secondary', data: { chance: 30, status: 'poison' } },
  'sludge-bomb': { kind: 'attack-secondary', data: { chance: 30, status: 'poison' } },
  'poison-jab': { kind: 'attack-secondary', data: { chance: 30, status: 'poison' } },
  'gunk-shot': { kind: 'attack-secondary', data: { chance: 30, status: 'poison' } },
  'smog': { kind: 'attack-secondary', data: { chance: 40, status: 'poison' } },
  'cross-poison': { kind: 'attack-secondary', data: { chance: 10, status: 'poison' } },
  'poison-fang': { kind: 'attack-secondary', data: { chance: 50, status: 'poison' } },
  'toxic': { kind: 'status', data: { inflictStatus: 'bad_poison' } },
  'poison-powder': { kind: 'status', data: { inflictStatus: 'poison' } },

  // ======== 异常状态：睡眠 ========
  'hypnosis': { kind: 'status', data: { inflictStatus: 'sleep' } },
  'sing': { kind: 'status', data: { inflictStatus: 'sleep' } },
  'spore': { kind: 'status', data: { inflictStatus: 'sleep' } },
  'sleep-powder': { kind: 'status', data: { inflictStatus: 'sleep' } },
  'grass-whistle': { kind: 'status', data: { inflictStatus: 'sleep' } },
  'yawn': { kind: 'status', data: { inflictStatus: 'sleep' } },
  'lovely-kiss': { kind: 'status', data: { inflictStatus: 'sleep' } },

  // ======== 异常状态：混乱 ========
  'confusion': { kind: 'attack-secondary', data: { chance: 10, status: 'confuse' } },
  'psybeam': { kind: 'attack-secondary', data: { chance: 10, status: 'confuse' } },
  'signal-beam': { kind: 'attack-secondary', data: { chance: 10, status: 'confuse' } },
  'water-pulse': { kind: 'attack-secondary', data: { chance: 20, status: 'confuse' } },
  'confuse-ray': { kind: 'status', data: { confuse: true } },
  'supersonic': { kind: 'status', data: { confuse: true } },
  'swagger': { kind: 'status', data: { confuse: true, selfStatChanges: [{ stat: 'attack', stages: 2, target: 'self', chance: 100 }] } },
  'flatter': { kind: 'status', data: { confuse: true, selfStatChanges: [{ stat: 'spAttack', stages: 1, target: 'self', chance: 100 }] } },
  'teeter-dance': { kind: 'status', data: { confuse: true } },

  // ======== 畏缩 ========
  'headbutt': { kind: 'attack-secondary', data: { chance: 30, status: 'flinch' } },
  'bite': { kind: 'attack-secondary', data: { chance: 30, status: 'flinch' } },
  'rock-slide': { kind: 'attack-secondary', data: { chance: 30, status: 'flinch' } },
  'dark-pulse': { kind: 'attack-secondary', data: { chance: 20, status: 'flinch' } },
  'air-slash': { kind: 'attack-secondary', data: { chance: 30, status: 'flinch' } },
  'iron-head': { kind: 'attack-secondary', data: { chance: 30, status: 'flinch' } },
  'stomp': { kind: 'attack-secondary', data: { chance: 30, status: 'flinch' } },
  'astonish': { kind: 'attack-secondary', data: { chance: 30, status: 'flinch' } },
  'zen-headbutt': { kind: 'attack-secondary', data: { chance: 20, status: 'flinch' } },
  'fake-out': { kind: 'attack-secondary', data: { chance: 100, status: 'flinch' } },
  'waterfall': { kind: 'attack-secondary', data: { chance: 20, status: 'flinch' } },
  'dragon-rush': { kind: 'attack-secondary', data: { chance: 20, status: 'flinch' } },

  // ======== 能力变化（攻击技能）：降速度 ========
  'bubble-beam': { kind: 'attack-secondary', data: { chance: 10, statChanges: [{ stat: 'speed', stages: -1, target: 'enemy', chance: 100 }] } },
  'bubble': { kind: 'attack-secondary', data: { chance: 10, statChanges: [{ stat: 'speed', stages: -1, target: 'enemy', chance: 100 }] } },
  'icy-wind': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'speed', stages: -1, target: 'enemy', chance: 100 }] } },
  'mud-shot': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'speed', stages: -1, target: 'enemy', chance: 100 }] } },
  'rock-tomb': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'speed', stages: -1, target: 'enemy', chance: 100 }] } },
  'bulldoze': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'speed', stages: -1, target: 'enemy', chance: 100 }] } },
  'electroweb': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'speed', stages: -1, target: 'enemy', chance: 100 }] } },
  'low-sweep': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'speed', stages: -1, target: 'enemy', chance: 100 }] } },
  'trailblaze': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'speed', stages: 1, target: 'self', chance: 100 }] } },
  'flame-charge': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'speed', stages: 1, target: 'self', chance: 100 }] } },
  'string-shot': { kind: 'status', data: { enemyStatChanges: [{ stat: 'speed', stages: -2, target: 'enemy', chance: 100 }] } },

  // ======== 能力变化（攻击技能）：降防御 ========
  'rock-smash': { kind: 'attack-secondary', data: { chance: 50, statChanges: [{ stat: 'defense', stages: -1, target: 'enemy', chance: 100 }] } },
  'crunch': { kind: 'attack-secondary', data: { chance: 20, statChanges: [{ stat: 'defense', stages: -1, target: 'enemy', chance: 100 }] } },
  'iron-tail': { kind: 'attack-secondary', data: { chance: 30, statChanges: [{ stat: 'defense', stages: -1, target: 'enemy', chance: 100 }] } },
  'liquidation': { kind: 'attack-secondary', data: { chance: 20, statChanges: [{ stat: 'defense', stages: -1, target: 'enemy', chance: 100 }] } },
  'shadow-claw': { kind: 'attack-secondary', data: { chance: 0, statChanges: [] } }, // high crit rate, handled separately
  'metal-claw': { kind: 'attack-secondary', data: { chance: 10, statChanges: [{ stat: 'attack', stages: 1, target: 'self', chance: 100 }] } },

  // ======== 能力变化（攻击技能）：降特防 ========
  'psychic': { kind: 'attack-secondary', data: { chance: 10, statChanges: [{ stat: 'spDefense', stages: -1, target: 'enemy', chance: 100 }] } },
  'shadow-ball': { kind: 'attack-secondary', data: { chance: 20, statChanges: [{ stat: 'spDefense', stages: -1, target: 'enemy', chance: 100 }] } },
  'energy-ball': { kind: 'attack-secondary', data: { chance: 10, statChanges: [{ stat: 'spDefense', stages: -1, target: 'enemy', chance: 100 }] } },
  'earth-power': { kind: 'attack-secondary', data: { chance: 10, statChanges: [{ stat: 'spDefense', stages: -1, target: 'enemy', chance: 100 }] } },
  'flash-cannon': { kind: 'attack-secondary', data: { chance: 10, statChanges: [{ stat: 'spDefense', stages: -1, target: 'enemy', chance: 100 }] } },
  'moonblast': { kind: 'attack-secondary', data: { chance: 30, statChanges: [{ stat: 'spAttack', stages: -1, target: 'enemy', chance: 100 }] } },

  // ======== 能力变化（攻击技能）：降攻击 ========
  'aurora-beam': { kind: 'attack-secondary', data: { chance: 10, statChanges: [{ stat: 'attack', stages: -1, target: 'enemy', chance: 100 }] } },
  'snarl': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'spAttack', stages: -1, target: 'enemy', chance: 100 }] } },
  'play-rough': { kind: 'attack-secondary', data: { chance: 10, statChanges: [{ stat: 'attack', stages: -1, target: 'enemy', chance: 100 }] } },
  'muddy-water': { kind: 'attack-secondary', data: { chance: 30, statChanges: [{ stat: 'accuracy', stages: -1, target: 'enemy', chance: 100 }] } },

  // ======== 能力变化（攻击技能）：降命中 ========
  'mud-slap': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'accuracy', stages: -1, target: 'enemy', chance: 100 }] } },
  'smokescreen': { kind: 'status', data: { enemyStatChanges: [{ stat: 'accuracy', stages: -1, target: 'enemy', chance: 100 }] } },
  'flash': { kind: 'status', data: { enemyStatChanges: [{ stat: 'accuracy', stages: -1, target: 'enemy', chance: 100 }] } },
  'kinesis': { kind: 'status', data: { enemyStatChanges: [{ stat: 'accuracy', stages: -1, target: 'enemy', chance: 100 }] } },
  'sand-attack': { kind: 'status', data: { enemyStatChanges: [{ stat: 'accuracy', stages: -1, target: 'enemy', chance: 100 }] } },
  'sweet-scent': { kind: 'status', data: { enemyStatChanges: [{ stat: 'evasion', stages: -2, target: 'enemy', chance: 100 }] } },
  'smoke-screen': { kind: 'status', data: { enemyStatChanges: [{ stat: 'accuracy', stages: -1, target: 'enemy', chance: 100 }] } },

  // ======== 能力变化（攻击技能）：自升能力 ========
  'ominous-wind': { kind: 'attack-secondary', data: { chance: 10, statChanges: [
    { stat: 'attack', stages: 1, target: 'self', chance: 100 },
    { stat: 'defense', stages: 1, target: 'self', chance: 100 },
    { stat: 'spAttack', stages: 1, target: 'self', chance: 100 },
    { stat: 'spDefense', stages: 1, target: 'self', chance: 100 },
    { stat: 'speed', stages: 1, target: 'self', chance: 100 },
  ] } },
  'ancient-power': { kind: 'attack-secondary', data: { chance: 10, statChanges: [
    { stat: 'attack', stages: 1, target: 'self', chance: 100 },
    { stat: 'defense', stages: 1, target: 'self', chance: 100 },
    { stat: 'spAttack', stages: 1, target: 'self', chance: 100 },
    { stat: 'spDefense', stages: 1, target: 'self', chance: 100 },
    { stat: 'speed', stages: 1, target: 'self', chance: 100 },
  ] } },
  'charge-beam': { kind: 'attack-secondary', data: { chance: 70, statChanges: [{ stat: 'spAttack', stages: 1, target: 'self', chance: 100 }] } },

  // ======== 变化技能：能力提升（自身） ========
  'swords-dance': { kind: 'status', data: { selfStatChanges: [{ stat: 'attack', stages: 2, target: 'self', chance: 100 }] } },
  'defense-curl': { kind: 'status', data: { selfStatChanges: [{ stat: 'defense', stages: 1, target: 'self', chance: 100 }] } },
  'hone-claws': { kind: 'status', data: { selfStatChanges: [
    { stat: 'attack', stages: 1, target: 'self', chance: 100 },
    { stat: 'accuracy', stages: 1, target: 'self', chance: 100 },
  ] } },
  'double-team': { kind: 'status', data: { selfStatChanges: [{ stat: 'evasion', stages: 1, target: 'self', chance: 100 }] } },
  'agility': { kind: 'status', data: { selfStatChanges: [{ stat: 'speed', stages: 2, target: 'self', chance: 100 }] } },
  'nasty-plot': { kind: 'status', data: { selfStatChanges: [{ stat: 'spAttack', stages: 2, target: 'self', chance: 100 }] } },
  'iron-defense': { kind: 'status', data: { selfStatChanges: [{ stat: 'defense', stages: 2, target: 'self', chance: 100 }] } },
  'amnesia': { kind: 'status', data: { selfStatChanges: [{ stat: 'spDefense', stages: 2, target: 'self', chance: 100 }] } },
  'bulk-up': { kind: 'status', data: { selfStatChanges: [
    { stat: 'attack', stages: 1, target: 'self', chance: 100 },
    { stat: 'defense', stages: 1, target: 'self', chance: 100 },
  ] } },
  'calm-mind': { kind: 'status', data: { selfStatChanges: [
    { stat: 'spAttack', stages: 1, target: 'self', chance: 100 },
    { stat: 'spDefense', stages: 1, target: 'self', chance: 100 },
  ] } },
  'dragon-dance': { kind: 'status', data: { selfStatChanges: [
    { stat: 'attack', stages: 1, target: 'self', chance: 100 },
    { stat: 'speed', stages: 1, target: 'self', chance: 100 },
  ] } },
  'rock-polish': { kind: 'status', data: { selfStatChanges: [{ stat: 'speed', stages: 2, target: 'self', chance: 100 }] } },
  'curse': { kind: 'status', data: { selfStatChanges: [
    { stat: 'attack', stages: 1, target: 'self', chance: 100 },
    { stat: 'defense', stages: 1, target: 'self', chance: 100 },
    { stat: 'speed', stages: -1, target: 'self', chance: 100 },
  ] } },
  'focus-energy': { kind: 'status', data: { selfStatChanges: [] } }, // raises crit rate
  'growth': { kind: 'status', data: { selfStatChanges: [
    { stat: 'attack', stages: 1, target: 'self', chance: 100 },
    { stat: 'spAttack', stages: 1, target: 'self', chance: 100 },
  ] } },
  'minimize': { kind: 'status', data: { selfStatChanges: [{ stat: 'evasion', stages: 2, target: 'self', chance: 100 }] } },
  'cosmic-power': { kind: 'status', data: { selfStatChanges: [
    { stat: 'defense', stages: 1, target: 'self', chance: 100 },
    { stat: 'spDefense', stages: 1, target: 'self', chance: 100 },
  ] } },
  'howl': { kind: 'status', data: { selfStatChanges: [{ stat: 'attack', stages: 1, target: 'self', chance: 100 }] } },
  'meditate': { kind: 'status', data: { selfStatChanges: [{ stat: 'attack', stages: 1, target: 'self', chance: 100 }] } },
  'sharpen': { kind: 'status', data: { selfStatChanges: [{ stat: 'attack', stages: 1, target: 'self', chance: 100 }] } },
  'work-up': { kind: 'status', data: { selfStatChanges: [
    { stat: 'attack', stages: 1, target: 'self', chance: 100 },
    { stat: 'spAttack', stages: 1, target: 'self', chance: 100 },
  ] } },
  'tailwind': { kind: 'status', data: { selfStatChanges: [] } }, // doubles speed for 4 turns (team)
  'laser-focus': { kind: 'status', data: { selfStatChanges: [] } }, // guarantees crit on next move
  'withdraw': { kind: 'status', data: { selfStatChanges: [{ stat: 'defense', stages: 1, target: 'self', chance: 100 }] } },
  'barrier': { kind: 'status', data: { selfStatChanges: [{ stat: 'defense', stages: 2, target: 'self', chance: 100 }] } },
  'acid-armor': { kind: 'status', data: { selfStatChanges: [{ stat: 'defense', stages: 2, target: 'self', chance: 100 }] } },

  // ======== 变化技能：能力降低（对方） ========
  'growl': { kind: 'status', data: { enemyStatChanges: [{ stat: 'attack', stages: -1, target: 'enemy', chance: 100 }] } },
  'tail-whip': { kind: 'status', data: { enemyStatChanges: [{ stat: 'defense', stages: -1, target: 'enemy', chance: 100 }] } },
  'leer': { kind: 'status', data: { enemyStatChanges: [{ stat: 'defense', stages: -1, target: 'enemy', chance: 100 }] } },
  'screech': { kind: 'status', data: { enemyStatChanges: [{ stat: 'defense', stages: -2, target: 'enemy', chance: 100 }] } },
  'charm': { kind: 'status', data: { enemyStatChanges: [{ stat: 'attack', stages: -2, target: 'enemy', chance: 100 }] } },
  'fake-tears': { kind: 'status', data: { enemyStatChanges: [{ stat: 'spDefense', stages: -2, target: 'enemy', chance: 100 }] } },
  'feather-dance': { kind: 'status', data: { enemyStatChanges: [{ stat: 'attack', stages: -2, target: 'enemy', chance: 100 }] } },
  'scary-face': { kind: 'status', data: { enemyStatChanges: [{ stat: 'speed', stages: -2, target: 'enemy', chance: 100 }] } },
  'cotton-spore': { kind: 'status', data: { enemyStatChanges: [{ stat: 'speed', stages: -2, target: 'enemy', chance: 100 }] } },
  'tickle': { kind: 'status', data: { enemyStatChanges: [
    { stat: 'attack', stages: -1, target: 'enemy', chance: 100 },
    { stat: 'defense', stages: -1, target: 'enemy', chance: 100 },
  ] } },
  'confide': { kind: 'status', data: { enemyStatChanges: [{ stat: 'spAttack', stages: -1, target: 'enemy', chance: 100 }] } },
  'captivate': { kind: 'status', data: { enemyStatChanges: [{ stat: 'spAttack', stages: -2, target: 'enemy', chance: 100 }] } },
  'memento': { kind: 'status', data: { enemyStatChanges: [
    { stat: 'attack', stages: -2, target: 'enemy', chance: 100 },
    { stat: 'spAttack', stages: -2, target: 'enemy', chance: 100 },
  ] } },

  // ======== 恢复类技能 ========
  'recover': { kind: 'status', data: { healRatio: 0.5 } },
  'soft-boiled': { kind: 'status', data: { healRatio: 0.5 } },
  'milk-drink': { kind: 'status', data: { healRatio: 0.5 } },
  'slack-off': { kind: 'status', data: { healRatio: 0.5 } },
  'roost': { kind: 'status', data: { healRatio: 0.5 } },
  'synthesis': { kind: 'status', data: { healRatio: 0.5 } }, // weather-dependent in real games
  'moonlight': { kind: 'status', data: { healRatio: 0.5 } },
  'morning-sun': { kind: 'status', data: { healRatio: 0.5 } },
  'rest': { kind: 'status', data: { healRatio: 1 } }, // full heal + sleep status
  'refresh': { kind: 'status', data: { } }, // cures poison/burn/paralysis
  'heal-bell': { kind: 'status', data: { } }, // heals entire team status

  // ======== 吸取类技能 ========
  'absorb': { kind: 'drain', data: { ratio: 0.5 } },
  'mega-drain': { kind: 'drain', data: { ratio: 0.5 } },
  'giga-drain': { kind: 'drain', data: { ratio: 0.5 } },
  'drain-punch': { kind: 'drain', data: { ratio: 0.5 } },
  'draining-kiss': { kind: 'drain', data: { ratio: 0.75 } },
  'dream-eater': { kind: 'drain', data: { ratio: 0.5 } },
  'leech-life': { kind: 'drain', data: { ratio: 0.5 } },
  'horn-leech': { kind: 'drain', data: { ratio: 0.5 } },

  // ======== 反伤类技能 ========
  'take-down': { kind: 'recoil', data: { ratio: 0.25 } },
  'double-edge': { kind: 'recoil', data: { ratio: 0.33 } },
  'submission': { kind: 'recoil', data: { ratio: 0.25 } },
  'wild-charge': { kind: 'recoil', data: { ratio: 0.25 } },
  'flare-blitz': { kind: 'recoil', data: { ratio: 0.33 } },
  'head-charge': { kind: 'recoil', data: { ratio: 0.25 } },
  'head-smash': { kind: 'recoil', data: { ratio: 0.5 } },
  'brave-bird': { kind: 'recoil', data: { ratio: 0.33 } },
  'volt-tackle': { kind: 'recoil', data: { ratio: 0.33 } },

  // ======== 必中类技能 ========
  'swift': { kind: 'always-hit' },
  'aerial-ace': { kind: 'always-hit' },
  'shock-wave': { kind: 'always-hit' },
  'feint-attack': { kind: 'always-hit' },
  'faint-attack': { kind: 'always-hit' },
  'shadow-punch': { kind: 'always-hit' },
  'magnet-bomb': { kind: 'always-hit' },
  'magical-leaf': { kind: 'always-hit' },
  'disarming-voice': { kind: 'always-hit' },

  // ======== 需蓄力/需充能 ========
  'hyper-beam': { kind: 'recharge' },
  'giga-impact': { kind: 'recharge' },
  'solar-beam': { kind: 'two-turn' },
  'fly': { kind: 'two-turn' },
  'dig': { kind: 'two-turn' },
  'dive': { kind: 'two-turn' },
  'skull-bash': { kind: 'two-turn' },
  'razor-wind': { kind: 'two-turn' },
  'sky-attack': { kind: 'two-turn' },
  'focus-punch': { kind: 'two-turn' }, // must go first, if hit before attack, flinch

  // ======== 清除场地/状态 ========
  'haze': { kind: 'status', data: { } }, // resets all stat stages
  'defog': { kind: 'status', data: { } }, // clears hazards + lowers evasion

  // ======== 附加效果：自降能力（大招副作用） ========
  'leaf-storm': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'spAttack', stages: -2, target: 'self', chance: 100 }] } },
  'overheat': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'spAttack', stages: -2, target: 'self', chance: 100 }] } },
  'superpower': { kind: 'attack-secondary', data: { chance: 100, statChanges: [
    { stat: 'attack', stages: -1, target: 'self', chance: 100 },
    { stat: 'defense', stages: -1, target: 'self', chance: 100 },
  ] } },
  'close-combat': { kind: 'attack-secondary', data: { chance: 100, statChanges: [
    { stat: 'defense', stages: -1, target: 'self', chance: 100 },
    { stat: 'spDefense', stages: -1, target: 'self', chance: 100 },
  ] } },

  // ======== 多段攻击 ========
  'bullet-seed': { kind: 'multi-hit', data: { min: 2, max: 5 } },
  'fury-swipes': { kind: 'multi-hit', data: { min: 2, max: 5 } },
  'fury-attack': { kind: 'multi-hit', data: { min: 2, max: 5 } },
  'double-slap': { kind: 'multi-hit', data: { min: 2, max: 5 } },
  'comet-punch': { kind: 'multi-hit', data: { min: 2, max: 5 } },
  'spike-cannon': { kind: 'multi-hit', data: { min: 2, max: 5 } },
  'pin-missile': { kind: 'multi-hit', data: { min: 2, max: 5 } },
  'arm-thrust': { kind: 'multi-hit', data: { min: 2, max: 5 } },
  'barrage': { kind: 'multi-hit', data: { min: 2, max: 5 } },
  'tail-slap': { kind: 'multi-hit', data: { min: 2, max: 5 } },
  'rock-blast': { kind: 'multi-hit', data: { min: 2, max: 5 } },

  // ======== 火焰旋涡/陷阱类 ========
  'fire-spin': { kind: 'attack-secondary', data: { chance: 100, status: 'trap' } },
  'whirlpool': { kind: 'attack-secondary', data: { chance: 100, status: 'trap' } },
  'bind': { kind: 'attack-secondary', data: { chance: 100, status: 'trap' } },
  'sand-tomb': { kind: 'attack-secondary', data: { chance: 100, status: 'trap' } },
  'infestation': { kind: 'attack-secondary', data: { chance: 100, status: 'trap' } },
  'clamp': { kind: 'attack-secondary', data: { chance: 100, status: 'trap' } },

  // ======== 天气类 ========
  'sunny-day': { kind: 'status', data: { } },
  'rain-dance': { kind: 'status', data: { } },
  'sandstorm': { kind: 'status', data: { } },
  'hail': { kind: 'status', data: { } },

  // ======== 反射壁/光墙 ========
  'reflect': { kind: 'status', data: { } },
  'light-screen': { kind: 'status', data: { } },
  'safeguard': { kind: 'status', data: { } },

  // ======== 强制换人 ========
  'roar': { kind: 'status', data: { } },
  'whirlwind': { kind: 'status', data: { } },
  'dragon-tail': { kind: 'attack-secondary', data: { chance: 100, statChanges: [] } },

  // ======== 寄生种子 ========
  'leech-seed': { kind: 'status', data: { } },

  // ======== 替身 ========
  'substitute': { kind: 'status', data: { } },

  // ======== 自我暗示/黑雾（haze 已在清除场地段定义）=======
  // 'haze' 已在上方定义，此处跳过

  // ======== 守住/挺住 ========
  'protect': { kind: 'status', data: { } },
  'endure': { kind: 'status', data: { } },
  'detect': { kind: 'status', data: { } },

  // ======== 撒菱 ========
  'spikes': { kind: 'status', data: { } },
  'toxic-spikes': { kind: 'status', data: { } },
  'stealth-rock': { kind: 'status', data: { } },

  // ======== 挑衅/封锁 ========
  'taunt': { kind: 'status', data: { } },
  'torment': { kind: 'status', data: { } },
  'encore': { kind: 'status', data: { } },
  'disable': { kind: 'status', data: { } },
  'imprison': { kind: 'status', data: { } },

  // ======== 换场类 ========
  'u-turn': { kind: 'attack-secondary', data: { chance: 100, statChanges: [] } },
  'volt-switch': { kind: 'attack-secondary', data: { chance: 100, statChanges: [] } },
  'baton-pass': { kind: 'status', data: { } },

  // ======== 能力变化补充 ========
  'belly-drum': { kind: 'status', data: { selfStatChanges: [{ stat: 'attack', stages: 6, target: 'self', chance: 100 }] } },

  // ======== 三攻击（烧伤/冰冻/麻痹各 1/3 概率） ========
  'tri-attack': { kind: 'attack-secondary', data: { chance: 20, status: 'tri-status' } },

  // ======== 真气弹：10% 降特防 ========
  'focus-blast': { kind: 'attack-secondary', data: { chance: 10, statChanges: [{ stat: 'spDefense', stages: -1, target: 'enemy', chance: 100 }] } },

  // ======== 爆裂拳：必定混乱 ========
  'dynamic-punch': { kind: 'attack-secondary', data: { chance: 100, status: 'confuse' } },

  // ======== 新增招式效果（第三世代补齐） ========
  'bug-buzz': { kind: 'attack-secondary', data: { chance: 10, statChanges: [{ stat: 'spDefense', stages: -1, target: 'enemy', chance: 100 }] } },
  'discharge': { kind: 'attack-secondary', data: { chance: 30, status: 'paralysis' } },
  'extrasensory': { kind: 'attack-secondary', data: { chance: 10, status: 'flinch' } },
  'hammer-arm': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'speed', stages: -1, target: 'self', chance: 100 }] } },
  'mud-bomb': { kind: 'attack-secondary', data: { chance: 30, statChanges: [{ stat: 'accuracy', stages: -1, target: 'enemy', chance: 100 }] } },
  'silver-wind': { kind: 'attack-secondary', data: { chance: 10, statChanges: [
    { stat: 'attack', stages: 1, target: 'self', chance: 100 },
    { stat: 'defense', stages: 1, target: 'self', chance: 100 },
    { stat: 'spAttack', stages: 1, target: 'self', chance: 100 },
    { stat: 'spDefense', stages: 1, target: 'self', chance: 100 },
    { stat: 'speed', stages: 1, target: 'self', chance: 100 },
  ] } },
  'thunder-fang': { kind: 'attack-secondary', data: { chance: 10, status: 'paralysis' } },
  'wrap': { kind: 'attack-secondary', data: { chance: 100, status: 'trap' } },
  'psychic-fangs': { kind: 'attack-secondary', data: { chance: 100, statChanges: [] } },
  'rapid-spin': { kind: 'attack-secondary', data: { chance: 100, statChanges: [{ stat: 'speed', stages: 1, target: 'self', chance: 100 }] } },

  // ======== 变化招式补齐 ========
  'mean-look': { kind: 'status', data: { } },
  'ingrain': { kind: 'status', data: { } },
  'perish-song': { kind: 'status', data: { } },
  'eerie-impulse': { kind: 'status', data: { enemyStatChanges: [{ stat: 'spAttack', stages: -2, target: 'enemy', chance: 100 }] } },
  'sweet-kiss': { kind: 'status', data: { confuse: true } },
  'heal-pulse': { kind: 'status', data: { } },
  'wish': { kind: 'status', data: { } },
  'aqua-ring': { kind: 'status', data: { } },
  'magnet-rise': { kind: 'status', data: { } },
  'destiny-bond': { kind: 'status', data: { } },
  'embargo': { kind: 'status', data: { } },
  'magic-room': { kind: 'status', data: { } },
  'water-sport': { kind: 'status', data: { } },
  'wide-guard': { kind: 'status', data: { } },
  'stockpile': { kind: 'status', data: { selfStatChanges: [
    { stat: 'defense', stages: 1, target: 'self', chance: 100 },
    { stat: 'spDefense', stages: 1, target: 'self', chance: 100 },
  ] } },
  'swallow': { kind: 'status', data: { healRatio: 0.25 } },
  'spit-up': { kind: 'attack-secondary', data: { chance: 100, statChanges: [] } },
  'charge': { kind: 'status', data: { selfStatChanges: [{ stat: 'spDefense', stages: 1, target: 'self', chance: 100 }] } },
}

/**
 * 判断技能是否为多段攻击
 */
export function isMultiHitMove(name: string): boolean {
  const effect = MOVE_EFFECTS[name]
  return effect?.kind === 'multi-hit'
}

export function hasMoveEffect(name: string): boolean {
  return name in MOVE_EFFECTS
}

/**
 * 获取技能效果（若未定义返回 undefined）
 */
export function getMoveEffect(name: string): MoveEffect | undefined {
  return MOVE_EFFECTS[name]
}
