// 临时验证脚本：验证 BattleEngine 主动换人（switch action）流程
import { BattleEngine } from '../src/game/engine/BattleEngine'
import { SPECIES_DB, createPokemonInstance } from '../src/game/data/pokemon'
import { MOVE_DB, getMoveByName } from '../src/game/data/moves'
import { ABILITY_DB, getAbilityByName } from '../src/game/data/abilities'

function makeTeam(indices: number[], abilityName = 'overgrow'): any[] {
  return indices.map(i => {
    const spec = SPECIES_DB[i]
    const moves = [
      getMoveByName('tackle') ?? MOVE_DB[0],
      getMoveByName('growl') ?? MOVE_DB[1],
      getMoveByName('ember') ?? MOVE_DB[2],
      getMoveByName('water-gun') ?? MOVE_DB[3],
    ]
    const ability = getAbilityByName(abilityName) ?? ABILITY_DB[0]
    return createPokemonInstance(spec, moves, ability)
  })
}

// 玩家 2 只精灵，敌方 2 只
const playerTeam = makeTeam([0, 6]) // 妙蛙种子 + 杰尼龟
const enemyTeam = makeTeam([3, 7]) // 小火龙 + 卡咪龟

const engine = new BattleEngine(playerTeam, enemyTeam, 12345)
engine.initAbilities()

console.log('=== 初始 ===')
console.log('玩家场上:', engine.playerActive.nameZh)
console.log('敌方场上:', engine.enemyActive.nameZh)
console.log('玩家队伍:', engine.playerTeam.map(p => p.nameZh).join(', '))

// 玩家主动换人：把 0 号（妙蛙种子）换成 1 号（杰尼龟）
const playerAction = { type: 'switch' as const, targetIndex: 1 }
const enemyAction = engine.enemyAction()

console.log('\n=== 执行换人回合 ===')
console.log('玩家行动:', JSON.stringify(playerAction))
console.log('敌方行动:', JSON.stringify(enemyAction))

const events = engine.executeTurn(playerAction, enemyAction)
console.log('事件:')
for (const e of events) {
  console.log(`  [${e.type}] ${e.message}`)
}

console.log('\n=== 换人结果 ===')
console.log('玩家场上:', engine.playerActive.nameZh)
console.log('敌方场上:', engine.enemyActive.nameZh)
console.log('玩家场上是杰尼龟?', engine.playerActive.nameZh === '杰尼龟' ? 'PASS' : 'FAIL')
console.log('玩家需要换人?', engine.needsPlayerSwitch)

// 验证换人后新精灵承受敌方攻击（HP 可能降低）
console.log('\n=== 敌方攻击后新精灵状态 ===')
console.log('杰尼龟 HP:', engine.playerActive.currentHp, '/', engine.playerActive.maxHp)
console.log('换人后玩家 active 引用正确?', engine.playerTeam[1] === engine.playerActive ? 'PASS' : 'FAIL')

// 第二次验证：换人后敌方倒下自动补位是否正常
console.log('\n=== 回合完成 ===')
const end = engine.checkBattleEnd()
console.log('战斗结束状态:', end ?? '继续')
console.log('\n全部验证完成')
