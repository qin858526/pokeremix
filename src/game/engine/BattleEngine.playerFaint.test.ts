import { describe, it, expect } from 'vitest'
import { BattleEngine } from './BattleEngine'
import { Type } from '../data/types'
import type { RecombinedPokemon, Move, Ability, Stats, StatStages } from '../data/types'

function makeAbility(name: string, nameZh: string): Ability {
  return { id: 0, name, nameZh, description: '' }
}

function makeMove(
  name: string,
  nameZh: string,
  type: Type,
  category: 'physical' | 'special' | 'status',
  power: number,
  accuracy: number,
): Move {
  return { id: 0, name, nameZh, type, category, power, accuracy, pp: 99, currentPp: 99, priority: 0, description: '' }
}

const neutralStages: StatStages = {
  attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0,
}

function makePokemon(opts: {
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
}): RecombinedPokemon {
  return {
    id: opts.id,
    dexId: opts.dexId,
    name: opts.name,
    nameZh: opts.nameZh,
    baseStats: opts.baseStats,
    types: opts.types,
    ability: opts.ability,
    moves: opts.moves,
    currentHp: opts.currentHp,
    maxHp: opts.maxHp,
    status: null,
    statStages: { ...neutralStages },
    fainted: false,
    weightKg: 0,
    gender: 'male',
    _abilityData: {},
  }
}

const tackle = makeMove('tackle', '撞击', Type.Normal, 'physical', 40, 100)

/** 玩家在场那只：很脆很慢，必被秒 */
function makeFragilePlayer(): RecombinedPokemon {
  return makePokemon({
    id: 'p1', dexId: 1, name: 'weak', nameZh: '脆皮',
    baseStats: { hp: 1, attack: 50, defense: 1, spAttack: 50, spDefense: 1, speed: 1 },
    types: [Type.Normal, null],
    ability: makeAbility('run-away', '逃跑'),
    moves: [tackle, tackle, tackle, tackle],
    currentHp: 1, maxHp: 1,
  })
}

/** 玩家替补：健康 */
function makeHealthyBackup(): RecombinedPokemon {
  return makePokemon({
    id: 'p2', dexId: 2, name: 'backup', nameZh: '替补',
    baseStats: { hp: 200, attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 120 },
    types: [Type.Normal, null],
    ability: makeAbility('run-away', '逃跑'),
    moves: [tackle, tackle, tackle, tackle],
    currentHp: 200, maxHp: 200,
  })
}

/** 敌方：强力且快，一击必杀在场脆皮 */
function makeStrongEnemy(): RecombinedPokemon {
  return makePokemon({
    id: 'e1', dexId: 258, name: 'boss', nameZh: '强敌',
    baseStats: { hp: 300, attack: 200, defense: 150, spAttack: 200, spDefense: 150, speed: 200 },
    types: [Type.Normal, null],
    ability: makeAbility('run-away', '逃跑'),
    moves: [tackle, tackle, tackle, tackle],
    currentHp: 300, maxHp: 300,
  })
}

