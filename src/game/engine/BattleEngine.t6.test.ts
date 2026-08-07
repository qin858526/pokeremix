import { describe, it, expect } from 'vitest'
import { BattleEngine } from './BattleEngine'
import { calculateDamage } from './DamageCalc'
import { Type } from '../data/types'
import type { RecombinedPokemon, Move, Ability, Stats, StatStages } from '../data/types'

function makeAbility(name: string, nameZh: string): Ability {
  return { id: 0, name, nameZh, description: '' }
}
function makeMove(
  name: string, nameZh: string, type: Type,
  category: 'physical' | 'special' | 'status', power: number, accuracy: number,
): Move {
  return { id: 0, name, nameZh, type, category, power, accuracy, pp: 99, currentPp: 99, priority: 0, description: '' }
}
const neutralStages: StatStages = {
  attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0,
}
function makePokemon(opts: {
  ability: Ability; types: [Type, Type | null];
  move: Move; nameZh?: string; def?: number; spDef?: number; status?: any;
}): RecombinedPokemon {
  const stats: Stats = {
    hp: 200, attack: 100, defense: opts.def ?? 100,
    spAttack: 100, spDefense: opts.spDef ?? 100, speed: 100,
  }
  return {
    id: 'x', dexId: 1, name: 'x', nameZh: opts.nameZh ?? 'x',
    baseStats: stats, types: opts.types, ability: opts.ability,
    moves: [opts.move, opts.move, opts.move, opts.move],
    currentHp: 200, maxHp: 200, status: opts.status ?? null,
    statStages: { ...neutralStages }, fainted: false, _abilityData: {},
  }
}

/** _abilityData 是可选字段，测试统一走此访问器保持类型干净 */
function ad(pkm: RecombinedPokemon): Record<string, any> {
  pkm._abilityData ??= {}
  return pkm._abilityData
}

const phys = makeMove('tackle', '撞击', Type.Normal, 'physical', 60, 100)
const darkMove = makeMove('bite', '咬住', Type.Dark, 'physical', 60, 100)
const bugMove = makeMove('bug-bite', '虫咬', Type.Bug, 'physical', 60, 100)
const none = makeAbility('none', '无')

function engineWith(pAbility: Ability, eAbility: Ability) {
  const p = makePokemon({ ability: pAbility, types: [Type.Normal, null], move: phys, nameZh: '我方' })
  const e = makePokemon({ ability: eAbility, types: [Type.Normal, null], move: phys, nameZh: '敌方' })
  return { engine: new BattleEngine([p], [e], 42) as any, p, e }
}

describe('T6：能力等级变化类', () => {
  it('唱反调：提升变降低、降低变提升', () => {
    const { engine, p } = engineWith(makeAbility('contrary', '唱反调'), none)
    engine.raiseStat(p, 'attack', 2)
    expect(p.statStages.attack).toBe(-2)
    p.statStages.defense = 0
    engine.lowerStat(p, 'defense', 1)
    expect(p.statStages.defense).toBe(1)
  })

  it('单纯：能力变化翻倍', () => {
    const { engine, p } = engineWith(makeAbility('simple', '单纯'), none)
    engine.raiseStat(p, 'attack', 1)
    expect(p.statStages.attack).toBe(2)
    engine.lowerStat(p, 'speed', 1)
    expect(p.statStages.speed).toBe(-2)
  })

  it('健壮胸肌：防御不会被降低（其它能力照常降低）', () => {
    const { engine, p } = engineWith(makeAbility('big-pecks', '健壮胸肌'), none)
    engine.lowerStat(p, 'defense', 2)
    expect(p.statStages.defense).toBe(0)
    engine.lowerStat(p, 'attack', 2)
    expect(p.statStages.attack).toBe(-2)
  })
})

