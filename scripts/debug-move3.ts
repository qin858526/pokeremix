/* 动画事件流逻辑测试：node --import tsx scripts/debug-move3.ts */
import { BattleEngine } from '../src/game/engine/BattleEngine'
import { generateEnemyTeam } from '../src/game/factory/TeamGenerator'
import { RecombineFactory } from '../src/game/factory/RecombineFactory'
import { gameStore } from '../src/stores/gameStore'
import { get } from 'svelte/store'

function delay(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const factory = new RecombineFactory(12345)
  const playerTeam = factory.generateInitialTeam(6).slice(0, 3)
  gameStore.setTeam(playerTeam)
  const seed = get(gameStore).seed
  const enemy = generateEnemyTeam(seed + 1, false)
  const engine = new BattleEngine(playerTeam, enemy, seed + 2)
  engine.initAbilities()

  console.log('=== 连续 10 回合技能释放，模拟 animateEvents 逻辑 ===')
  for (let t = 0; t < 10; t++) {
    const moveIdx = t % 4
    const playerAction = { type: 'move' as const, moveIndex: moveIdx }
    const enemyAction = engine.enemyAction()
    const events = engine.executeTurn(playerAction, enemyAction)
    if (!events || events.length === 0) {
      console.log(`❌ 第 ${t+1} 回合 events 为空!`)
      break
    }

    // 模拟 animateEvents 的关键访问逻辑
    try {
      let lastAttacker: 'player' | 'enemy' = 'player'
      let currentMoveType = null
      for (const evt of events) {
        if ((evt as any).triggerSource === 'ability') continue
        if (evt.type === 'effect' && evt.message.includes('使用了')) {
          lastAttacker = (evt as any).actionSide ?? 'player'
          const attacker = lastAttacker === 'player' ? engine.playerActive : engine.enemyActive
          if (attacker) {
            const usedMove = attacker.moves.find((m: any) => evt.message.includes(m.nameZh))
            currentMoveType = usedMove?.type ?? null
          }
        }
        if (evt.type === 'damage') {
          const defender = lastAttacker === 'player' ? 'enemy' : 'player'
          // 模拟模板访问
          const p = defender === 'player' ? engine.playerActive : engine.enemyActive
          if (p) {
            const x = p.maxHp; const y = p.currentHp
          }
        }
        if (evt.message.includes('倒下了')) {
          const side = (evt as any).actionSide ?? lastAttacker
          const p = side === 'player' ? engine.playerActive : engine.enemyActive
          if (p) { const z = p.nameZh }
        }
        if (evt.message.includes('派出') || evt.message.includes('上吧！')) {
          const side = (evt as any).actionSide === 'player' ? 'player' : evt.message.includes('对方') ? 'enemy' : 'player'
          const p = side === 'player' ? engine.playerActive : engine.enemyActive
        }
      }
      console.log(`✅ 第 ${t+1} 回合: ${events.length} 事件, 无异常`)
      if (engine.playerActive.fainted || engine.enemyActive.fainted) {
        console.log(`   第 ${t+1} 回合有精灵倒下`)
        // 处理倒下
        if (engine.playerActive.fainted) { console.log('   玩家精灵倒下，需要换人') }
      }
    } catch (e) {
      console.log(`❌ 第 ${t+1} 回合动画逻辑异常: ${(e as Error).message}`)
      break
    }
    await delay(10)
  }
  console.log('\n=== 测试完成 ===')
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