describe('T15 玩家宝可梦倒下 → 强制换人 → 继续（引擎集成链）', () => {
  it('A: 完整链路 a-d 均成立', () => {
    const player = makeFragilePlayer()
    const backup = makeHealthyBackup()
    const enemy = makeStrongEnemy()

    const engine = new BattleEngine([player, backup], [enemy], 20240115)
    const enemyAction = engine.enemyAction()
    const events = engine.executeTurn({ type: 'move', moveIndex: 0 }, enemyAction)

    // 在场脆皮已倒下
    expect(player.fainted).toBe(true)
    // (a) 需要玩家换人
    expect(engine.needsPlayerSwitch).toBe(true)
    // 此时战斗未结束（还有替补）
    expect(engine.checkBattleEnd()).toBeNull()
    // 应产出了事件（含倒下提示）
    expect(events.length).toBeGreaterThan(0)
    expect(events.some(e => e.message.includes('倒下了'))).toBe(true)

    // (b) 强制换人成功
    const ok = engine.switchPlayer(1, [])
    expect(ok).toBe(true)
    // (c) 换人后不再需要换人，且未误判战斗结束
    expect(engine.needsPlayerSwitch).toBe(false)
    expect(engine.checkBattleEnd()).toBeNull()
    expect(engine.playerActive.nameZh).toBe('替补')
    expect(engine.playerActive.fainted).toBe(false)

    // (d) 之后能正常继续一个回合，不抛异常、能产出事件
    const enemyAction2 = engine.enemyAction()
    let events2: ReturnType<typeof engine.executeTurn> = []
    expect(() => { events2 = engine.executeTurn({ type: 'move', moveIndex: 0 }, enemyAction2) }).not.toThrow()
    expect(events2.length).toBeGreaterThan(0)
  })

  it('B-1: 替补被入场陷阱当场击倒 → 仍需玩家再次换人（不得留下「倒下却无面板」的死局）', () => {
    const player = makeFragilePlayer()
    // 替补残血：会被隐形岩（maxHp/8 = 10）直接击倒
    const backup = makePokemon({
      id: 'p2', dexId: 2, name: 'backup', nameZh: '残血替补',
      baseStats: { hp: 80, attack: 80, defense: 80, spAttack: 80, spDefense: 80, speed: 80 },
      types: [Type.Normal, null],
      ability: makeAbility('run-away', '逃跑'),
      moves: [tackle, tackle, tackle, tackle],
      currentHp: 5, maxHp: 80,
    })
    const third = makeHealthyBackup()
    third.id = 'p3'
    const enemy = makeStrongEnemy()

    const engine = new BattleEngine([player, backup, third], [enemy], 20240115)
    // 玩家侧已被布下隐形岩
    engine.playerHazards.stealthRock = true

    engine.executeTurn({ type: 'move', moveIndex: 0 }, engine.enemyAction())
    expect(player.fainted).toBe(true)
    expect(engine.needsPlayerSwitch).toBe(true)

    // 换上残血替补 → 被隐形岩当场击倒
    const ok = engine.switchPlayer(1, [])
    expect(ok).toBe(true)
    expect(backup.fainted).toBe(true)

    // 队伍里还有第三只 → 战斗未结束
    expect(engine.checkBattleEnd()).toBeNull()
    // 关键断言：在场宝可梦已倒下且战斗未结束时，必须仍要求玩家换人
    expect(engine.needsPlayerSwitch).toBe(true)
  })

  it('B-2: 最后一只替补被入场陷阱击倒 → 应判败北', () => {
    const player = makeFragilePlayer()
    const backup = makePokemon({
      id: 'p2', dexId: 2, name: 'backup', nameZh: '残血替补',
      baseStats: { hp: 80, attack: 80, defense: 80, spAttack: 80, spDefense: 80, speed: 80 },
      types: [Type.Normal, null],
      ability: makeAbility('run-away', '逃跑'),
      moves: [tackle, tackle, tackle, tackle],
      currentHp: 5, maxHp: 80,
    })
    const enemy = makeStrongEnemy()

    const engine = new BattleEngine([player, backup], [enemy], 20240115)
    engine.playerHazards.stealthRock = true

    engine.executeTurn({ type: 'move', moveIndex: 0 }, engine.enemyAction())
    expect(engine.needsPlayerSwitch).toBe(true)

    engine.switchPlayer(1, [])
    expect(backup.fainted).toBe(true)
    // 整队覆灭 → 必须能结算败北
    expect(engine.checkBattleEnd()).toBe('enemy_win')
    // 已经结算，不应再要求换人（否则 UI 会同时弹面板与结算）
    expect(engine.needsPlayerSwitch).toBe(false)
  })

  it('B: 整队被击败时应结算败北（needsPlayerSwitch 不应成为死路）', () => {
    const player = makeFragilePlayer()
    const enemy = makeStrongEnemy()

    // 只有一只，倒下即全队覆灭
    const engine = new BattleEngine([player], [enemy], 20240115)
    const enemyAction = engine.enemyAction()
    engine.executeTurn({ type: 'move', moveIndex: 0 }, enemyAction)

    expect(player.fainted).toBe(true)
    // 整队覆灭 → 应判败北，而不是卡在等待换人
    expect(engine.checkBattleEnd()).toBe('enemy_win')
  })
})