describe('T6：入场特性', () => {
  it('复制：入场复制对方特性', () => {
    const { engine, p } = engineWith(makeAbility('trace', '复制'), makeAbility('levitate', '飘浮'))
    const msg = engine.applyOnSwitchAbility(p, false)
    expect(p.ability.name).toBe('levitate')
    expect(msg).toContain('复制')
  })

  it('下载：对方特防更高则提升特攻', () => {
    const p = makePokemon({ ability: makeAbility('download', '下载'), types: [Type.Normal, null], move: phys })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, def: 50, spDef: 150 })
    const engine = new BattleEngine([p], [e], 42) as any
    engine.applyOnSwitchAbility(p, false)
    expect(p.statStages.spAttack).toBe(1)
    expect(p.statStages.attack).toBe(0)
  })

  it('下载：对方防御更高则提升攻击', () => {
    const p = makePokemon({ ability: makeAbility('download', '下载'), types: [Type.Normal, null], move: phys })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, def: 150, spDef: 50 })
    const engine = new BattleEngine([p], [e], 42) as any
    engine.applyOnSwitchAbility(p, false)
    expect(p.statStages.attack).toBe(1)
    expect(p.statStages.spAttack).toBe(0)
  })

  it('预知梦：提示对方威力最高的招式', () => {
    const p = makePokemon({ ability: makeAbility('forewarn', '预知梦'), types: [Type.Normal, null], move: phys })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: phys })
    // 刻意只给 2 招（预知梦需遍历不定长招式表）；moves 的静态类型是 4 元组，此处仅做类型放宽
    e.moves = [phys, makeMove('hyper-beam', '破坏光线', Type.Normal, 'special', 150, 90)] as unknown as RecombinedPokemon['moves']
    const engine = new BattleEngine([p], [e], 42) as any
    const msg = engine.applyOnSwitchAbility(p, false)
    expect(msg).toContain('破坏光线')
  })
})

describe('T6：伤害与受击反应', () => {
  it('强行：非变化招式威力 ×1.3', () => {
    const orig = Math.random; Math.random = () => 0.5
    try {
      const plain = makePokemon({ ability: none, types: [Type.Normal, null], move: phys })
      const sf = makePokemon({ ability: makeAbility('sheer-force', '强行'), types: [Type.Normal, null], move: phys })
      const def = makePokemon({ ability: none, types: [Type.Normal, null], move: phys })
      const rng = () => 0.5
      const a = calculateDamage(plain, def, phys, 'none', rng).damage
      const b = calculateDamage(sf, def, phys, 'none', rng).damage
      expect(b).toBeGreaterThan(a)
      expect(b).toBeLessThanOrEqual(Math.floor(a * 1.3) + 1)
    } finally { Math.random = orig }
  })

  it('愤怒穴位：被会心一击后攻击拉满到 +6', () => {
    const { engine, e } = engineWith(none, makeAbility('anger-point', '愤怒穴位'))
    const events: any[] = []
    engine.applyDefenderHitAbilities(e, phys, events, true, true)
    expect(e.statStages.attack).toBe(6)
  })

  it('正义之心：被恶系招式命中攻击 +1', () => {
    const { engine, e } = engineWith(none, makeAbility('justified', '正义之心'))
    const events: any[] = []
    engine.applyDefenderHitAbilities(e, darkMove, events, true, false)
    expect(e.statStages.attack).toBe(1)
    // 非恶系不触发
    engine.applyDefenderHitAbilities(e, phys, events, true, false)
    expect(e.statStages.attack).toBe(1)
  })

  it('碎裂铠甲：受物理攻击防御 -1、速度 +1', () => {
    const { engine, e } = engineWith(none, makeAbility('weak-armor', '碎裂铠甲'))
    const events: any[] = []
    engine.applyDefenderHitAbilities(e, phys, events, true, false)
    expect(e.statStages.defense).toBe(-1)
    expect(e.statStages.speed).toBe(1)
  })

  it('胆怯：被虫/恶/幽灵系命中速度 +1', () => {
    const { engine, e } = engineWith(none, makeAbility('rattled', '胆怯'))
    const events: any[] = []
    engine.applyDefenderHitAbilities(e, bugMove, events, true, false)
    expect(e.statStages.speed).toBe(1)
  })
})

describe('T6：天气联动与状态免疫', () => {
  it('太阳之力：晴天回合末损失 1/8 最大 HP', () => {
    const { engine, p } = engineWith(makeAbility('solar-power', '太阳之力'), none)
    engine.weather = 'sun'
    const events: any[] = []
    engine.applyEndOfTurnField(events)
    expect(p.currentHp).toBe(200 - 25)
  })

  it('湿润之躯：雨天回合末治愈异常状态', () => {
    const { engine, p } = engineWith(makeAbility('hydration', '湿润之躯'), none)
    p.status = 'burn'
    engine.weather = 'rain'
    const events: any[] = []
    engine.applyEndOfTurnField(events)
    expect(p.status).toBeNull()
  })

  it('叶子防守：晴天免疫异常状态', () => {
    const { engine, p } = engineWith(makeAbility('leaf-guard', '叶子防守'), none)
    engine.weather = 'sun'
    const events: any[] = []
    expect(engine.inflictStatus(p, 'burn', events)).toBe(false)
    expect(p.status).toBeNull()
    // 非晴天正常中招
    engine.weather = 'none'
    expect(engine.inflictStatus(p, 'burn', events)).toBe(true)
  })
})

