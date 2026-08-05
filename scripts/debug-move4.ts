/* 完整闭环测试：倒下→换人→放技能，node --import tsx scripts/debug-move4.ts */
import { BattleEngine } from '../src/game/engine/BattleEngine'
import { generateEnemyTeam } from '../src/game/factory/TeamGenerator'
import { RecombineFactory } from '../src/game/factory/RecombineFactory'
import { gameStore } from '../src/stores/gameStore'
import { get } from 'svelte/store'

function main() {
  const factory = new RecombineFactory(12345)
  const playerTeam = factory.generateInitialTeam(6)
  gameStore.setTeam(playerTeam)
  const seed = get(gameStore).seed
  const enemy = generateEnemyTeam(seed + 1, false)
  const engine = new BattleEngine(playerTeam, enemy, seed + 2)
  engine.initAbilities()

  console.log('=== 玩家队伍(6只) ===')
  playerTeam.forEach((p, i) => console.log(`  [${i}] ${p.name} hp=${p.currentHp}/${p.maxHp}`))

  // 模拟战斗直到玩家精灵倒下
  let round = 0
  while (!engine.playerActive.fainted && round < 30) {
    round++
    const events = engine.executeTurn({ type: 'move', moveIndex: 0 }, engine.enemyAction())
    if (!events || events.length === 0) { console.log(`❌ 第${round}回合空 events`); break }
    console.log(`第${round}回合: ${events.map(e=>e.message).join(' | ').slice(0, 80)}`)
    if (engine.playerActive.fainted) {
      console.log(`  → 玩家 ${engine.playerActive.nameZh} 倒下！needsPlayerSwitch=${engine.needsPlayerSwitch}`)
    }
  }

  if (!engine.playerActive.fainted) {
    console.log('❌ 30回合内玩家未倒下，测试无意义')
    return
  }

  // 前端弹换人界面：选第一只没倒下的
  const aliveIdx = playerTeam.findIndex((p, i) => !p.fainted && p.id !== engine.playerActive.id)
  console.log(`\n=== 换人：选择 [${aliveIdx}] ${playerTeam[aliveIdx]?.name} ===`)
  const ok = engine.switchPlayer(aliveIdx)
  console.log('switchPlayer 返回:', ok)
  console.log('needsPlayerSwitch 现在:', engine.needsPlayerSwitch)
  console.log('当前玩家精灵:', engine.playerActive.name, 'hp:', engine.playerActive.currentHp)

  // 换人后放技能
  console.log('\n=== 换人后放技能 ===')
  const events = engine.executeTurn({ type: 'move', moveIndex: 0 }, engine.enemyAction())
  console.log('events:', events?.length)
  events?.forEach(e => console.log(`  [${e.type}] ${e.message}`))

  if (events && events.length > 0) {
    console.log('\n✅ 完整闭环通过：倒下→换人→放技能 全部正常')
  } else {
    console.log('\n❌ 换人后放技能仍返回空 events！')
  }
}

main()
