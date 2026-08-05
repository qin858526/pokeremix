// 端到端验证：真实事件流下的揭示逻辑（模拟 Battle.svelte 处理）
import { BattleEngine } from '../src/game/engine/BattleEngine'
import { SPECIES_DB, createPokemonInstance } from '../src/game/data/pokemon'
import { MOVE_DB, getMoveByName } from '../src/game/data/moves'
import { ABILITY_DB, getAbilityByName } from '../src/game/data/abilities'
import { getTypeEffectiveness } from '../src/game/engine/TypeChart'
import type { Type } from '../src/game/data/types'

function makeTeam(indices: number[]): any[] {
  return indices.map(i => {
    const spec = SPECIES_DB[i]
    const moves = [
      getMoveByName('tackle') ?? MOVE_DB[0],
      getMoveByName('ember') ?? MOVE_DB[2],
      getMoveByName('water-gun') ?? MOVE_DB[3],
      getMoveByName('psychic') ?? MOVE_DB[5] ?? MOVE_DB[0],
    ]
    const ability = getAbilityByName('overgrow') ?? ABILITY_DB[0]
    return createPokemonInstance(spec, moves, ability)
  })
}

// 敌方：鬼斯（幽灵+毒）
const ghostIdx = SPECIES_DB.findIndex(s => s.types[0] === 'ghost' || s.types[1] === 'ghost')
const playerTeam = makeTeam([0])
const enemyTeam = makeTeam([ghostIdx])

const engine = new BattleEngine(playerTeam, enemyTeam, 123)
engine.initAbilities()

// 模拟揭示状态
let revealedTypes = new Set<Type>()
let enemyAbilityRevealed = false
let enemySeenMoves = new Set<string>()
let playerSelectedMoveType: Type | null = null
let currentMoveType: Type | null = null
let lastAttacker: 'player' | 'enemy' = 'player'

function revealTypesFromEffectiveness(moveType: Type, expectedMult: number) {
  const realTypes = [engine.enemyActive.types[0], engine.enemyActive.types[1]].filter(Boolean) as Type[]
  const matched = realTypes.filter(t => getTypeEffectiveness(moveType, [t, null]) === expectedMult)
  for (const m of matched) revealedTypes.add(m)
}

function processEvents(events: any[], isPlayerMove: boolean, playerMoveType: Type | null) {
  playerSelectedMoveType = playerMoveType
  for (const evt of events) {
    if (evt.triggerSource === 'ability') {
      if (evt.triggerSide === 'enemy') enemyAbilityRevealed = true
      continue
    }
    // 使用了
    if (evt.type === 'effect' && evt.message.includes('使用了')) {
      lastAttacker = evt.actionSide ?? 'player'
      const attacker = lastAttacker === 'player' ? engine.playerActive : engine.enemyActive
      const usedMove = attacker?.moves.find(m => evt.message.includes(m.nameZh))
      currentMoveType = usedMove?.type ?? null
      if (lastAttacker === 'enemy' && usedMove) {
        enemySeenMoves.add(usedMove.name)
        // STAB 揭示
        const realTypes = [engine.enemyActive.types[0], engine.enemyActive.types[1]].filter(Boolean) as Type[]
        if (realTypes.includes(usedMove.type)) revealedTypes.add(usedMove.type)
      }
      continue
    }
    // 克制反馈 + 揭示
    if ((evt.type === 'effect' || evt.type === 'fail') && (evt.message.includes('效果绝佳') || evt.message.includes('效果不太好') || evt.message.includes('没有效果'))) {
      const kind = evt.message.includes('效果绝佳') ? 'super' : evt.message.includes('效果不太好') ? 'weak' : 'none'
      if (engine.enemyActive) {
        let revealMoveType: Type | null = null
        if (kind === 'none') {
          const isPlayerHitEnemy = evt.message.includes(engine.enemyActive.nameZh) && !evt.message.includes(engine.playerActive.nameZh)
          if (isPlayerHitEnemy) revealMoveType = playerSelectedMoveType
        } else {
          if (lastAttacker === 'player') revealMoveType = currentMoveType
        }
        if (revealMoveType) {
          if (kind === 'super') revealTypesFromEffectiveness(revealMoveType, 2)
          else if (kind === 'weak') revealTypesFromEffectiveness(revealMoveType, 0.5)
          else if (kind === 'none') revealTypesFromEffectiveness(revealMoveType, 0)
        }
      }
      continue
    }
  }
}

const enemyReal = [engine.enemyActive.types[0], engine.enemyActive.types[1]].filter(Boolean) as Type[]
console.log('=== 敌方: 鬼斯, 真实属性:', enemyReal.join(' + '), '===')

// 回合1：玩家用普通系（撞击）→ 免疫幽灵
console.log('\n--- 回合1: 玩家使用撞击(普通系) ---')
const evt1 = engine.executeTurn({ type: 'move', moveIndex: 0 }, engine.enemyAction())
processEvents(evt1, true, engine.playerActive.moves[0].type)
console.log('揭示属性:', [...revealedTypes].join(', ') || '(空)')
console.log('含 ghost?', revealedTypes.has('ghost' as Type) ? 'PASS' : 'FAIL')

// 回合2：玩家用超能力（psychic）→ 效果绝佳打毒
console.log('\n--- 回合2: 玩家使用 精神强念(超能力) ---')
const evt2 = engine.executeTurn({ type: 'move', moveIndex: 3 }, engine.enemyAction())
processEvents(evt2, true, engine.playerActive.moves[3].type)
console.log('揭示属性:', [...revealedTypes].join(', ') || '(空)')

// 回合3：敌方用 STAB 技能（如果敌方有幽灵/毒系技能）
console.log('\n--- 回合3: 敌方行动（STAB 检测）---')
const evt3 = engine.executeTurn({ type: 'move', moveIndex: 1 }, engine.enemyAction())
processEvents(evt3, true, engine.playerActive.moves[1].type)
console.log('揭示属性:', [...revealedTypes].join(', ') || '(空)')
console.log('敌方已见技能:', [...enemySeenMoves].join(', ') || '(空)')
console.log('敌方特性揭示:', enemyAbilityRevealed)

console.log('\n最终全揭示?', enemyReal.every(t => revealedTypes.has(t)) ? 'PASS' : '(未全揭示，正常)')