describe('T6：换人封锁与命中判定', () => {
  it('踩影：对方无法换人', () => {
    const p1 = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: 'A' })
    const p2 = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: 'B' })
    const e = makePokemon({ ability: makeAbility('shadow-tag', '踩影'), types: [Type.Normal, null], move: phys })
    const engine = new BattleEngine([p1, p2], [e], 42) as any
    const events: any[] = []
    expect(engine.switchPlayer(1, events)).toBe(false)
    expect(events[0].message).toContain('踩影')
  })

  it('沙穴：地面系（非飞行/飘浮）无法换人，飞行系可换', () => {
    const ground = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: 'A' })
    const bench = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: 'B' })
    const e = makePokemon({ ability: makeAbility('arena-trap', '沙穴'), types: [Type.Normal, null], move: phys })
    const engine = new BattleEngine([ground, bench], [e], 42) as any
    expect(engine.switchPlayer(1, [])).toBe(false)

    const flyer = makePokemon({ ability: none, types: [Type.Flying, null], move: phys, nameZh: 'F' })
    const engine2 = new BattleEngine([flyer, bench], [e], 42) as any
    expect(engine2.switchPlayer(1, [])).toBe(true)
  })

  it('磁力：钢系无法换人', () => {
    const steel = makePokemon({ ability: none, types: [Type.Steel, null], move: phys, nameZh: 'S' })
    const bench = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: 'B' })
    const e = makePokemon({ ability: makeAbility('magnet-pull', '磁力'), types: [Type.Normal, null], move: phys })
    const engine = new BattleEngine([steel, bench], [e], 42) as any
    expect(engine.switchPlayer(1, [])).toBe(false)
  })

  it('胆量：普通系招式可命中幽灵系', () => {
    const scrappy = makePokemon({ ability: makeAbility('scrappy', '胆量'), types: [Type.Normal, null], move: phys })
    const plain = makePokemon({ ability: none, types: [Type.Normal, null], move: phys })
    const ghost = makePokemon({ ability: none, types: [Type.Ghost, null], move: phys })
    const engine = new BattleEngine([scrappy], [ghost], 42) as any
    expect(engine.isImmuneToMove(phys, ghost, plain)).toBe(true)
    expect(engine.isImmuneToMove(phys, ghost, scrappy)).toBe(false)
  })
})

describe('T7：束缚类招式（火焰旋涡/绑紧等 7 招共用机制）', () => {
  const fireSpin = makeMove('fire-spin', '火焰旋涡', Type.Fire, 'special', 35, 85)

  function trapEngine() {
    const p1 = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: 'A' })
    const p2 = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: 'B' })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: fireSpin, nameZh: '敌方' })
    return { engine: new BattleEngine([p1, p2], [e], 42) as any, p1, p2, e }
  }

  it('命中后施加束缚标记（4~5 回合）', () => {
    const { engine, p1, e } = trapEngine()
    const events: any[] = []
    const effect = { kind: 'attack-secondary', data: { chance: 100, status: 'trap' } } as any
    engine.applyAttackSecondaryEffect(e, p1, fireSpin, effect, events)
    expect(ad(p1).trapTurns).toBeGreaterThanOrEqual(4)
    expect(ad(p1).trapTurns).toBeLessThanOrEqual(5)
    expect(events.some((ev: any) => ev.message.includes('火焰旋涡'))).toBe(true)
  })

  it('被束缚时无法换人', () => {
    const { engine, p1 } = trapEngine()
    ad(p1).trapTurns = 4
    ad(p1).trapMoveZh = '火焰旋涡'
    const events: any[] = []
    expect(engine.switchPlayer(1, events)).toBe(false)
    expect(events[0].message).toContain('无法替换')
  })

  it('回合末扣 1/8 最大 HP 并递减回合数', () => {
    const { engine, p1 } = trapEngine()
    ad(p1).trapTurns = 2
    ad(p1).trapMoveZh = '火焰旋涡'
    const events: any[] = []
    engine.applyEndOfTurnField(events)
    expect(p1.currentHp).toBe(200 - 25)
    expect(ad(p1).trapTurns).toBe(1)
  })

  it('回合数耗尽后解除束缚', () => {
    const { engine, p1 } = trapEngine()
    ad(p1).trapTurns = 1
    ad(p1).trapMoveZh = '火焰旋涡'
    const events: any[] = []
    engine.applyEndOfTurnField(events)
    expect(ad(p1).trapTurns).toBe(0)
    expect(events.some((ev: any) => ev.message.includes('摆脱'))).toBe(true)
    // 解除后可正常换人
    expect(engine.switchPlayer(1, [])).toBe(true)
  })

  it('施加束缚方离场后束缚解除', () => {
    const { engine, p1, e } = trapEngine()
    ad(p1).trapTurns = 4
    engine.applyOnSwitchOutAbility(e)
    expect(ad(p1).trapTurns).toBe(0)
  })
})

