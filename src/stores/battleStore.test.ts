import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { battleStore } from './battleStore'
import { Type } from '../game/data/types'
import type { RecombinedPokemon, Move, Ability, Stats, StatStages } from '../game/data/types'

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
  nameZh: string
  baseStats: Stats
  currentHp: number
  maxHp: number
}): RecombinedPokemon {
  const tackle = makeMove('tackle', '撞击', Type.Normal, 'physical', 40, 100)
  return {
    id: opts.id,
    dexId: opts.dexId,
    name: opts.id,
    nameZh: opts.nameZh,
    baseStats: opts.baseStats,
    types: [Type.Normal, null],
    ability: makeAbility('run-away', '逃跑'),
    moves: [tackle, tackle, tackle, tackle],
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

const fragileStats: Stats = { hp: 1, attack: 50, defense: 1, spAttack: 50, spDefense: 1, speed: 1 }
const healthyStats: Stats = { hp: 200, attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 120 }
const bossStats: Stats = { hp: 300, attack: 200, defense: 150, spAttack: 200, spDefense: 150, speed: 200 }

/**
 * UI 死局不变式：战斗仍在进行时，绝不允许「在场宝可梦已倒下」却「不要求换人」。
 * 该组合会让 Battle.svelte 的三个面板（招式菜单 / 换人面板 / 结算面板）同时不可用。
 */
function expectNoDeadlock() {
  const s = get(battleStore)
  const stuck = s.result === 'playing' && !s.needsPlayerSwitch && s.playerActive?.fainted === true
  expect(stuck, 'UI 死局：result=playing 且 needsPlayerSwitch=false 但在场宝可梦已倒下').toBe(false)
}

describe('T15 battleStore：玩家倒下 → 换人 → 继续，不得产生 UI 死局', () => {
  beforeEach(() => battleStore.reset())

  it('普通强制换人：store 正确清标记并保持 playing', () => {
    const active = makePokemon({ id: 'p1', dexId: 1, nameZh: '脆皮', baseStats: fragileStats, currentHp: 1, maxHp: 1 })
    const backup = makePokemon({ id: 'p2', dexId: 2, nameZh: '替补', baseStats: healthyStats, currentHp: 200, maxHp: 200 })
    const enemy = makePokemon({ id: 'e1', dexId: 3, nameZh: '强敌', baseStats: bossStats, currentHp: 300, maxHp: 300 })

    battleStore.initBattle([active, backup], [enemy], 20240115)
    battleStore.executeTurn(0)

    expect(get(battleStore).needsPlayerSwitch).toBe(true)
    expect(get(battleStore).result).toBe('playing')
    expectNoDeadlock()

    battleStore.switchPokemon(1)
    const s = get(battleStore)
    expect(s.needsPlayerSwitch).toBe(false)
    expect(s.result).toBe('playing')
    expect(s.playerActive.nameZh).toBe('替补')
    expect(s.playerActive.fainted).toBe(false)
    expectNoDeadlock()
  })

  it('替补被入场陷阱当场击倒（队里还有人）：store 必须继续要求换人', () => {
    const active = makePokemon({ id: 'p1', dexId: 1, nameZh: '脆皮', baseStats: fragileStats, currentHp: 1, maxHp: 1 })
    const backup = makePokemon({ id: 'p2', dexId: 2, nameZh: '残血替补', baseStats: healthyStats, currentHp: 5, maxHp: 80 })
    const third = makePokemon({ id: 'p3', dexId: 4, nameZh: '第三只', baseStats: healthyStats, currentHp: 200, maxHp: 200 })
    const enemy = makePokemon({ id: 'e1', dexId: 3, nameZh: '强敌', baseStats: bossStats, currentHp: 300, maxHp: 300 })

    battleStore.initBattle([active, backup, third], [enemy], 20240115)
    get(battleStore).engine!.playerHazards.stealthRock = true

    battleStore.executeTurn(0)
    expect(get(battleStore).needsPlayerSwitch).toBe(true)

    battleStore.switchPokemon(1)
    expect(backup.fainted).toBe(true)

    const s = get(battleStore)
    expect(s.result).toBe('playing')
    expect(s.needsPlayerSwitch).toBe(true)
    expectNoDeadlock()

    // 再换第三只应能正常收尾
    battleStore.switchPokemon(2)
    const s2 = get(battleStore)
    expect(s2.needsPlayerSwitch).toBe(false)
    expect(s2.playerActive.nameZh).toBe('第三只')
    expectNoDeadlock()
  })

  it('最后一只替补被入场陷阱击倒：store 必须结算败北（而不是停在 playing）', () => {
    const active = makePokemon({ id: 'p1', dexId: 1, nameZh: '脆皮', baseStats: fragileStats, currentHp: 1, maxHp: 1 })
    const backup = makePokemon({ id: 'p2', dexId: 2, nameZh: '残血替补', baseStats: healthyStats, currentHp: 5, maxHp: 80 })
    const enemy = makePokemon({ id: 'e1', dexId: 3, nameZh: '强敌', baseStats: bossStats, currentHp: 300, maxHp: 300 })

    battleStore.initBattle([active, backup], [enemy], 20240115)
    get(battleStore).engine!.playerHazards.stealthRock = true

    battleStore.executeTurn(0)
    battleStore.switchPokemon(1)

    const s = get(battleStore)
    expect(backup.fainted).toBe(true)
    expect(s.result).toBe('enemy_win')
    expect(s.needsPlayerSwitch).toBe(false)
    expectNoDeadlock()
  })
})
