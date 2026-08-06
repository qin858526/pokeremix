<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { gameStore } from '../stores/gameStore'
  import { battleStore } from '../stores/battleStore'
  import { generateEnemyTeam } from '../game/factory/TeamGenerator'
  import { TYPE_COLORS } from '../game/data/types'
  import type { RecombinedPokemon, Move, Ability, Type } from '../game/data/types'
  import { abilityLabel, moveLabel } from '../game/data/impl-marks'
  import { getTypeZh } from '../game/data/type-zh'
  import { getTypeEffectiveness } from '../game/engine/TypeChart'
  import SearchPicker from '../components/SearchPicker.svelte'
  import BattleFx from '../components/BattleFx.svelte'
  import BattleWeather from '../components/BattleWeather.svelte'
  import { SPECIES_DB } from '../game/data/pokemon'
  import { MOVE_DB } from '../game/data/moves'
  import { ABILITY_DB } from '../game/data/abilities'

  let { simulator = false } = $props()

  function delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }

  let playerActive = $state<RecombinedPokemon | null>(null)
  let enemyActive = $state<RecombinedPokemon | null>(null)
  let log = $state<string[]>([])
  let abilityNotifs = $state<{ id: number; message: string; side: 'player' | 'enemy' }[]>([])
  let notifIdCounter = $state(0)
  let lastLogIndex = $state(0)
  let announceText = $state('')
  let animClassPlayer = $state('')
  let animClassEnemy = $state('')
  let displayPlayerHp = $state(0)
  let displayEnemyHp = $state(0)
  // 显示快照：动画期间锁定为"当前正在渲染的宝可梦"，避免回合内同步换人导致
  // 倒下/攻击演出挂到新宝可梦身上、血条瞬间跳满。仅在"换人/上场"事件时切换。
  let displayPlayer = $state<RecombinedPokemon | null>(null)
  let displayEnemy = $state<RecombinedPokemon | null>(null)
  // 执行回合期间抑制从 store 直接同步显示状态（防止 executeTurn 同步换人污染动画）
  let suppressHpSync = $state(false)
  let result = $state<'playing' | 'player_win' | 'enemy_win'>('playing')
  let animating = $state(false)
  let floor = $state(1)
  let isBoss = $state(false)
  let showStatus = $state(false)
  let needsSwitch = $state(false)
  let playerTeam = $state<RecombinedPokemon[]>([])
  let enemyTeam = $state<RecombinedPokemon[]>([])
  let weather = $state('none')

  // ===== 战斗演出增强状态 =====
  // 技能命中特效（属性 + 目标方 + 自增 key 强制重建）
  let fx = $state<{ type: string; side: 'player' | 'enemy'; key: number }[]>([])
  let fxIdCounter = $state(0)
  // 伤害数字
  let damageNumbers = $state<{ id: number; amount: number; side: 'player' | 'enemy'; crit?: boolean }[]>([])
  let dmgIdCounter = $state(0)
  // 属性克制文字反馈（super/weak/none）
  let effFeedback = $state<{ text: string; kind: 'super' | 'weak' | 'none'; key: number } | null>(null)
  let effIdCounter = $state(0)
  // 出场演出标记（sprite-enter + 精灵球环）
  let enterFx = $state<{ side: 'player' | 'enemy'; key: number } | null>(null)
  let enterFxIdCounter = $state(0)
  // 倒下白色光爆
  let faintFx = $state<{ side: 'player' | 'enemy'; key: number } | null>(null)
  let faintFxIdCounter = $state(0)
  // 主动换人面板
  let showSwitchMenu = $state(false)
  // 记录当前回合技能属性（供 damage 事件触发特效）
  let currentMoveType = $state<Type | null>(null)
  // 玩家本次行动实际选择的技能属性（供免疫揭示——引擎免疫事件不携带技能名）
  let playerSelectedMoveType = $state<Type | null>(null)

  // ===== 敌方信息逐步揭示机制（TASK-2，见设计文档 10.4）=====
  /** 已揭示的敌方属性（未揭示显示 ???） */
  let revealedTypes = $state<Set<Type>>(new Set())
  /** 敌方特性是否已触发揭示 */
  let enemyAbilityRevealed = $state(false)
  /** 敌方已使用过的技能名（去重） */
  let enemySeenMoves = $state<Set<string>>(new Set())
  /** 敌方换人后重置揭示状态（每只敌方精灵独立） */
  let revealedEnemyId = $state<string | null>(null)

  // 模拟器编辑
  let pickerState = $state<{
    side: 'player' | 'enemy'
    type: 'ability' | 'move' | 'species'
    slot?: number
  } | null>(null)

  $effect(() => {
    const s = get(battleStore)
    playerActive = s.playerActive
    enemyActive = s.enemyActive
    playerTeam = s.playerTeam ?? []
    enemyTeam = s.enemyTeam
    result = s.result
    needsSwitch = s.needsPlayerSwitch
    weather = s.engine?.weather ?? 'none'
    log = s.turnLog.filter(e => e.triggerSource !== 'ability').slice(-6).map(e => e.message)
    lastLogIndex = s.turnLog.length
  })

  onMount(() => {
    const unsub = battleStore.subscribe(s => {
      const prevPlayerActive = playerActive
      const prevEnemyActiveId = enemyActive?.id
      playerActive = s.playerActive
      enemyActive = s.enemyActive
      playerTeam = s.playerTeam ?? []
      enemyTeam = s.enemyTeam
      result = s.result
      needsSwitch = s.needsPlayerSwitch
      weather = s.engine?.weather ?? 'none'
      log = s.turnLog.filter(e => e.triggerSource !== 'ability').slice(-6).map(e => e.message)

      // 首次有 active 精灵时触发开场出场演出（战斗开始，含模拟器模式）
      if (!prevPlayerActive && s.playerActive) {
        setTimeout(() => triggerEnterFx('enemy'), 250)
        setTimeout(() => triggerEnterFx('player'), 550)
      }

      // 敌方换人：重置该只敌方精灵的揭示状态
      if (s.enemyActive && s.enemyActive.id !== prevEnemyActiveId) {
        revealedEnemyId = s.enemyActive.id
        revealedTypes = new Set()
        enemyAbilityRevealed = false
        enemySeenMoves = new Set()
      }

      // 处理新增的特性事件（增量方式，避免重复）
      for (let i = lastLogIndex; i < s.turnLog.length; i++) {
        const e = s.turnLog[i]
        if (e.triggerSource === 'ability' && e.triggerSide) {
          // 敌方特性触发 → 永久揭示敌方特性
          if (e.triggerSide === 'enemy') enemyAbilityRevealed = true
          const id = notifIdCounter++
          abilityNotifs = [...abilityNotifs, { id, message: e.message, side: e.triggerSide }]
          setTimeout(() => {
            abilityNotifs = abilityNotifs.filter(n => n.id !== id)
          }, 2000)
        }
      }
      lastLogIndex = s.turnLog.length

      // 非动画、且非回合执行瞬间：同步显示快照与 HP
      // （executeTurn 会同步换人/改血，suppressHpSync 期间不污染动画中的显示状态）
      if (!animating && !suppressHpSync) {
        displayPlayer = s.playerActive
        displayEnemy = s.enemyActive
        displayPlayerHp = s.playerActive?.currentHp ?? 0
        displayEnemyHp = s.enemyActive?.currentHp ?? 0
      }
    })
    return unsub
  })

  $effect(() => {
    const g = get(gameStore)
    floor = g.currentFloor
    isBoss = [5, 10, 15, 20].includes(g.currentFloor)
  })

  onMount(() => {
    const unsub2 = gameStore.subscribe(g => {
      floor = g.currentFloor
      isBoss = [5, 10, 15, 20].includes(g.currentFloor)
    })
    return () => { unsub2() }
  })

  onMount(() => {
    if (simulator) return // simulator 模式由 setup 页面初始化 battleStore
    const game = get(gameStore)
    const seed = game?.seed ?? Date.now()
    const playerTeam = game?.playerTeam ?? []
    const boss = [5, 10, 15, 20].includes(game?.currentFloor ?? 0)
    const enemy = generateEnemyTeam(seed + 1, boss)
    battleStore.initBattle(playerTeam, enemy, seed + 2)
    // 出场演出由 battleStore.subscribe 首次 active 检测统一触发
  })

  function useMove(idx: number) {
    if (animating || result !== 'playing') return
    if (!playerActive || !enemyActive) return

    // 锁定显示快照为"当前在场宝可梦"（回合内引擎可能同步换人，动画需渲染旧精灵）
    displayPlayer = playerActive
    displayEnemy = enemyActive
    // 记录动画开始前的 HP，动画过程中逐步更新
    displayPlayerHp = playerActive.currentHp
    displayEnemyHp = enemyActive.currentHp

    // 记录玩家本次行动技能属性（免疫揭示用：引擎免疫事件不携带技能名）
    playerSelectedMoveType = playerActive.moves[idx]?.type ?? null

    suppressHpSync = true
    const events = battleStore.executeTurn(idx)
    suppressHpSync = false
    if (!events || events.length === 0) return

    animating = true
    animateEvents(events)
  }

  async function animateEvents(events: Array<{ message: string; type: string; actionSide?: 'player' | 'enemy'; triggerSource?: string; damage?: number }>) {
    announceText = ''
    let lastAttacker: 'player' | 'enemy' = 'player'

    try {
    for (const evt of events) {
      if (evt.triggerSource === 'ability') continue

      // ---- 阶段1：招式宣布 + 攻击方前冲 ----
      if (evt.type === 'effect' && evt.message.includes('使用了')) {
        announceText = evt.message
        lastAttacker = evt.actionSide ?? 'player'
        // 记录技能属性（供 damage 事件触发对应特效）
        const attacker = lastAttacker === 'player' ? displayPlayer : displayEnemy
        if (attacker) {
          const usedMove = attacker.moves.find(m => evt.message.includes(m.nameZh))
          currentMoveType = usedMove?.type ?? null
          // 敌方使用技能：记录已见技能 + STAB 揭示属性
          if (lastAttacker === 'enemy' && usedMove) {
            revealFromEnemyMove(usedMove)
          }
        } else {
          currentMoveType = null
        }
        if (lastAttacker === 'player') {
          animClassPlayer = 'lunge-right'
        } else {
          animClassEnemy = 'lunge-left'
        }
        await delay(350)
        animClassPlayer = ''
        animClassEnemy = ''
        await delay(80)
        continue
      }

      // ---- 阶段2：受击抖动 + 技能特效 + 伤害数字 ----
      if (evt.type === 'damage') {
        const defender = lastAttacker === 'player' ? 'enemy' : 'player'
        await delay(80)

        // 触发属性特效（命中瞬间，挂在目标精灵容器上）
        if (currentMoveType) {
          const key = fxIdCounter++
          fx = [...fx, { type: currentMoveType, side: defender, key }]
          setTimeout(() => {
            fx = fx.filter(f => f.key !== key)
          }, 600)
        }

        // 伤害数字（物理/特殊系，变化系无伤害事件）
        if (evt.damage !== undefined && evt.damage > 0) {
          const dkey = dmgIdCounter++
          damageNumbers = [...damageNumbers, { id: dkey, amount: evt.damage, side: defender }]
          setTimeout(() => {
            damageNumbers = damageNumbers.filter(n => n.id !== dkey)
          }, 800)
        }

        if (defender === 'player') {
          animClassPlayer = 'hit'
          await delay(80)
          displayPlayerHp = Math.max(0, displayPlayerHp - (evt.damage ?? 0))
        } else {
          animClassEnemy = 'hit'
          await delay(80)
          displayEnemyHp = Math.max(0, displayEnemyHp - (evt.damage ?? 0))
        }
        await delay(350)
        animClassPlayer = ''
        animClassEnemy = ''
        await delay(150)
        continue
      }

      // ---- 阶段3：属性克制反馈（独立醒目文字）+ 属性揭示 ----
      // 免疫"没有效果"是 fail 类型（引擎 672 行），效果绝佳/不好是 effect 类型
      if ((evt.type === 'effect' || evt.type === 'fail') && (evt.message.includes('效果绝佳') || evt.message.includes('效果不太好') || evt.message.includes('没有效果'))) {
        const kind = evt.message.includes('效果绝佳') ? 'super' : evt.message.includes('效果不太好') ? 'weak' : 'none'
        const ekey = effIdCounter++
        effFeedback = { text: evt.message.replace('！', '').replace('…', ''), kind, key: ekey }
        setTimeout(() => {
          if (effFeedback?.key === ekey) effFeedback = null
        }, 900)

        // 敌方属性揭示：根据克制倍率反推敌方属性（仅我方攻击敌方时揭示敌方属性）
        // 效果绝佳(×2) → 敌方 2 倍弱点属性；效果不太好(×0.5) → 敌方 0.5 倍抵抗属性；没有效果(×0) → 敌方免疫属性
        // 免疫事件（fail）在引擎中先于"使用了"事件，且无 actionSide——用消息中的名字判断攻击方向
        if (displayEnemy) {
          let revealMoveType: Type | null = null
          if (kind === 'none') {
            // "对 XXX 没有效果…"：XXX 是被攻击方。免疫是我方技能打敌方 → 敌方名在消息中
            const isPlayerHitEnemy = evt.message.includes(displayEnemy.nameZh) && !evt.message.includes(playerActive?.nameZh ?? '____')
            if (isPlayerHitEnemy) {
              revealMoveType = playerSelectedMoveType
            }
          } else {
            // 效果绝佳/不好：仅我方攻击敌方时揭示（lastAttacker 由"使用了"事件维护）
            if (lastAttacker === 'player') {
              revealMoveType = currentMoveType
            }
          }
          if (revealMoveType) {
            if (kind === 'super') {
              revealTypesFromEffectiveness(revealMoveType, 2)
            } else if (kind === 'weak') {
              revealTypesFromEffectiveness(revealMoveType, 0.5)
            } else if (kind === 'none') {
              revealTypesFromEffectiveness(revealMoveType, 0)
            }
          }
        }
        await delay(700)
        continue
      }

      // ---- 回复效果 ----
      if (evt.type === 'heal') {
        const side = lastAttacker
        if (side === 'player') {
          await delay(100)
          displayPlayerHp = playerActive?.currentHp ?? 0
        } else {
          await delay(100)
          displayEnemyHp = enemyActive?.currentHp ?? 0
        }
        announceText = evt.message
        await delay(500)
        announceText = ''
        continue
      }

      // ---- 失败/无效信息 ----
      if (evt.type === 'fail') {
        announceText = evt.message
        await delay(600)
        announceText = ''
        continue
      }

      // ---- 倒下了（增强：旋转下沉 + 白色光爆） ----
      if (evt.message.includes('倒下了')) {
        await delay(200)
        announceText = evt.message
        const side = evt.actionSide ?? lastAttacker
        if (side === 'player') {
          animClassPlayer = 'faint'
        } else {
          animClassEnemy = 'faint'
        }
        // 白色光爆覆盖层
        const fkey = faintFxIdCounter++
        faintFx = { side, key: fkey }
        setTimeout(() => {
          if (faintFx?.key === fkey) faintFx = null
        }, 600)
        await delay(600)
        animClassPlayer = ''
        animClassEnemy = ''
        announceText = ''
        await delay(300)
        continue
      }

      // ---- 换人宣布（出场演出） ----
      if (evt.message.includes('派出') || evt.message.includes('替换上场') || evt.message.includes('收回了') || evt.message.includes('上吧！')) {
        await delay(200)
        announceText = evt.message
        // "收回了" 只显示文字，不切换显示精灵；其余为"新精灵登场"
        const isEnter = !evt.message.includes('收回了')
        if (isEnter) {
          let enterSide: 'player' | 'enemy'
          if (evt.actionSide) enterSide = evt.actionSide
          else if (evt.message.includes('上吧')) enterSide = 'player'
          else if (evt.message.includes('对方')) enterSide = 'enemy'
          else enterSide = lastAttacker === 'player' ? 'enemy' : 'player'
          // 此时才把显示快照切到新上场的宝可梦，并以满血登场（旧精灵的倒下动画已在前面播完）
          if (enterSide === 'player') {
            displayPlayer = playerActive
            displayPlayerHp = playerActive?.maxHp ?? 0
          } else {
            displayEnemy = enemyActive
            displayEnemyHp = enemyActive?.maxHp ?? 0
          }
          triggerEnterFx(enterSide)
        }
        await delay(500)
        announceText = ''
        await delay(200)
        continue
      }
    }
    } catch (e) {
      console.error('[animateEvents] 动画处理异常，已恢复:', e)
      announceText = ''
      animClassPlayer = ''
      animClassEnemy = ''
      currentMoveType = null
      playerSelectedMoveType = null
    }

    // ---- 动画全部结束 ----
    await delay(150)
    announceText = ''
    animClassPlayer = ''
    animClassEnemy = ''
    currentMoveType = null
    playerSelectedMoveType = null

    // 同步最终 HP 与显示快照（防止事件遗漏）
    displayPlayer = playerActive
    displayEnemy = enemyActive
    displayPlayerHp = playerActive?.currentHp ?? 0
    displayEnemyHp = enemyActive?.currentHp ?? 0

    // 标记动画结束，UI 按需显示弹窗（切换/结果）
    animating = false
  }

  /** 触发宝可梦出场演出（sprite-enter + 精灵球白光环） */
  function triggerEnterFx(side: 'player' | 'enemy') {
    const key = enterFxIdCounter++
    enterFx = { side, key }
    setTimeout(() => {
      if (enterFx?.key === key) enterFx = null
    }, 700)
  }

  // ===== 敌方信息揭示工具（TASK-2） =====

  /**
   * 根据克制结果反推敌方属性并揭示。
   * 原理：对技能属性 atk，遍历敌方真实属性 t，若 getTypeEffectiveness(atk, [t, null]) 命中期望倍率，
   * 则该属性就是被揭示的属性。这是"揭示对应属性"的精确实现——只揭示真实存在的属性。
   */
  function revealTypesFromEffectiveness(moveType: Type, expectedMult: number) {
    const realTypes = [displayEnemy?.types[0], displayEnemy?.types[1]].filter(Boolean) as Type[]
    const matched = realTypes.filter(t => getTypeEffectiveness(moveType, [t, null]) === expectedMult)
    if (matched.length === 0) return
    const next = new Set(revealedTypes)
    for (const m of matched) next.add(m)
    revealedTypes = next
  }

  /** 敌方使用技能：记录已见技能 + STAB 揭示属性 */
  function revealFromEnemyMove(move: Move | undefined) {
    if (!move) return
    enemySeenMoves = new Set([...enemySeenMoves, move.name])
    // STAB：敌方使用的技能属性与其真实属性一致 → 揭示该属性
    const realTypes = [displayEnemy?.types[0], displayEnemy?.types[1]].filter(Boolean) as Type[]
    if (realTypes.includes(move.type)) {
      const next = new Set(revealedTypes)
      next.add(move.type)
      revealedTypes = next
    }
  }

  /** 敌方属性是否全部揭示 */
  let allEnemyTypesRevealed = $derived(
    displayEnemy !== null &&
    [displayEnemy.types[0], displayEnemy.types[1]].filter(Boolean).every(t => revealedTypes.has(t as Type))
  )

  function handleSwitch(index: number) {
    battleStore.switchPokemon(index)
  }

  // ===== 主动换人（战斗中消耗当回合行动） =====

  function openSwitchMenu() {
    if (animating || result !== 'playing') return
    if (!playerActive) return
    showSwitchMenu = true
  }

  function confirmActiveSwitch(index: number) {
    if (animating || result !== 'playing') return
    const target = playerTeam[index]
    if (!target || target.fainted || target.id === playerActive?.id) return

    showSwitchMenu = false
    // 记录换人前 HP，动画过程中逐步更新
    displayPlayerHp = playerActive?.currentHp ?? 0
    displayEnemyHp = enemyActive?.currentHp ?? 0

    // 换人演出分两步：
    // 1. 旧精灵退场（switch-out，280ms）
    // 2. 执行换人回合（引擎同步换人 + 敌方行动），随后 animateEvents 播放入场与后续事件
    const oldActive = playerActive
    animating = true
    animClassPlayer = 'switch-out'
    delay(280).then(() => {
      animClassPlayer = ''
      if (!oldActive || oldActive.fainted) return

      suppressHpSync = true
      const events = battleStore.executeSwitch(index)
      suppressHpSync = false
      if (!events || events.length === 0) {
        animating = false
        return
      }
      animateEvents(events)
    })
  }

  function onBattleEnd() {
    if (simulator) {
      gameStore.setPhase('simulator_setup')
      return
    }
    if (result === 'player_win') {
      if (floor >= 20) {
        gameStore.endRun(true)
      } else {
        gameStore.setPhase('reward_exchange')
      }
    } else {
      gameStore.endRun(false)
    }
  }

  // ======== 模拟器编辑功能 ========

  function editAbility(side: 'player' | 'enemy') {
    pickerState = { side, type: 'ability' }
  }

  function editMove(side: 'player' | 'enemy', slot: number) {
    pickerState = { side, type: 'move', slot }
  }

  function handlePickerSelect(item: any) {
    if (!pickerState) return
    const { side, type, slot } = pickerState
    const pkm = side === 'player' ? playerActive : enemyActive
    if (!pkm) return

    if (type === 'ability') {
      pkm.ability = item as Ability
    } else if (type === 'move' && slot !== undefined) {
      pkm.moves[slot] = item as Move
    }
    pickerState = null
  }

  // ======== UI 工具函数 ========

  function hpPercent(pkm: RecombinedPokemon | null): number {
    if (!pkm) return 0
    return (pkm.currentHp / pkm.maxHp) * 100
  }

  function typeColor(t: string | null | undefined): string {
    if (!t) return '#888'
    return TYPE_COLORS[t as keyof typeof TYPE_COLORS] ?? '#888'
  }

  function catZh(cat: string): string {
    return ({ physical: '物理', special: '特殊', status: '变化' })[cat] ?? cat
  }

  let tooltipMove = $state<Move | null>(null)
  let tooltipPos = $state({ x: 0, y: 0 })

  function showTooltip(move: Move, e: MouseEvent) {
    tooltipMove = move
    tooltipPos = { x: e.clientX, y: e.clientY }
  }
  function hideTooltip() {
    tooltipMove = null
  }

  const STAT_LABELS: Record<string, string> = {
    attack: '攻击', defense: '防御', spAttack: '特攻', spDefense: '特防', speed: '速度', accuracy: '命中', evasion: '闪避',
  }

  function statStageText(stage: number): string {
    if (stage === 0) return '±0'
    return stage > 0 ? `+${stage}` : `${stage}`
  }

  let statusTab = $state<'player' | 'enemy'>('player')

  function hpColor(pkm: RecombinedPokemon | null): string {
    if (!pkm) return '#888'
    const pct = pkm.currentHp / pkm.maxHp
    return pct > 0.5 ? 'var(--success)' : pct > 0.25 ? 'var(--warning)' : 'var(--danger)'
  }

  // 模拟器侧：选中宝可梦的能力概况
  function abilitySublabel(a: Ability): string { return a.description.slice(0, 25) }
  function moveSublabel(m: Move): string {
    return `[${getTypeZh(m.type)}] 威力:${m.power || '-'} 命中:${m.accuracy}`
  }
  function speciesLabel(s: any): string {
    return `#${String(s.dexId).padStart(3, '0')} ${s.nameZh}`
  }
  function speciesSublabel(s: any): string {
    return s.types.filter(Boolean).map((t: string) => getTypeZh(t)).join(' / ')
  }