describe('T8：强制换人（吼叫/吹飞/龙尾）', () => {
  const roar = makeMove('roar', '吼叫', Type.Normal, 'status', 0, 100)

  function forceEngine(targetAbility = none) {
    const p = makePokemon({ ability: none, types: [Type.Normal, null], move: roar, nameZh: '我方' })
    const e1 = makePokemon({ ability: targetAbility, types: [Type.Normal, null], move: phys, nameZh: '敌1' })
    const e2 = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: '敌2' })
    return { engine: new BattleEngine([p], [e1, e2], 42) as any, p, e1, e2 }
  }

  it('吼叫把对手换成替补', () => {
    const { engine, e1, e2 } = forceEngine()
    const events: any[] = []
    expect(engine.forceSwitchOut(e1, events, '吼叫')).toBe(true)
    expect(engine.enemyActive).toBe(e2)
    expect(events.some((ev: any) => ev.message.includes('吹飞'))).toBe(true)
  })

  it('吸盘挡下强制换人', () => {
    const { engine, e1 } = forceEngine(makeAbility('suction-cups', '吸盘'))
    const events: any[] = []
    expect(engine.forceSwitchOut(e1, events, '吼叫')).toBe(false)
    expect(engine.enemyActive).toBe(e1)
    expect(events[0].message).toContain('吸盘')
  })

  it('扎根挡下强制换人', () => {
    const { engine, e1 } = forceEngine()
    ad(e1).ingrain = true
    const events: any[] = []
    expect(engine.forceSwitchOut(e1, events, '吼叫')).toBe(false)
    expect(engine.enemyActive).toBe(e1)
  })

  it('没有替补时强制换人失败', () => {
    const p = makePokemon({ ability: none, types: [Type.Normal, null], move: roar, nameZh: '我方' })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: '敌方' })
    const engine = new BattleEngine([p], [e], 42) as any
    expect(engine.forceSwitchOut(e, [], '吼叫')).toBe(false)
  })
})

describe('T8：回复类招式', () => {
  const statusEffect = { kind: 'status', data: {} } as any

  function healEngine(moveName: string, moveZh: string) {
    const mv = makeMove(moveName, moveZh, Type.Normal, 'status', 0, 100)
    const p1 = makePokemon({ ability: none, types: [Type.Normal, null], move: mv, nameZh: 'A' })
    const p2 = makePokemon({ ability: none, types: [Type.Normal, null], move: mv, nameZh: 'B' })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: '敌方' })
    return { engine: new BattleEngine([p1, p2], [e], 42) as any, p1, p2, e, mv }
  }

  it('精神觉醒：治愈自身烧伤', () => {
    const { engine, p1, e, mv } = healEngine('refresh', '精神觉醒')
    p1.status = 'burn'
    const events: any[] = []
    engine.applyStatusEffect(p1, e, mv, statusEffect, events)
    expect(p1.status).toBeNull()
  })

  it('治愈铃声：治愈全队异常状态', () => {
    const { engine, p1, p2, e, mv } = healEngine('heal-bell', '治愈铃声')
    p1.status = 'poison'
    p2.status = 'paralysis'
    const events: any[] = []
    engine.applyStatusEffect(p1, e, mv, statusEffect, events)
    expect(p1.status).toBeNull()
    expect(p2.status).toBeNull()
    expect(events[0].message).toContain('2')
  })

  it('治愈波动：回复目标 1/2 最大 HP', () => {
    const { engine, p1, e, mv } = healEngine('heal-pulse', '治愈波动')
    e.currentHp = 40
    const events: any[] = []
    engine.applyStatusEffect(p1, e, mv, statusEffect, events)
    expect(e.currentHp).toBe(140)
  })

  it('水流环：回合末回复 1/16', () => {
    const { engine, p1, e, mv } = healEngine('aqua-ring', '水流环')
    const events: any[] = []
    engine.applyStatusEffect(p1, e, mv, statusEffect, events)
    expect(ad(p1).aquaRing).toBe(true)
    p1.currentHp = 100
    engine.applyEndOfTurnField(events)
    expect(p1.currentHp).toBe(100 + 12)
  })

  it('祈愿：下一个回合末才回复 1/2', () => {
    const { engine, p1, e, mv } = healEngine('wish', '祈愿')
    p1.currentHp = 50
    const events: any[] = []
    engine.applyStatusEffect(p1, e, mv, statusEffect, events)
    // 第一个回合末：仅倒计时，不回血
    engine.applyEndOfTurnField(events)
    expect(p1.currentHp).toBe(50)
    // 第二个回合末：生效
    engine.applyEndOfTurnField(events)
    expect(p1.currentHp).toBe(150)
  })
})

