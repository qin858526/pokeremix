// ==================== 属性枚举 ====================

export enum Type {
  Normal = 'normal',
  Fire = 'fire',
  Water = 'water',
  Electric = 'electric',
  Grass = 'grass',
  Ice = 'ice',
  Fighting = 'fighting',
  Poison = 'poison',
  Ground = 'ground',
  Flying = 'flying',
  Psychic = 'psychic',
  Bug = 'bug',
  Rock = 'rock',
  Ghost = 'ghost',
  Dragon = 'dragon',
  Dark = 'dark',
  Steel = 'steel',
  Fairy = 'fairy',
}

export const ALL_TYPES: Type[] = Object.values(Type)

export const TYPE_COLORS: Record<Type, string> = {
  [Type.Normal]: '#a8a878',
  [Type.Fire]: '#f08030',
  [Type.Water]: '#6890f0',
  [Type.Electric]: '#f8d030',
  [Type.Grass]: '#78c850',
  [Type.Ice]: '#98d8d8',
  [Type.Fighting]: '#c03028',
  [Type.Poison]: '#a040a0',
  [Type.Ground]: '#e0c068',
  [Type.Flying]: '#a890f0',
  [Type.Psychic]: '#f85888',
  [Type.Bug]: '#a8b820',
  [Type.Rock]: '#b8a038',
  [Type.Ghost]: '#705898',
  [Type.Dragon]: '#7038f8',
  [Type.Dark]: '#705848',
  [Type.Steel]: '#b8b8d0',
  [Type.Fairy]: '#ee99ac',
}

// ==================== 基础数据类型 ====================

export interface Stats {
  hp: number
  attack: number
  defense: number
  spAttack: number
  spDefense: number
  speed: number
}

export function createStats(hp: number, atk: number, def: number, spa: number, spd: number, spe: number): Stats {
  return { hp, attack: atk, defense: def, spAttack: spa, spDefense: spd, speed: spe }
}

export function maxHpFromStats(stats: Stats, level = 50): number {
  return Math.floor(((2 * stats.hp + 31 + 0) * level) / 100 + level + 10)
}

export function otherStatFromStats(stat: number, level = 50): number {
  return Math.floor(((2 * stat + 31 + 0) * level) / 100 + 5)
}

// ==================== 技能 ====================

export interface Move {
  id: number
  name: string
  nameZh: string
  type: Type
  category: 'physical' | 'special' | 'status'
  power: number
  accuracy: number
  pp: number
  currentPp: number
  priority: number
  description: string
}

// ==================== 特性 ====================

export interface Ability {
  id: number
  name: string
  nameZh: string
  description: string
}

// ==================== 宝可梦实例 ====================

export interface RecombinedPokemon {
  id: string
  dexId: number
  name: string
  nameZh: string
  baseStats: Stats
  types: [Type, Type | null]
  ability: Ability
  moves: [Move, Move, Move, Move]
  currentHp: number
  maxHp: number
  status: StatusCondition | null
  statusTurns?: number
  statStages: StatStages
  fainted: boolean
  /** 混乱持续回合数（含当前回合） */
  confuseTurns?: number
  /** 特性内部状态数据 */
  _abilityData?: Record<string, any>
}

export type StatusCondition = 'paralysis' | 'burn' | 'sleep' | 'freeze' | 'poison' | 'bad_poison'

export interface StatStages {
  attack: number
  defense: number
  spAttack: number
  spDefense: number
  speed: number
  accuracy: number
  evasion: number
}

export function defaultStatStages(): StatStages {
  return { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 }
}

// ==================== 战斗 ====================

export type BattlePhase =
  | 'choose_action'
  | 'animating'
  | 'fainted_check'
  | 'victory'
  | 'defeat'

export interface BattleLogEntry {
  turn: number
  message: string
  type: 'damage' | 'status' | 'heal' | 'fail' | 'effect'
  triggerSource?: 'ability' | 'weather' | 'move' | 'item'
  triggerSide?: 'player' | 'enemy'
  actionSide?: 'player' | 'enemy'
}

// ==================== 游戏流程 ====================

export type GamePhase =
  | 'title'
  | 'team_select'
  | 'battle'
  | 'reward_exchange'
  | 'reward_modify'
  | 'victory'
  | 'game_over'
  | 'simulator_setup'
  | 'simulator_battle'

export interface RunState {
  floor: number
  maxFloors: number
  bossFloors: number[]
  team: RecombinedPokemon[]
  faintedThisBattle: string[]
  seed: number
}

export interface SwapRecord {
  floor: number
  given: string
  received: string
}

export interface ModifyRecord {
  floor: number
  targetId: string
  type: 'ability' | 'move' | 'type'
  oldValue: string
  newValue: string
}