</script>

<div class="battle-scene">
  <div class="hud">
    {#if simulator}
      <span class="sim-badge">⚙ 模拟器</span>
      <button class="status-btn" onclick={() => gameStore.setPhase('simulator_setup')}>← 返回配置</button>
    {:else}
      <span class="floor">楼层 {floor}/20{isBoss ? ' ⚠ BOSS' : ''}</span>
    {/if}
    <button class="status-btn" onclick={() => showStatus = !showStatus}>战局</button>
  </div>

  <div class="battle-field">
    <!-- 场地背景草地 -->
    <div class="field-bg"></div>
    <!-- 天气视觉层（降雨/日照/沙暴/冰雹动态特效） -->
    <BattleWeather weather={weather} />

    <div class="enemy-row">
      <div class="enemy-hp-area">
        <div class="hp-block">
          <div class="pkm-name">{displayEnemy?.nameZh ?? '???'}<span class="pkm-level">Lv.50</span></div>
          <!-- 敌方属性逐步揭示：未揭示显示 ???（模拟器模式始终显示全部） -->
          <div class="types">
            {#if displayEnemy && (simulator || allEnemyTypesRevealed)}
              {#each [displayEnemy.types[0], displayEnemy.types[1]].filter(Boolean) as t}
                <span class="type-badge" style="background: {typeColor(t)}">{getTypeZh(t)}</span>
              {/each}
            {:else if displayEnemy}
              {#each [displayEnemy.types[0], displayEnemy.types[1]] as t, i (i)}
                {#if t && revealedTypes.has(t)}
                  <span class="type-badge" style="background: {typeColor(t)}">{getTypeZh(t)}</span>
                {:else}
                  <span class="type-badge type-badge-unknown">???</span>
                {/if}
              {/each}
            {/if}
          </div>
          {#if displayEnemy}
            <button class="ability-line" disabled={!simulator} onclick={() => simulator && editAbility('enemy')}>
              <!-- 敌方特性逐步揭示：触发后常驻显示真实特性 -->
              {#if enemyAbilityRevealed || simulator}
                <span class="ability-name">{abilityLabel(displayEnemy.ability.name, displayEnemy.ability.nameZh)}</span>
              {:else}
                <span class="ability-name ability-unknown">???</span>
              {/if}
              {#if simulator}<span class="edit-hint">✎</span>{/if}
            </button>
          {/if}
          <!-- 敌方已使用技能记录（名称 + 属性徽章） -->
          {#if displayEnemy && enemySeenMoves.size > 0}
            <div class="enemy-seen-moves">
              {#each [...enemySeenMoves] as moveName}
                {@const seenMove = displayEnemy.moves.find(m => m.name === moveName)}
                {#if seenMove}
                  <span class="seen-move">
                    <span class="seen-move-type" style="background: {typeColor(seenMove.type)}"></span>
                    {moveLabel(seenMove.name, seenMove.nameZh)}
                  </span>
                {/if}
              {/each}
            </div>
          {/if}
          <div class="hp-bar-wrap">
            <div class="hp-bar">
              <div class="hp-fill {displayEnemy ? (displayEnemyHp / displayEnemy.maxHp > 0.5 ? 'high' : displayEnemyHp / displayEnemy.maxHp > 0.25 ? 'mid' : 'low') : 'high'}" style="width: {displayEnemy ? (displayEnemyHp / displayEnemy.maxHp) * 100 : 0}%"></div>
              <span class="hp-text">{displayEnemyHp}/{displayEnemy?.maxHp ?? 0}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="enemy-sprite-area">
        <div class="ground-shadow"></div>
        <div class="sprite-wrap">
          {#if displayEnemy}
            <img
              class="sprite-img enemy-sprite {animClassEnemy}"
              class:enter-anim={enterFx?.side === 'enemy'}
              src="/sprites/{displayEnemy.dexId}.png"
              alt={displayEnemy.nameZh}
              onerror={(e) => (e.target as HTMLImageElement).style.display = 'none'}
            />
          {/if}
          {#if enterFx?.side === 'enemy'}
            <div class="fx-pokeball-ring" style="--fx-color: #fff"></div>
          {/if}
          {#each fx.filter(f => f.side === 'enemy') as f (f.key)}
            <BattleFx type={f.type} side="enemy" key={f.key} />
          {/each}
          {#if faintFx?.side === 'enemy'}
            <div class="fx-faint-flash" style="--fx-color: #fff"></div>
          {/if}
          {#each damageNumbers.filter(n => n.side === 'enemy') as n (n.id)}
            <div class="dmg-num dmg-enemy">{n.amount}</div>
          {/each}
        </div>
      </div>
    </div>

    <div class="player-row">
      <div class="player-sprite-area">
        <div class="ground-shadow"></div>
        <div class="sprite-wrap">
          {#if displayPlayer}
            <img
              class="sprite-img player-sprite {animClassPlayer}"
              class:enter-anim={enterFx?.side === 'player'}
              src="/sprites/back/{displayPlayer.dexId}.png"
              alt={displayPlayer.nameZh}
              onerror={(e) => (e.target as HTMLImageElement).style.display = 'none'}
            />
          {/if}
          {#if enterFx?.side === 'player'}
            <div class="fx-pokeball-ring" style="--fx-color: #fff"></div>
          {/if}
          {#each fx.filter(f => f.side === 'player') as f (f.key)}
            <BattleFx type={f.type} side="player" key={f.key} />
          {/each}
          {#if faintFx?.side === 'player'}
            <div class="fx-faint-flash" style="--fx-color: #fff"></div>
          {/if}
          {#each damageNumbers.filter(n => n.side === 'player') as n (n.id)}
            <div class="dmg-num dmg-player">{n.amount}</div>
          {/each}
        </div>
      </div>
      <div class="player-hp-area">
        <div class="hp-block">
          <div class="pkm-name">{displayPlayer?.nameZh ?? '???'}<span class="pkm-level">Lv.50</span></div>
          <div class="types">
            {#each [displayPlayer?.types[0], displayPlayer?.types[1]].filter(Boolean) as t}
              <span class="type-badge" style="background: {typeColor(t)}">{getTypeZh(t)}</span>
            {/each}
          </div>
          {#if displayPlayer}
            <button class="ability-line" disabled={!simulator} onclick={() => simulator && editAbility('player')}>
              <span class="ability-name">{abilityLabel(displayPlayer.ability.name, displayPlayer.ability.nameZh)}</span>
              {#if simulator}<span class="edit-hint">✎</span>{/if}
            </button>
          {/if}
          <div class="hp-bar-wrap">
            <div class="hp-bar">
              <div class="hp-fill {displayPlayer ? (displayPlayerHp / displayPlayer.maxHp > 0.5 ? 'high' : displayPlayerHp / displayPlayer.maxHp > 0.25 ? 'mid' : 'low') : 'high'}" style="width: {displayPlayer ? (displayPlayerHp / displayPlayer.maxHp) * 100 : 0}%"></div>
              <span class="hp-text">{displayPlayerHp}/{displayPlayer?.maxHp ?? 0}</span>
            </div>
          </div>
          <!-- EXP 条（占位，后续对接经验值系统） -->
          <div class="exp-bar-wrap">
            <div class="exp-bar"><div class="exp-fill" style="width: 0%"></div></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 场地信息 -->
    {#if weather !== 'none'}
      <div class="weather-indicator">
        {#if weather === 'sun'}☀️ 大晴天
        {:else if weather === 'rain'}🌧️ 下雨
        {:else if weather === 'sandstorm'}🌪️ 沙暴
        {:else if weather === 'hail'}❄️ 冰雹
        {/if}
      </div>
    {/if}

    <!-- 中央消息 -->
    {#if announceText}
      <div class="announce-box">
        <span class="announce-text">{announceText}</span>
      </div>
    {/if}

    <!-- 属性克制文字反馈（醒目特效） -->
    {#if effFeedback}
      {#key effFeedback.key}
        <div class="eff-feedback eff-{effFeedback.kind}">
          {effFeedback.text}
        </div>
      {/key}
    {/if}

    <!-- 特性触发通知 -->
    <div class="ability-notifs">
      {#each abilityNotifs as notif (notif.id)}
        <div class="ability-notif notif-{notif.side}">{notif.message}</div>
      {/each}
    </div>
  </div>

  <div class="bottom-bar">
    <div class="log">
      {#each log as msg}
        <div class="log-entry">{msg}</div>
      {/each}
    </div>

    {#if result === 'playing' || animating}
      <div class="menu">
      <div class="moves">
        {#each playerActive?.moves ?? [] as move, i}
          <div class="move-btn-wrap">
            <button
              class="move-btn"
              disabled={animating || move.currentPp <= 0}
              onclick={() => useMove(i)}
              onmouseenter={(e) => showTooltip(move, e)}
              onmouseleave={hideTooltip}
            >
              <span class="move-name">{moveLabel(move.name, move.nameZh)}</span>
              <span class="move-type" style="background: {typeColor(move.type)}">{getTypeZh(move.type)}</span>
              <span class="move-pp">PP {move.currentPp}/{move.pp}</span>
            </button>
            {#if simulator}
              <button class="move-edit-btn" onclick={() => editMove('player', i)} title="替换技能">✎</button>
            {/if}
          </div>
        {/each}
        <!-- 主动换人按钮（战斗中消耗当回合行动） -->
        <button
          class="move-btn switch-btn"
          disabled={animating || !playerActive || playerTeam.filter(p => !p.fainted && p.id !== playerActive?.id).length === 0}
          onclick={openSwitchMenu}
        >
          <span class="move-name">换人</span>
          <span class="move-type switch-icon">⇄</span>
        </button>
      </div>
    </div>

    {#if tooltipMove}
      <div class="move-tooltip" style="left: {Math.min(tooltipPos.x, window.innerWidth - 320)}px; top: {tooltipPos.y}px;">
        <div class="tt-header">
          <span class="tt-name">{tooltipMove.nameZh}</span>
          <span class="tt-type" style="background: {typeColor(tooltipMove.type)}">{getTypeZh(tooltipMove.type)}</span>
          <span class="tt-category">{catZh(tooltipMove.category)}</span>
        </div>
        <div class="tt-stats">
          <span>威力: {tooltipMove.power || '-'}</span>
          <span>命中: {tooltipMove.accuracy}%</span>
          <span>PP: {tooltipMove.pp}</span>
          {#if tooltipMove.priority !== 0}
            <span>先制度: {tooltipMove.priority}</span>
          {/if}
        </div>
        {#if tooltipMove.description}
          <div class="tt-desc">{tooltipMove.description}</div>
        {/if}
      </div>
    {/if}
  {:else if !animating}
    <div class="result-overlay">
      <div class="result-text">{result === 'player_win' ? '胜利！' : '败北…'}</div>
      <button class="result-btn" onclick={onBattleEnd}>
        {simulator ? '返回配置' : result === 'player_win' ? '继续' : '返回标题'}
      </button>
    </div>
  {/if}
  </div>

  {#if needsSwitch && !animating}
    <div class="switch-overlay">
      <div class="switch-panel">
        <h3>选择上场的宝可梦</h3>
        <div class="switch-options">
          {#each playerTeam as pkm, i}
            <button
              class="switch-card"
              disabled={pkm.fainted}
              onclick={() => handleSwitch(i)}
            >
              <img class="switch-sprite" src="/sprites/{pkm.dexId}.png" alt={pkm.nameZh} onerror={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
              <div class="switch-info">
                <div class="switch-name">{pkm.nameZh}</div>
                <div class="switch-types">
                  {#each [pkm.types[0], pkm.types[1]].filter(Boolean) as t}
                    <span class="type-badge" style="background: {typeColor(t)}">{getTypeZh(t)}</span>
                  {/each}
                </div>
                <div class="switch-hp">HP {pkm.currentHp}/{pkm.maxHp}</div>
                {#if pkm.fainted}
                  <div class="switch-faint">已倒下</div>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  {#if showSwitchMenu && !animating}
    <div class="switch-overlay">
      <div class="switch-panel">
        <h3>主动换人（消耗本回合行动）</h3>
        <div class="switch-options">
          {#each playerTeam as pkm, i}
            <button
              class="switch-card"
              class:active-switch={pkm.id === playerActive?.id}
              disabled={pkm.fainted || pkm.id === playerActive?.id}
              onclick={() => confirmActiveSwitch(i)}
            >
              <img class="switch-sprite" src="/sprites/{pkm.dexId}.png" alt={pkm.nameZh} onerror={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
              <div class="switch-info">
                <div class="switch-name">{pkm.nameZh}</div>
                <div class="switch-types">
                  {#each [pkm.types[0], pkm.types[1]].filter(Boolean) as t}
                    <span class="type-badge" style="background: {typeColor(t)}">{getTypeZh(t)}</span>
                  {/each}
                </div>
                <div class="switch-hp">HP {pkm.currentHp}/{pkm.maxHp}</div>
                {#if pkm.fainted}
                  <div class="switch-faint">已倒下</div>
                {:else if pkm.id === playerActive?.id}
                  <div class="switch-faint">在场中</div>
                {/if}
              </div>
            </button>
          {/each}
        </div>
        <button class="switch-cancel" onclick={() => showSwitchMenu = false}>取消</button>
      </div>
    </div>
  {/if}

  {#if showStatus}
    <div class="status-overlay" onclick={() => showStatus = false} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showStatus = false)}>
      <div class="status-panel" onclick={(e) => e.stopPropagation()} role="presentation" onkeydown={(e) => e.stopPropagation()}>
        <div class="sp-layout">
          <div class="sp-side">
            <div class="sp-side-title">我方</div>
            {#each playerTeam as pkm, i}
              <div class="sp-side-card" class:active={pkm.id === playerActive?.id} class:fainted={pkm.fainted}>
                <img class="sp-side-sprite" src="/sprites/{pkm.dexId}.png" alt={pkm.nameZh} onerror={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
                <div class="sp-side-name">{pkm.nameZh}</div>
                <div class="sp-side-bar"><div class="sp-side-fill" style="width: {hpPercent(pkm)}%; background: {hpColor(pkm)}"></div></div>
                <div class="sp-side-hp">{pkm.currentHp}/{pkm.maxHp}</div>
                {#if pkm.fainted}<div class="sp-side-tag faint">倒</div>{/if}
                {#if pkm.id === playerActive?.id}<div class="sp-side-tag active">场</div>{/if}
              </div>
            {/each}
          </div>

          <div class="sp-center">
            <div class="sp-tabs">
              <button class="sp-tab" class:active={statusTab === 'player'} onclick={() => statusTab = 'player'}>我方</button>
              <button class="sp-tab" class:active={statusTab === 'enemy'} onclick={() => statusTab = 'enemy'}>敌方</button>
            </div>

            {#if statusTab === 'player'}
              {@const active = playerActive}
              {#if active && !active.fainted}
                <div class="sp-detail">
                  <div class="sp-detail-header">
                    <span class="sp-detail-name">{active.nameZh}</span>
                    <span class="sp-detail-ability">{abilityLabel(active.ability.name, active.ability.nameZh)}</span>
                  </div>
                  <div class="sp-detail-types">
                    {#each [active.types[0], active.types[1]].filter(Boolean) as t}
                      <span class="type-badge" style="background: {typeColor(t)}">{getTypeZh(t)}</span>
                    {/each}
                  </div>
                  <div class="sp-detail-bar"><div class="sp-detail-fill" style="width: {hpPercent(active)}%; background: {hpColor(active)}"></div></div>
                  <div class="sp-detail-hp">HP {active.currentHp}/{active.maxHp}</div>
                  {#if active.status}
                    <div class="sp-detail-status">状态: {active.status}</div>
                  {/if}
                </div>
                <div class="sp-section">
                  <div class="sp-section-title">能力变化</div>
                  <div class="sp-stages-grid">
                    {#each Object.entries(STAT_LABELS) as [key, label]}
                      {@const val = active.statStages[key as keyof typeof active.statStages]}
                      <div class="sp-stage-row">
                        <span class="sp-stage-label">{label}</span>
                        <span class="sp-stage-val" class:up={val > 0} class:down={val < 0}>
                          {val > 0 ? '↑' : val < 0 ? '↓' : ''}{Math.abs(val)}
                        </span>
                      </div>
                    {/each}
                  </div>
                </div>
              {:else}
                <div class="sp-detail sp-detail-empty">已倒下</div>
              {/if}
            {:else}
              {@const active = enemyActive}
              {#if active && !active.fainted}
                <div class="sp-detail">
                  <div class="sp-detail-header">
                    <span class="sp-detail-name">{active.nameZh}</span>
                    <!-- 敌方特性逐步揭示 -->
                    {#if enemyAbilityRevealed || simulator}
                      <span class="sp-detail-ability">{abilityLabel(active.ability.name, active.ability.nameZh)}</span>
                    {:else}
                      <span class="sp-detail-ability ability-unknown">???</span>
                    {/if}
                  </div>
                  <div class="sp-detail-types">
                    <!-- 敌方属性逐步揭示 -->
                    {#if simulator || allEnemyTypesRevealed}
                      {#each [active.types[0], active.types[1]].filter(Boolean) as t}
                        <span class="type-badge" style="background: {typeColor(t)}">{getTypeZh(t)}</span>
                      {/each}
                    {:else}
                      {#each [active.types[0], active.types[1]] as t, i (i)}
                        {#if t && revealedTypes.has(t)}
                          <span class="type-badge" style="background: {typeColor(t)}">{getTypeZh(t)}</span>
                        {:else}
                          <span class="type-badge type-badge-unknown">???</span>
                        {/if}
                      {/each}
                    {/if}
                  </div>
                  <div class="sp-detail-bar"><div class="sp-detail-fill" style="width: {hpPercent(active)}%; background: {hpColor(active)}"></div></div>
                  <div class="sp-detail-hp">HP {active.currentHp}/{active.maxHp}</div>
                </div>
                <div class="sp-section">
                  <div class="sp-section-title">能力变化</div>
                  <div class="sp-stages-grid">
                    {#each Object.entries(STAT_LABELS) as [key, label]}
                      {@const val = active.statStages[key as keyof typeof active.statStages]}
                      <div class="sp-stage-row">
                        <span class="sp-stage-label">{label}</span>
                        <span class="sp-stage-val" class:up={val > 0} class:down={val < 0}>
                          {val > 0 ? '↑' : val < 0 ? '↓' : ''}{Math.abs(val)}
                        </span>
                      </div>
                    {/each}
                  </div>
                </div>
              {:else}
                <div class="sp-detail sp-detail-empty">已倒下</div>
              {/if}
            {/if}

            <div class="sp-section">
              <div class="sp-section-title">场地信息</div>
              {#if battleStore}
                <!-- 空白，留待后续 -->
              {/if}
            </div>
          </div>

          <div class="sp-side">
            <div class="sp-side-title">敌方</div>
            {#each enemyTeam as pkm, i}
              <div class="sp-side-card" class:active={pkm.id === enemyActive?.id} class:fainted={pkm.fainted}>
                <img class="sp-side-sprite" src="/sprites/{pkm.dexId}.png" alt={pkm.nameZh} onerror={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
                <div class="sp-side-name">{pkm.nameZh}</div>
                <div class="sp-side-bar"><div class="sp-side-fill" style="width: {hpPercent(pkm)}%; background: {hpColor(pkm)}"></div></div>
                <div class="sp-side-hp">{pkm.currentHp}/{pkm.maxHp}</div>
                {#if pkm.fainted}<div class="sp-side-tag faint">倒</div>{/if}
                {#if pkm.id === enemyActive?.id}<div class="sp-side-tag active">场</div>{/if}
              </div>
            {/each}
          </div>
        </div>
        <button class="sp-close" onclick={() => showStatus = false}>关闭</button>
      </div>
    </div>
  {/if}
</div>

<!-- 模拟器搜索弹窗 -->
{#if pickerState}
  {#if pickerState.type === 'ability'}
    <SearchPicker
      items={ABILITY_DB}
      label={(a: Ability) => a.nameZh}
      sublabel={abilitySublabel}
      searchPlaceholder="搜索特性..."
      onselect={handlePickerSelect}
      onclose={() => pickerState = null}
    />
  {:else if pickerState.type === 'move'}
    <SearchPicker
      items={MOVE_DB}
      label={(m: Move) => m.nameZh}
      sublabel={moveSublabel}
      searchPlaceholder="搜索技能..."
      onselect={handlePickerSelect}
      onclose={() => pickerState = null}
    />
  {/if}
{/if}

<style>
  .battle-scene {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, #0b0f1e 0%, #0e1428 55%, #101a30 100%);
    position: relative;
  }
  .hud {
    padding: 10px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(10, 13, 24, 0.55);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
    z-index: 5;
  }
  .floor {
    color: var(--text-secondary);
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 1px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  }
  .sim-badge {
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 1px;
  }
  /* ===== 2D 经典视角弹性布局 ===== */
  .battle-field {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 4px 14px;
    position: relative;
    overflow: hidden;
    min-height: 0;
  }
  /* ===== 场地背景（PokéRogue 式深色天空 + 暗色场地） ===== */
  .field-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background:
      radial-gradient(640px 320px at 72% 26%, rgba(74, 158, 255, 0.12), transparent 62%),
      radial-gradient(520px 280px at 26% 18%, rgba(245, 166, 35, 0.07), transparent 60%),
      linear-gradient(180deg, #0b0f1e 0%, #0f1830 46%, #16233f 68%, #101a2e 100%);
  }
  /* 场地地面（伪元素，不依赖模板） */
  .field-bg::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 34%;
    background:
      radial-gradient(720px 220px at 50% 100%, rgba(62, 207, 110, 0.09), transparent 70%),
      linear-gradient(180deg, rgba(46, 74, 96, 0.16) 0%, rgba(24, 40, 56, 0.38) 100%);
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }
  /* ===== 精灵阴影椭圆 ===== */
  .enemy-row, .player-row {
    padding: 0 10%;
    display: flex;
    justify-content: center;
    gap: 40px;
    align-items: flex-start;
    position: relative;
    z-index: 1;
  }
  .player-row {
    align-items: flex-end;
    margin-top: -300px;
  }
  .enemy-hp-area, .player-hp-area {
    flex-shrink: 0;
  }
  .sprite-wrap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2;
  }
  .enemy-sprite-area .sprite-wrap {
    width: 520px;
    height: 520px;
    max-width: 55vh;
    max-height: 55vh;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .player-sprite-area .sprite-wrap {
    width: 400px;
    height: 400px;
    max-width: 42vh;
    max-height: 42vh;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sprite-img {
    object-fit: contain;
    image-rendering: pixelated;
    transition: transform 0.15s ease;
    width: 100%;
    height: 100%;
  }
  /* 精灵阴影 */
  .ground-shadow {
    width: 110px;
    height: 26px;
    background: radial-gradient(ellipse, rgba(0,0,0,0.5) 0%, transparent 72%);
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1;
    pointer-events: none;
  }
  .sprite-img.lunge-right {
    animation: lunge-right 0.3s ease-in-out;
  }
  .sprite-img.lunge-left {
    animation: lunge-left 0.3s ease-in-out;
  }
  .sprite-img.hit {
    animation: shake 0.3s ease-in-out, flash 0.3s;
  }
  .sprite-img.faint {
    animation: faint-out 0.6s ease-in forwards;
  }
  /* 出场演出：sprite-enter（战斗开始/换人） */
  .sprite-img.enter-anim {
    animation: sprite-enter 0.55s var(--ease-out-back) both;
  }
  /* 主动换人：旧精灵退场（缩回精灵球） */
  .sprite-img.switch-out {
    animation: switch-out 0.28s ease-in forwards;
  }
  /* 精灵球白光环（出场瞬间） */
  .fx-pokeball-ring {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 46px;
    height: 46px;
    border-radius: 50%;
    border: 3px solid var(--fx-color, #fff);
    box-shadow: 0 0 18px var(--fx-color, #fff), inset 0 0 12px var(--fx-color, #fff);
    opacity: 0;
    pointer-events: none;
    z-index: 25;
    animation: pokeball-ring 0.6s ease-out forwards;
  }
  /* 倒下白色光爆覆盖层 */
  .fx-faint-flash {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.4) 40%, transparent 70%);
    opacity: 0;
    pointer-events: none;
    z-index: 24;
    animation: faint-flash 0.55s ease-out forwards;
  }
  /* 伤害数字（受击方上方弹出，物理/特殊伤害统一红色大号） */
  .dmg-num {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 30px;
    font-weight: 900;
    color: #ff4d4d;
    text-shadow: 0 0 12px rgba(255, 77, 77, 0.7), 0 2px 4px rgba(0,0,0,0.8);
    pointer-events: none;
    z-index: 40;
    font-family: 'Arial Black', 'Segoe UI', sans-serif;
    animation: dmg-pop 0.75s ease-out forwards;
  }
  .dmg-enemy {
    color: #ff4d4d;
  }
  .dmg-player {
    color: #ff4d4d;
  }
  /* 克制文字反馈 */
  .eff-feedback {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 60;
    pointer-events: none;
    font-weight: 900;
    white-space: nowrap;
    letter-spacing: 2px;
  }
  .eff-super {
    font-size: 40px;
    color: #ff8c42;
    text-shadow: 0 0 22px rgba(255, 140, 66, 0.85), 0 3px 6px rgba(0,0,0,0.85);
    animation: eff-super 0.9s ease-out forwards;
  }
  .eff-weak {
    font-size: 30px;
    color: #9fb4c8;
    text-shadow: 0 0 14px rgba(159, 180, 200, 0.6), 0 2px 4px rgba(0,0,0,0.8);
    animation: eff-weak 0.8s ease-out forwards;
  }
  .eff-none {
    font-size: 22px;
    color: #8a8f98;
    text-shadow: 0 0 10px rgba(138, 143, 152, 0.5), 0 2px 4px rgba(0,0,0,0.7);
    animation: eff-none 0.7s ease-out forwards;
  }
  .hp-block {
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    padding: 8px 16px 10px 20px;
    min-width: 460px;
    box-shadow: var(--shadow-md), var(--glass-shadow), inset 0 0 0 1px var(--glass-highlight);
  }
  .hp-block .pkm-name {
    font-weight: 700;
    font-size: 16px;
    color: var(--text-primary);
    display: inline;
    text-shadow: 0 1px 2px rgba(0,0,0,0.4);
  }
  .hp-block .pkm-level {
    font-size: 12px;
    color: var(--text-secondary);
    margin-left: 4px;
    font-weight: 600;
  }
  .hp-block .types {
    display: flex;
    gap: 3px;
    margin-bottom: 3px;
    margin-top: 2px;
  }
  .hp-block .type-badge {
    padding: 1px 7px;
    border-radius: var(--radius-pill);
    font-size: 11px;
    color: white;
    font-weight: 600;
    text-shadow: 0 1px 2px rgba(0,0,0,0.4);
    box-shadow: inset 0 -1px 0 rgba(0,0,0,0.25);
  }
  /* 敌方未揭示属性：灰色问号徽章 */
  .hp-block .type-badge-unknown {
    background: linear-gradient(135deg, rgba(96, 102, 116, 0.85), rgba(60, 66, 80, 0.85));
    color: rgba(255, 255, 255, 0.75);
    text-shadow: none;
    font-style: italic;
    letter-spacing: 1px;
    box-shadow: inset 0 -1px 0 rgba(0,0,0,0.3);
  }
  /* 敌方未揭示特性 */
  .hp-block .ability-unknown {
    color: var(--text-muted);
    font-style: italic;
    letter-spacing: 1px;
  }
  /* 敌方已见技能记录 */
  .hp-block .enemy-seen-moves {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 8px;
    margin-top: 2px;
    font-size: 10px;
    color: var(--text-secondary);
  }
  .hp-block .seen-move {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .hp-block .seen-move-type {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .hp-block .ability-line {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    padding: 1px 0;
    cursor: default;
    text-align: left;
    font-size: 11px;
  }
  .hp-block .ability-line:disabled { opacity: 1; }
  .hp-block .ability-line:not(:disabled) { cursor: pointer; }
  .hp-block .ability-line:not(:disabled):hover .ability-name { color: var(--accent); }
  .hp-block .ability-name { color: var(--text-secondary); font-size: 10px; }
  .hp-block .edit-hint { color: var(--accent); font-size: 11px; opacity: 0.7; margin-left: auto; }
  .hp-block .hp-bar-wrap {
    margin-top: 3px;
    position: relative;
  }
  .hp-block .hp-bar {
    height: 14px;
    background: var(--bg-inset);
    border-radius: 7px;
    overflow: hidden;
    min-height: 0;
    border: 1px solid rgba(255, 255, 255, 0.09);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
  }
  .hp-block .hp-fill {
    height: 100%;
    border-radius: 6px;
    transition: width 0.4s ease;
  }
  /* HP 条颜色（PokéRogue 式高饱和） */
  .hp-block .hp-fill.high { background: linear-gradient(180deg, #4ee07e 0%, #2ebd5e 100%); box-shadow: inset 0 -2px 0 rgba(0,0,0,0.18), 0 0 8px rgba(62, 207, 110, 0.35); }
  .hp-block .hp-fill.mid { background: linear-gradient(180deg, #ffc94d 0%, #f5a623 100%); box-shadow: inset 0 -2px 0 rgba(0,0,0,0.18), 0 0 8px rgba(245, 166, 35, 0.35); }
  .hp-block .hp-fill.low { background: linear-gradient(180deg, #ff7075 0%, #ff3b40 100%); box-shadow: inset 0 -2px 0 rgba(0,0,0,0.18), 0 0 10px rgba(255, 90, 95, 0.4); }
  .hp-block .hp-text {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 13px;
    color: #fff;
    font-weight: 700;
    text-shadow: 0 1px 3px rgba(0,0,0,0.8);
  }
  /* EXP 条（后续对接经验值） */
  .exp-bar-wrap { margin-top: 4px; }
  .exp-bar { height: 5px; background: var(--bg-inset); border-radius: 3px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06); }
  .exp-fill { height: 100%; background: linear-gradient(180deg, #6fb2ff 0%, #4a9eff 100%); border-radius: 3px; transition: width 0.3s; box-shadow: 0 0 6px rgba(74, 158, 255, 0.4); }
  .bottom-bar {
    display: flex;
    flex-direction: row-reverse;
    gap: 0;
    border-top: 1px solid var(--border);
    background: rgba(10, 13, 24, 0.88);
    backdrop-filter: blur(10px);
    box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.35);
    z-index: 4;
  }
  .log {
    width: 360px;
    flex-shrink: 0;
    padding: 6px 10px;
    background: rgba(9, 12, 22, 0.7);
    border-left: 1px solid var(--border);
    max-height: 120px;
    overflow-y: auto;
  }
  .log-entry {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.3;
    animation: fade-in 0.2s;
  }
  .log-entry + .log-entry {
    margin-top: 2px;
  }
  .menu {
    flex: 1;
    padding: 10px 14px;
  }
  .moves { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .move-btn-wrap { display: flex; gap: 4px; }
  .move-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 13px 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    cursor: pointer;
    box-shadow: var(--glass-shadow), inset 0 0 0 1px var(--glass-highlight);
    transition: border-color var(--transition-fast), background var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
  }
  .move-btn:hover:not(:disabled) {
    border-color: var(--border-accent);
    background: var(--bg-hover);
    transform: translateY(-2px);
    box-shadow: var(--shadow-glow), var(--shadow-sm), inset 0 0 0 1px var(--glass-highlight);
  }
  .move-btn:active:not(:disabled) { transform: translateY(0) scale(0.99); }
  .move-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .move-edit-btn {
    width: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px dashed var(--border-hover);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    transition: all 0.2s;
    flex-shrink: 0;
  }
  .move-edit-btn:hover { border-color: var(--accent); color: var(--accent); border-style: solid; }
  .move-name { flex: 1; font-size: 16px; }
  .move-type { padding: 2px 8px; border-radius: var(--radius-pill); font-size: 11px; color: white; text-transform: capitalize; box-shadow: inset 0 -1px 0 rgba(0,0,0,0.25); }
  .move-pp { font-size: 12px; color: var(--text-muted); }
  .move-edit-hint { font-size: 11px; }
  .result-overlay {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: rgba(8, 10, 18, 0.78);
    backdrop-filter: blur(8px);
    z-index: 20;
  }
  .result-text {
    font-size: 42px;
    font-weight: bold;
    margin-bottom: 22px;
    letter-spacing: 6px;
    color: var(--accent);
    text-shadow: 0 0 24px var(--accent-glow), 0 2px 4px rgba(0,0,0,0.6);
    animation: pop-in 0.4s var(--ease-out-back) both;
  }
  .result-btn {
    padding: 12px 38px; font-size: 18px;
    border: 2px solid var(--border-accent);
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    color: var(--accent); border-radius: var(--radius-md); cursor: pointer;
    letter-spacing: 2px;
    box-shadow: var(--shadow-md), var(--glass-shadow);
    transition: all var(--transition-fast);
  }
  .result-btn:hover { background: var(--accent-gradient); color: var(--text-on-accent); border-color: var(--accent-hover); transform: translateY(-2px); box-shadow: var(--shadow-glow), var(--shadow-md); }
  .status-btn {
    padding: 4px 14px;
    border: 1px solid var(--border-hover);
    border-radius: var(--radius-sm);
    font-size: 15px;
    color: var(--text-secondary);
    cursor: pointer;
    background: rgba(20, 26, 44, 0.6);
    transition: all var(--transition-fast);
  }
  .status-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .status-overlay {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(6, 8, 16, 0.72);
    backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    animation: fade-in 0.2s ease;
  }
  .status-panel {
    background: var(--glass-bg-strong);
    backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    padding: 14px;
    max-width: 920px;
    width: 95%;
    max-height: 92vh;
    box-shadow: var(--shadow-lg), var(--glass-shadow), inset 0 0 0 1px var(--glass-highlight);
    animation: pop-in-soft 0.25s var(--ease-out-back) both;
  }
  .sp-layout { display: flex; gap: 10px; height: 100%; }
  .sp-side { width: 160px; flex-shrink: 0; }
  .sp-side-title { font-size: 14px; color: var(--text-muted); text-align: center; margin-bottom: 6px; letter-spacing: 2px; }
  .sp-side-card {
    background: rgba(29, 36, 64, 0.6);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    margin-bottom: 6px;
    position: relative;
    transition: border-color var(--transition-fast);
  }
  .sp-side-card.active { border-color: var(--border-accent); box-shadow: 0 0 12px rgba(245,166,35,0.15); }
  .sp-side-card.fainted { opacity: 0.4; }
  .sp-side-sprite { width: 64px; height: 64px; object-fit: contain; image-rendering: pixelated; display: block; margin: 0 auto 2px; }
  .sp-side-name { font-size: 14px; font-weight: 600; overflow: hidden;
    min-height: 0; text-overflow: ellipsis; white-space: nowrap; }
  .sp-side-bar { height: 8px; background: var(--bg-inset); border-radius: 4px; overflow: hidden;
    min-height: 0; margin: 2px 0; box-shadow: inset 0 1px 2px rgba(0,0,0,0.5); }
  .sp-side-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .sp-side-hp { font-size: 13px; color: var(--text-muted); }
  .sp-side-tag { position: absolute; top: 2px; right: 2px; font-size: 9px; padding: 0 3px; border-radius: 2px; font-weight: 600; }
  .sp-side-tag.active { background: var(--accent); color: var(--text-on-accent); }
  .sp-side-tag.faint { background: var(--danger); color: white; }
  .sp-center { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .sp-tabs { display: flex; gap: 4px; }
  .sp-tab {
    flex: 1; padding: 5px; font-size: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  .sp-tab:hover { border-color: var(--border-hover); color: var(--text-secondary); }
  .sp-tab.active { border-color: var(--border-accent); color: var(--accent); background: var(--accent-soft); }
  .sp-detail { background: rgba(29, 36, 64, 0.6); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 8px 10px; }
  .sp-detail-empty { text-align: center; color: var(--text-muted); padding: 20px; }
  .sp-detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .sp-detail-name { font-size: 16px; font-weight: 600; }
  .sp-detail-ability { font-size: 14px; color: var(--text-muted); }
  .sp-detail-types { display: flex; gap: 3px; margin-bottom: 4px; }
  .sp-detail-bar { height: 14px; background: var(--bg-inset); border-radius: 7px; overflow: hidden;
    min-height: 0; margin-bottom: 2px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.5); }
  .sp-detail-fill { height: 100%; border-radius: 7px; transition: width 0.3s; }
  .sp-detail-hp { font-size: 12px; color: var(--text-secondary); }
  .sp-detail-status { font-size: 11px; color: var(--danger); margin-top: 2px; }
  .sp-section { flex: 1; background: rgba(29, 36, 64, 0.6); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 6px 8px; }
  .sp-section-title { font-size: 14px; color: var(--text-muted); margin-bottom: 4px; letter-spacing: 2px; }
  .sp-stages-grid { display: flex; flex-direction: column; gap: 2px; }
  .sp-stage-row { display: flex; justify-content: space-between; align-items: center; }
  .sp-stage-label { font-size: 11px; color: var(--text-secondary); }
  .sp-stage-val { font-size: 14px; font-weight: 600; min-width: 28px; text-align: right; }
  .sp-stage-val.up { color: var(--success); }
  .sp-stage-val.down { color: var(--danger); }
  .sp-close { display: block; margin: 12px auto 0; padding: 8px 28px; border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text-secondary); font-size: 15px; cursor: pointer; background: transparent; transition: all var(--transition-fast); }
  .sp-close:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .move-tooltip {
    position: fixed; z-index: 100;
    background: var(--glass-bg-strong);
    backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-md);
    padding: 10px 14px;
    max-width: 300px;
    pointer-events: none;
    box-shadow: var(--shadow-lg), var(--glass-shadow);
    transform: translateY(-100%);
  }
  .tt-header { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
  .tt-name { font-weight: 600; color: var(--text-primary); }
  .tt-type { padding: 1px 8px; border-radius: var(--radius-pill); font-size: 11px; color: white; box-shadow: inset 0 -1px 0 rgba(0,0,0,0.25); }
  .tt-category { font-size: 12px; color: var(--text-muted); }
  .tt-stats { display: flex; gap: 10px; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
  .tt-desc { font-size: 12px; color: var(--text-muted); line-height: 1.4; }
  .switch-overlay { position: absolute; inset: 0; z-index: 150; background: rgba(6, 8, 16, 0.72); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; animation: fade-in 0.2s ease; }
  .switch-panel {
    background: var(--glass-bg-strong);
    backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    padding: 20px;
    max-width: min(380px, 35vh);
    width: 90%;
    box-shadow: var(--shadow-lg), var(--glass-shadow), inset 0 0 0 1px var(--glass-highlight);
    animation: pop-in-soft 0.25s var(--ease-out-back) both;
  }
  .switch-panel h3 { text-align: center; margin-bottom: 16px; color: var(--text-primary); letter-spacing: 1px; }
  .switch-options { display: flex; flex-direction: column; gap: 8px; }
  .switch-card {
    display: flex; align-items: center; gap: 12px; padding: 12px;
    background: rgba(29, 36, 64, 0.65);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  .switch-card:hover:not(:disabled) { border-color: var(--border-accent); background: var(--bg-hover); transform: translateX(4px); box-shadow: var(--shadow-sm); }
  .switch-card:disabled { opacity: 0.4; cursor: not-allowed; }
  .switch-sprite { width: 48px; height: 48px; object-fit: contain; image-rendering: pixelated; flex-shrink: 0; }
  .switch-info { flex: 1; min-width: 0; }
  .switch-name { font-weight: 600; min-width: 60px; }
  .switch-types { display: flex; gap: 3px; }
  .switch-hp { flex: 1; text-align: right; font-size: 13px; color: var(--text-secondary); }
  .switch-faint { font-size: 11px; color: var(--danger); }
  /* 主动换人按钮 */
  .switch-btn {
    border-color: var(--border-accent);
    background: linear-gradient(135deg, rgba(74, 158, 255, 0.18), rgba(74, 158, 255, 0.06));
  }
  .switch-btn:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .switch-icon { font-size: 18px; }
  /* 主动换人面板：在场中灰置 */
  .switch-card.active-switch {
    border-color: var(--border-accent);
    background: rgba(245, 166, 35, 0.08);
  }
  .switch-cancel {
    display: block;
    margin: 14px auto 0;
    padding: 8px 30px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: 14px;
    cursor: pointer;
    background: transparent;
    transition: all var(--transition-fast);
  }
  .switch-cancel:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .weather-indicator {
    position: absolute;
    top: 18px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(9, 12, 22, 0.7);
    border-radius: var(--radius-pill);
    padding: 4px 16px;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 1px;
    pointer-events: none;
    backdrop-filter: blur(6px);
    border: 1px solid var(--glass-border);
    box-shadow: var(--shadow-sm), var(--glass-shadow);
  }
  .announce-box {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 50;
    pointer-events: none;
  }
  .announce-text {
    display: inline-block;
    padding: 10px 28px;
    background: rgba(8, 11, 20, 0.85);
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-lg);
    color: #fff;
    font-size: 18px;
    font-weight: 700;
    white-space: nowrap;
    backdrop-filter: blur(6px);
    animation: pop-in 0.2s ease-out;
    box-shadow: var(--shadow-lg), 0 0 20px rgba(245, 166, 35, 0.15);
    text-shadow: 0 1px 3px rgba(0,0,0,0.6);
  }
  .ability-notifs {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 100;
  }
  .ability-notif {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    max-width: 260px;
    padding: 2px 14px 0;
    border-radius: var(--radius-md);
    background: rgba(9, 12, 22, 0.82);
    color: #fff;
    font-size: 12px;
    line-height: 1.4;
    animation-duration: 0.4s;
    animation-fill-mode: both;
    backdrop-filter: blur(6px);
    border: 1px solid var(--glass-border);
    box-shadow: var(--shadow-sm);
  }
  .ability-notif.notif-player {
    left: 10px;
    animation-name: slide-in-left;
  }
  .ability-notif.notif-enemy {
    right: 10px;
    animation-name: slide-in-right;
  }

  @keyframes slide-in-left {
    from { transform: translateY(-50%) translateX(-120%); opacity: 0; }
    to   { transform: translateY(-50%) translateX(0); opacity: 1; }
  }
  @keyframes slide-in-right {
    from { transform: translateY(-50%) translateX(120%); opacity: 0; }
    to   { transform: translateY(-50%) translateX(0); opacity: 1; }
  }

  @media (max-width: 820px) and (orientation: landscape) {
    .battle-field { padding: 2px 6px 0; }
    .enemy-row, .player-row { padding: 0 1%; }
    .ground-shadow { width: 60px; height: 14px; }
    .enemy-sprite-area .sprite-wrap { width: 200px; height: 200px; max-width: 30vh; max-height: 30vh; }
    .player-sprite-area .sprite-wrap { width: 150px; height: 150px; max-width: 22vh; max-height: 22vh; }
    .enemy-sprite { width: min(170px, 26vh); height: min(170px, 26vh); }
    .player-sprite { width: min(130px, 20vh); height: min(130px, 20vh); }
    .hp-block { min-width: 120px; padding: 3px 6px 3px 8px; }
    .hp-block .pkm-name { font-size: 12px; }
    .hp-block .pkm-level { font-size: 10px; }
    .hp-block .hp-bar { height: 11px; border-radius: 6px; }
    .hp-block .hp-text { font-size: 10px; }
    .hp-block .type-badge { font-size: 9px; padding: 0 4px; }
    .hp-block .ability-line { font-size: 9px; }
    .hp-block .ability-name { font-size: 9px; }
    .exp-bar-wrap { display: none; }
    .bottom-bar { min-height: 0; }
    .log { width: 100px; padding: 4px 6px; font-size: 11px; max-height: 70px; }
    .log-entry { font-size: 10px; }
    .menu { padding: 4px 6px; }
    .moves { gap: 3px; }
    .move-btn { padding: 6px 6px; }
    .move-name { font-size: 11px; }
    .move-type { font-size: 9px; padding: 1px 3px; }
    .move-pp { font-size: 9px; }
    .announce-text { font-size: 12px; padding: 5px 14px; }
    .ability-notif { font-size: 10px; max-width: 140px; padding: 4px 8px; }
    .weather-indicator { font-size: 11px; padding: 2px 10px; top: 8px; }
    /* 战斗演出移动端适配 */
    .moves { grid-template-columns: 1fr 1fr; }
    .dmg-num { font-size: 18px; }
    .eff-super { font-size: 24px; }
    .eff-weak { font-size: 18px; }
    .eff-none { font-size: 14px; }
    .switch-panel { max-width: min(320px, 60vh); padding: 14px; }
    .switch-sprite { width: 40px; height: 40px; }
    .switch-name { font-size: 13px; }
    .switch-hp { font-size: 11px; }
  }
</style>