// ============================================================
// T9：12 项特性实装
// ============================================================

/** 每个用例独立的招式实例，避免共享对象被 PP 消耗/变身污染 */
function freshMove(
  name = 'tackle', nameZh = '撞击', type = Type.Normal,
  category: 'physical' | 'special' | 'status' = 'physical',
  power = 60, accuracy = 100,
): Move {
  return makeMove(name, nameZh, type, category, power, accuracy)
}

/** 用固定返回值替换引擎内部 rng，让概率分支可确定性验证 */
function stubRng(engine: any, value: number) {
  engine.rng = { next: () => value, nextInt: (n: number) => Math.floor(value * n) }
}

const MOVE = { type: 'move' as const, moveIndex: 0 }

describe('T9：击倒 / 畏缩联动（自信过剩 · 不屈之心 · 引爆）', () => {
  it('自信过剩：击倒对手后攻击 +1', () => {
    const mv = freshMove()
    const p = makePokemon({ ability: makeAbility('moxie', '自信过剩'), types: [Type.Normal, null], move: mv, nameZh: '我方' })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: freshMove(), nameZh: '敌方' })
    e.currentHp = 1
    const engine = new BattleEngine([p], [e], 42) as any
    const events = engine.executeSingleAction(MOVE, p, true)
    expect(e.fainted).toBe(true)
    expect(p.statStages.attack).toBe(1)
    expect(events.some((ev: any) => ev.message.includes('自信过剩'))).toBe(true)
  })

  it('自信过剩：没击倒对手时不提升攻击', () => {
    const p = makePokemon({ ability: makeAbility('moxie', '自信过剩'), types: [Type.Normal, null], move: freshMove(), nameZh: '我方' })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: freshMove(), nameZh: '敌方' })
    const engine = new BattleEngine([p], [e], 42) as any
    engine.executeSingleAction(MOVE, p, true)
    expect(e.fainted).toBe(false)
    expect(p.statStages.attack).toBe(0)
  })

  it('不屈之心：每次畏缩时速度 +1', () => {
    const { engine, p, e } = engineWith(none, makeAbility('steadfast', '不屈之心'))
    const flinch = { kind: 'attack-secondary', data: { chance: 100, status: 'flinch' } } as any
    const events: any[] = []
    engine.applyAttackSecondaryEffect(p, e, phys, flinch, events)
    expect(ad(e).flinched).toBe(true)
    expect(e.statStages.speed).toBe(1)
    // 第二次畏缩再 +1
    ad(e).flinched = false
    engine.applyAttackSecondaryEffect(p, e, phys, flinch, events)
    expect(e.statStages.speed).toBe(2)
  })

  it('引爆：因接触招式倒下时对攻击方造成 1/4 最大 HP 伤害', () => {
    const bite = freshMove('bite', '咬住', Type.Dark, 'physical', 60, 100)
    const p = makePokemon({ ability: none, types: [Type.Normal, null], move: bite, nameZh: '我方' })
    const e = makePokemon({ ability: makeAbility('aftermath', '引爆'), types: [Type.Normal, null], move: freshMove(), nameZh: '敌方' })
    e.currentHp = 1
    const engine = new BattleEngine([p], [e], 42) as any
    const events = engine.executeSingleAction(MOVE, p, true)
    expect(e.fainted).toBe(true)
    expect(p.currentHp).toBe(200 - 50) // 200 / 4 = 50
    expect(events.some((ev: any) => ev.message.includes('引爆'))).toBe(true)
  })

  it('引爆：非接触招式倒下时不反伤', () => {
    // tackle 在 move-tags 中未标记 contact
    const p = makePokemon({ ability: none, types: [Type.Normal, null], move: freshMove(), nameZh: '我方' })
    const e = makePokemon({ ability: makeAbility('aftermath', '引爆'), types: [Type.Normal, null], move: freshMove(), nameZh: '敌方' })
    e.currentHp = 1
    const engine = new BattleEngine([p], [e], 42) as any
    engine.executeSingleAction(MOVE, p, true)
    expect(e.fainted).toBe(true)
    expect(p.currentHp).toBe(200)
  })
})

describe('T9：行动顺序与行动限制（分析 · 懒惰）', () => {
  it('分析：后手行动时伤害 ×1.3', () => {
    const orig = Math.random; Math.random = () => 0.5
    try {
      const atk = makePokemon({ ability: makeAbility('analytic', '分析'), types: [Type.Fire, null], move: phys })
      const def = makePokemon({ ability: none, types: [Type.Normal, null], move: phys })
      const rng = () => 0.5
      atk._abilityData = { movedLast: false }
      const firstMove = calculateDamage(atk, def, phys, 'none', rng).damage
      atk._abilityData = { movedLast: true }
      const lastMove = calculateDamage(atk, def, phys, 'none', rng).damage
      expect(lastMove).toBeGreaterThan(firstMove)
      expect(lastMove).toBeLessThanOrEqual(Math.floor(firstMove * 1.3) + 1)
    } finally { Math.random = orig }
  })

  it('分析：executeTurn 正确标记先手 / 后手', () => {
    const p = makePokemon({ ability: none, types: [Type.Normal, null], move: freshMove(), nameZh: '我方' })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: freshMove(), nameZh: '敌方' })
    e.baseStats.speed = 1 // 敌方明显更慢 → 后手
    const engine = new BattleEngine([p], [e], 42) as any
    engine.executeTurn(MOVE, MOVE)
    expect(ad(p).movedLast).toBe(false)
    expect(ad(e).movedLast).toBe(true)
  })

  it('懒惰：每隔一回合无法行动', () => {
    const { engine, p } = engineWith(makeAbility('truant', '懒惰'), none)
    expect(engine.canAct(p).canAct).toBe(true)   // 第 1 回合正常
    const second = engine.canAct(p)
    expect(second.canAct).toBe(false)            // 第 2 回合偷懒
    expect(second.message).toContain('偷懒')
    expect(engine.canAct(p).canAct).toBe(true)   // 第 3 回合恢复
    expect(engine.canAct(p).canAct).toBe(false)  // 第 4 回合再偷懒
  })
})

describe('T9：概率与命中类（恶臭 · 神奇皮肤）', () => {
  it('恶臭：10% 概率追加畏缩（roll < 0.1 触发）', () => {
    const p = makePokemon({ ability: makeAbility('stench', '恶臭'), types: [Type.Normal, null], move: freshMove(), nameZh: '我方' })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: freshMove(), nameZh: '敌方' })
    const engine = new BattleEngine([p], [e], 42) as any
    stubRng(engine, 0.05)
    const events: any[] = []
    engine.applyStenchFlinch(p, e, events)
    expect(ad(e).flinched).toBe(true)
  })

  it('恶臭：roll ≥ 0.1 不触发；非恶臭宝可梦永不触发', () => {
    const p = makePokemon({ ability: makeAbility('stench', '恶臭'), types: [Type.Normal, null], move: freshMove(), nameZh: '我方' })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: freshMove(), nameZh: '敌方' })
    const engine = new BattleEngine([p], [e], 42) as any
    stubRng(engine, 0.5)
    engine.applyStenchFlinch(p, e, [])
    expect(ad(e).flinched).toBeFalsy()

    const plain = makePokemon({ ability: none, types: [Type.Normal, null], move: freshMove() })
    stubRng(engine, 0.01)
    engine.applyStenchFlinch(plain, e, [])
    expect(ad(e).flinched).toBeFalsy()
  })

  it('神奇皮肤：变化招式命中率降为 50，攻击招式不受影响', () => {
    const statusMove = freshMove('thunder-wave', '电磁波', Type.Electric, 'status', 0, 100)
    const p = makePokemon({ ability: none, types: [Type.Normal, null], move: statusMove, nameZh: '我方' })
    const e = makePokemon({ ability: makeAbility('wonder-skin', '神奇皮肤'), types: [Type.Normal, null], move: freshMove(), nameZh: '敌方' })
    const engine = new BattleEngine([p], [e], 42) as any
    // 关键：必须绕过 accuracy >= 100 的提前返回
    expect(engine.calcFinalAccuracy(statusMove, p, e)).toBe(50)
    expect(engine.calcFinalAccuracy(phys, p, e)).toBe(100)
    // 原本就低于 50 的变化招式不会被抬高
    const lowAcc = freshMove('sing', '唱歌', Type.Normal, 'status', 0, 40)
    expect(engine.calcFinalAccuracy(lowAcc, p, e)).toBeCloseTo(40)
  })
})

describe('T9：破格（mold-breaker）无视防守方特性', () => {
  const groundMove = makeMove('earthquake', '地震', Type.Ground, 'physical', 100, 100)

  it('破格无视飘浮：地面招式可命中飘浮宝可梦', () => {
    const mb = makePokemon({ ability: makeAbility('mold-breaker', '破格'), types: [Type.Normal, null], move: groundMove, nameZh: '破格' })
    const lev = makePokemon({ ability: makeAbility('levitate', '飘浮'), types: [Type.Normal, null], move: freshMove(), nameZh: '飘浮' })
    const engine = new BattleEngine([mb], [lev], 42) as any
    engine.executeSingleAction(MOVE, mb, true)
    expect(lev.currentHp).toBeLessThan(200)

    // 对照组：普通攻击方会被飘浮挡下
    const plain = makePokemon({ ability: none, types: [Type.Normal, null], move: groundMove, nameZh: '普通' })
    const lev2 = makePokemon({ ability: makeAbility('levitate', '飘浮'), types: [Type.Normal, null], move: freshMove(), nameZh: '飘浮2' })
    const engine2 = new BattleEngine([plain], [lev2], 42) as any
    engine2.executeSingleAction(MOVE, plain, true)
    expect(lev2.currentHp).toBe(200)
  })

  it('破格无视厚脂肪：火系伤害不再减半', () => {
    const orig = Math.random; Math.random = () => 0.5
    try {
      const fire = makeMove('flamethrower', '喷射火焰', Type.Fire, 'special', 90, 100)
      const mb = makePokemon({ ability: makeAbility('mold-breaker', '破格'), types: [Type.Normal, null], move: fire })
      const plain = makePokemon({ ability: none, types: [Type.Normal, null], move: fire })
      const fat = makePokemon({ ability: makeAbility('thick-fat', '厚脂肪'), types: [Type.Normal, null], move: fire })
      const rng = () => 0.5
      const blocked = calculateDamage(plain, fat, fire, 'none', rng).damage
      const broken = calculateDamage(mb, fat, fire, 'none', rng).damage
      expect(broken).toBeGreaterThan(blocked)
    } finally { Math.random = orig }
  })

  it('破格无视受击反应特性：正义之心不再触发', () => {
    const mb = makePokemon({ ability: makeAbility('mold-breaker', '破格'), types: [Type.Normal, null], move: darkMove })
    const just = makePokemon({ ability: makeAbility('justified', '正义之心'), types: [Type.Normal, null], move: freshMove() })
    const engine = new BattleEngine([mb], [just], 42) as any
    engine.applyDefenderHitAbilities(just, darkMove, [], true, false, mb)
    expect(just.statStages.attack).toBe(0)
    // 无破格时照常触发
    const plain = makePokemon({ ability: none, types: [Type.Normal, null], move: darkMove })
    engine.applyDefenderHitAbilities(just, darkMove, [], true, false, plain)
    expect(just.statStages.attack).toBe(1)
  })

  it('破格不影响既有特性：非破格攻击方行为完全不变（结实仍生效）', () => {
    const p = makePokemon({ ability: none, types: [Type.Normal, null], move: freshMove('body-slam', '泰山压顶', Type.Normal, 'physical', 600, 100), nameZh: '我方' })
    const e = makePokemon({ ability: makeAbility('sturdy', '结实'), types: [Type.Normal, null], move: freshMove(), nameZh: '敌方' })
    const engine = new BattleEngine([p], [e], 42) as any
    engine.executeSingleAction(MOVE, p, true)
    expect(e.fainted).toBe(false)
    expect(e.currentHp).toBe(1)
  })
})

describe('T9：魔法镜 · 迟钝 · 心情不定 · 变身者', () => {
  it('魔法镜：反弹寄生种子回原使用者', () => {
    const seed = freshMove('leech-seed', '寄生种子', Type.Grass, 'status', 0, 90)
    const p = makePokemon({ ability: none, types: [Type.Normal, null], move: seed, nameZh: '我方' })
    const e = makePokemon({ ability: makeAbility('magic-bounce', '魔法镜'), types: [Type.Normal, null], move: freshMove(), nameZh: '敌方' })
    const engine = new BattleEngine([p], [e], 42) as any
    const events: any[] = []
    engine.applyStatusEffect(p, e, seed, undefined, events)
    expect(ad(p).leechSeed).toBe(true)
    expect(ad(e).leechSeed).toBeFalsy()
    expect(events.some((ev: any) => ev.message.includes('魔法镜'))).toBe(true)
  })

  it('魔法镜：不反弹作用于自身的变化招式（守住）', () => {
    const protectMv = freshMove('protect', '守住', Type.Normal, 'status', 0, 100)
    const p = makePokemon({ ability: none, types: [Type.Normal, null], move: protectMv, nameZh: '我方' })
    const e = makePokemon({ ability: makeAbility('magic-bounce', '魔法镜'), types: [Type.Normal, null], move: freshMove(), nameZh: '敌方' })
    const engine = new BattleEngine([p], [e], 42) as any
    engine.applyStatusEffect(p, e, protectMv, undefined, [])
    expect(ad(p).protected).toBe(true)
    expect(ad(e).protected).toBeFalsy()
  })

  it('迟钝：免疫威吓', () => {
    const p = makePokemon({ ability: makeAbility('oblivious', '迟钝'), types: [Type.Normal, null], move: freshMove(), nameZh: '我方' })
    const e = makePokemon({ ability: makeAbility('intimidate', '威吓'), types: [Type.Normal, null], move: freshMove(), nameZh: '敌方' })
    const engine = new BattleEngine([p], [e], 42) as any
    const msg = engine.applyOnSwitchAbility(e, true)
    expect(p.statStages.attack).toBe(0)
    expect(msg).toContain('迟钝')
  })

  it('迟钝：免疫混乱', () => {
    const confuseMv = freshMove('confuse-ray', '奇异之光', Type.Ghost, 'status', 0, 100)
    const p = makePokemon({ ability: none, types: [Type.Normal, null], move: confuseMv, nameZh: '我方' })
    const e = makePokemon({ ability: makeAbility('oblivious', '迟钝'), types: [Type.Normal, null], move: freshMove(), nameZh: '敌方' })
    const engine = new BattleEngine([p], [e], 42) as any
    const events: any[] = []
    engine.applyStatusEffect(p, e, confuseMv, { kind: 'status', data: { confuse: true } } as any, events)
    expect(e.confuseTurns).toBeFalsy()
    expect(events.some((ev: any) => ev.message.includes('迟钝'))).toBe(true)
  })

  it('心情不定：回合末随机一项 +2、另一项 -1', () => {
    const { engine, p } = engineWith(makeAbility('moody', '心情不定'), none)
    stubRng(engine, 0) // up = pool[0] = attack；down = rest[0] = defense
    const events: any[] = []
    engine.applyEndOfTurnField(events)
    expect(p.statStages.attack).toBe(2)
    expect(p.statStages.defense).toBe(-1)
    // 提升项与降低项必定不同
    const changed = Object.entries(p.statStages).filter(([, v]) => v !== 0)
    expect(changed.length).toBe(2)
  })

  it('变身者：登场时复制对手种族值/属性/招式/特性，HP 不变', () => {
    const p = makePokemon({ ability: makeAbility('imposter', '变身者'), types: [Type.Normal, null], move: freshMove(), nameZh: '百变怪' })
    const eMove = freshMove('flamethrower', '喷射火焰', Type.Fire, 'special', 90, 100)
    const e = makePokemon({ ability: makeAbility('blaze', '猛火'), types: [Type.Fire, Type.Flying], move: eMove, nameZh: '喷火龙' })
    e.baseStats.attack = 155
    e.statStages.speed = 2
    p.currentHp = 120
    const engine = new BattleEngine([p], [e], 42) as any
    const msg = engine.applyOnSwitchAbility(p, false)

    expect(msg).toContain('变身')
    expect(p.baseStats.attack).toBe(155)
    expect(p.types).toEqual([Type.Fire, Type.Flying])
    expect(p.ability.name).toBe('blaze')
    expect(p.moves[0].name).toBe('flamethrower')
    expect(p.moves[0].currentPp).toBe(5)
    expect(p.statStages.speed).toBe(2)
    // HP 不复制
    expect(p.maxHp).toBe(200)
    expect(p.currentHp).toBe(120)
    expect(p.baseStats.hp).toBe(200)
    // 招式为深拷贝，改动不影响对手
    p.moves[0].currentPp = 0
    expect(e.moves[0].currentPp).toBe(99)
  })
})
