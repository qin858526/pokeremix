<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { gameStore } from '../stores/gameStore'
  import { battleStore } from '../stores/battleStore'
  import { TYPE_COLORS, ALL_TYPES } from '../game/data/types'
  import type { RecombinedPokemon, Move, Ability, Type } from '../game/data/types'
  import { abilityLabel, moveLabel } from '../game/data/impl-marks'
  import { getTypeZh } from '../game/data/type-zh'
  import { ABILITY_DB } from '../game/data/abilities'
  import { MOVE_DB } from '../game/data/moves'
  import { SeededRandom } from '../utils/random'
  import TypeBadge from '../components/TypeBadge.svelte'
  import HpBar from '../components/HpBar.svelte'
  import PkmSprite from '../components/PkmSprite.svelte'

  let phase = $state<'exchange' | 'modify'>('exchange')
  let enemyTeam = $state<RecombinedPokemon[]>([])
  let playerTeam = $state<RecombinedPokemon[]>([])

  // 交换选择
  let selectedEnemy = $state<number | null>(null)
  let selectedPlayer = $state<number | null>(null)

  // 改造选项
  type ModifyOption = {
    type: 'ability' | 'move' | 'type'
    label: string
    desc: string
    data: any
    tooltip: { oldDesc: string; newDesc: string }
  }
  let modifyOptions = $state<ModifyOption[]>([])
  let selectedModify = $state<number | null>(null)
  let modifyTarget = $state<number | null>(null)
  let tooltipModify = $state<ModifyOption | null>(null)
  let tooltipPos = $state({ x: 0, y: 0 })
  let rng: SeededRandom

  onMount(() => {
    const game = get(gameStore)
    const battle = get(battleStore)

    // 从运行种子 + 楼层号派生确定性随机，确保同样存档、同样楼层产生同样的改造选项
    rng = new SeededRandom(game.seed + game.currentFloor * 1000)

    // 回满所有宝可梦的 HP
    const heal = (pkm: RecombinedPokemon) => {
      pkm.currentHp = pkm.maxHp
      pkm.fainted = false
    }
    game?.playerTeam?.forEach(heal)
    battle?.enemyTeam?.forEach(heal)

    playerTeam = game?.playerTeam ? [...game.playerTeam] : []
    enemyTeam = battle?.enemyTeam ? [...battle.enemyTeam] : []
  })

  function typeColor(t: string | null | undefined): string {
    if (!t) return '#888'
    return TYPE_COLORS[t as keyof typeof TYPE_COLORS] ?? '#888'
  }

  function hpPercent(pkm: RecombinedPokemon): number {
    return (pkm.currentHp / pkm.maxHp) * 100
  }

  function hpColor(pkm: RecombinedPokemon): string {
    const pct = pkm.currentHp / pkm.maxHp
    return pct > 0.5 ? 'var(--success)' : pct > 0.25 ? 'var(--warning)' : 'var(--danger)'
  }

  function showModifyTooltip(opt: typeof modifyOptions[0], e: MouseEvent) {
    tooltipModify = opt
    tooltipPos = { x: e.clientX, y: e.clientY }
  }
  function hideModifyTooltip() {
    tooltipModify = null
  }

  // ========== 交换逻辑 ==========

  function confirmExchange() {
    if (selectedEnemy === null || selectedPlayer === null) return

    const gained = enemyTeam[selectedEnemy]
    const lost = playerTeam[selectedPlayer]

    // 修复交换来的宝可梦的状态
    gained.fainted = false
    gained.currentHp = gained.maxHp
    gained.moves.forEach(m => m.currentPp = m.pp)

    // 执行交换
    const newTeam = [...playerTeam]
    newTeam[selectedPlayer] = gained

    // 更新游戏状态
    gameStore.update(s => ({ ...s, playerTeam: newTeam }))
    playerTeam = newTeam
    phase = 'modify'
    generateModifyOptions()
  }

  function skipExchange() {
    generateModifyOptions()
    phase = 'modify'
  }

  // ========== 改造逻辑 ==========

  function generateAbilityOption(target: RecombinedPokemon): ModifyOption {
    let newAbility = ABILITY_DB[rng.nextInt(ABILITY_DB.length)]
    while (newAbility.name === target.ability.name) {
      newAbility = ABILITY_DB[rng.nextInt(ABILITY_DB.length)]
    }
    return {
      type: 'ability' as const,
      label: '特性改造',
      desc: `${target.ability.nameZh} → ${newAbility.nameZh}`,
      data: newAbility,
      tooltip: {
        oldDesc: `当前特性：${abilityLabel(target.ability.name, target.ability.nameZh)} — ${target.ability.description}`,
        newDesc: `新特性：${abilityLabel(newAbility.name, newAbility.nameZh)} — ${newAbility.description}`,
      },
    }
  }

  function generateMoveOption(target: RecombinedPokemon): ModifyOption {
    let newMove = MOVE_DB[rng.nextInt(MOVE_DB.length)]
    while (target.moves.some(m => m.name === newMove.name)) {
      newMove = MOVE_DB[rng.nextInt(MOVE_DB.length)]
    }
    const oldMoveIdx = rng.nextInt(target.moves.length)
    const oldMove = target.moves[oldMoveIdx]
    const moveInfo = (m: Move) => `${m.nameZh}（威力${m.power || '-'} ${getTypeZh(m.type)} ${m.category === 'physical' ? '物理' : m.category === 'special' ? '特殊' : '变化'}）`
    return {
      type: 'move' as const,
      label: '技能改造',
      desc: `${moveLabel(oldMove.name, oldMove.nameZh)} → ${moveLabel(newMove.name, newMove.nameZh)}`,
      data: { moveIndex: oldMoveIdx, newMove },
      tooltip: {
        oldDesc: `当前技能：${moveInfo(oldMove)} ${oldMove.description}`,
        newDesc: `新技能：${moveInfo(newMove)} ${newMove.description}`,
      },
    }
  }

  function generateTypeOption(target: RecombinedPokemon): ModifyOption {
    const allTypes = ALL_TYPES
    let newType: Type
    do {
      newType = allTypes[rng.nextInt(allTypes.length)]
    } while (target.types[0] === newType || target.types[1] === newType)

    const isSingleType = target.types[1] === null
    const addNew = isSingleType && rng.next() < 0.5
    const replacedSlot = isSingleType ? (addNew ? -1 : 0) : rng.nextInt(2)

    const currentStr = [target.types[0], target.types[1]].filter(Boolean).map(t => getTypeZh(t!)).join('/')

    let replaceDesc: string
    if (addNew) {
      replaceDesc = `新增第二属性 ${getTypeZh(newType)}`
    } else {
      const oldTypeZh = getTypeZh(target.types[replacedSlot]!)
      replaceDesc = `替换 ${oldTypeZh} → ${getTypeZh(newType)}`
    }

    return {
      type: 'type' as const,
      label: '属性改造',
      desc: `${currentStr} → ${replaceDesc}`,
      data: { newType, replacedSlot, addNew },
      tooltip: {
        oldDesc: `当前属性：${currentStr}`,
        newDesc: `改造后属性：${addNew
          ? `${getTypeZh(target.types[0])} / ${getTypeZh(newType)}`
          : replacedSlot === 0
            ? `${getTypeZh(newType)} / ${target.types[1] ? getTypeZh(target.types[1]) : '-'}`
            : `${getTypeZh(target.types[0])} / ${getTypeZh(newType)}`
        }`,
      },
    }
  }

  function generateModifyOptions() {
    const target = playerTeam[modifyTarget ?? 0]
    if (!target) return

    const generators: { weight: number; fn: () => ModifyOption }[] = [
      { weight: 30, fn: () => generateAbilityOption(target) },
      { weight: 50, fn: () => generateMoveOption(target) },
      { weight: 20, fn: () => generateTypeOption(target) },
    ]

    // 随机抽取 3 个改造选项（按权重抽取）
    const options: typeof modifyOptions = []
    const totalWeight = generators.reduce((s, g) => s + g.weight, 0)
    for (let i = 0; i < 3; i++) {
      let roll = rng.next() * totalWeight
      for (const g of generators) {
        roll -= g.weight
        if (roll <= 0) {
          options.push(g.fn())
          break
        }
      }
    }

    modifyOptions = options
  }

  function confirmModify() {
    if (selectedModify === null || modifyTarget === null) return

    const opt = modifyOptions[selectedModify]
    const target = playerTeam[modifyTarget]
    if (!target || !opt) return

    const newTeam = [...playerTeam]
    const modified = { ...target, moves: [...target.moves] as [Move, Move, Move, Move] }

    switch (opt.type) {
      case 'ability':
        modified.ability = opt.data as Ability
        break
      case 'move': {
        const { moveIndex, newMove } = opt.data as { moveIndex: number; newMove: Move }
        modified.moves[moveIndex] = newMove
        break
      }
      case 'type': {
        const { newType, replacedSlot, addNew } = opt.data as { newType: Type; replacedSlot: number; addNew: boolean }
        if (addNew) {
          modified.types = [modified.types[0], newType]
        } else if (replacedSlot === 0) {
          modified.types = [newType, modified.types[1]]
        } else {
          modified.types = [modified.types[0], newType]
        }
        break
      }
    }

    newTeam[modifyTarget] = modified
    playerTeam = newTeam
    gameStore.update(s => ({ ...s, playerTeam: newTeam }))
    gameStore.advanceFloor()
  }

  // 切换改造目标时刷新选项
  $effect(() => {
    if (phase === 'modify' && modifyTarget !== null && modifyOptions.length === 0) {
      generateModifyOptions()
    }
  })
</script>

<div class="reward">
  {#if phase === 'exchange'}
    <h2>战后交换（必选）</h2>
    <p class="hint">从敌方队伍中选择一只宝可梦，与我方一只宝可梦交换</p>

    <div class="section">
      <h3>敌方宝可梦</h3>
      <div class="card-row">
        {#each enemyTeam as pkm, i}
          <button
            class="card"
            class:selected={selectedEnemy === i}
            onclick={() => selectedEnemy = i}
          >
            <div class="card-name">{pkm.nameZh}</div>
            <div class="card-types">
              {#each [pkm.types[0], pkm.types[1]].filter(Boolean) as t}
                <TypeBadge type={t} size="sm" />
              {/each}
            </div>
            <div class="card-stat">{abilityLabel(pkm.ability.name, pkm.ability.nameZh)}</div>
            <div class="card-hp-bar"><div class="card-hp-fill" style="width: {hpPercent(pkm)}%; background: {hpColor(pkm)}"></div></div>
            <div class="card-hp">HP {pkm.currentHp}/{pkm.maxHp}</div>
          </button>
        {/each}
      </div>
    </div>

    <div class="section">
      <h3>我方宝可梦（选择要换出的）</h3>
      <div class="card-row">
        {#each playerTeam as pkm, i}
          <button
            class="card"
            class:selected={selectedPlayer === i}
            onclick={() => selectedPlayer = i}
          >
            <div class="card-name">{pkm.nameZh}</div>
            <div class="card-types">
              {#each [pkm.types[0], pkm.types[1]].filter(Boolean) as t}
                <TypeBadge type={t} size="sm" />
              {/each}
            </div>
            <div class="card-stat">{abilityLabel(pkm.ability.name, pkm.ability.nameZh)}</div>
            <div class="card-hp-bar"><div class="card-hp-fill" style="width: {hpPercent(pkm)}%; background: {hpColor(pkm)}"></div></div>
            <div class="card-hp">HP {pkm.currentHp}/{pkm.maxHp}</div>
            {#if pkm.fainted}
              <div class="card-faint">已倒下</div>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <div class="actions">
      <button
        class="btn primary"
        disabled={selectedEnemy === null || selectedPlayer === null}
        onclick={confirmExchange}
      >确认交换</button>
      <button class="btn" onclick={skipExchange}>跳过交换</button>
    </div>

    <!-- 选中精灵详情对比 -->
    {#if selectedEnemy !== null || selectedPlayer !== null}
      <div class="exchange-detail">
        {#if selectedPlayer !== null}
          {@const pkm = playerTeam[selectedPlayer]}
          <div class="ed-card">
            <div class="ed-header">
              <span class="ed-badge give">换出</span>
              <span class="ed-name">{pkm.nameZh}</span>
            </div>
            <PkmSprite dexId={pkm.dexId} name={pkm.nameZh} size={64} />
            <div class="ed-types">
              {#each [pkm.types[0], pkm.types[1]].filter(Boolean) as t}
                <TypeBadge type={t} size="sm" />
              {/each}
            </div>
            <div class="ed-row"><span class="ed-label">特性</span><span>{abilityLabel(pkm.ability.name, pkm.ability.nameZh)}</span></div>
            <div class="ed-row"><span class="ed-label">技能</span></div>
            <div class="ed-moves">
              {#each pkm.moves as m}
                <span class="ed-move">
                  <span class="ed-move-type" style="background:{typeColor(m.type)}"></span>
                  {moveLabel(m.name, m.nameZh)}
                </span>
              {/each}
            </div>
            <div class="ed-stats">
              <span>HP {pkm.maxHp}</span>
              <span>攻击 {pkm.baseStats.attack}</span>
              <span>防御 {pkm.baseStats.defense}</span>
              <span>特攻 {pkm.baseStats.spAttack}</span>
              <span>特防 {pkm.baseStats.spDefense}</span>
              <span>速度 {pkm.baseStats.speed}</span>
            </div>
          </div>
        {:else}
          <div class="ed-card ed-placeholder">请选择要换出的宝可梦</div>
        {/if}

        <div class="ed-arrow">→</div>

        {#if selectedEnemy !== null}
          {@const pkm = enemyTeam[selectedEnemy]}
          <div class="ed-card">
            <div class="ed-header">
              <span class="ed-badge get">换入</span>
              <span class="ed-name">{pkm.nameZh}</span>
            </div>
            <PkmSprite dexId={pkm.dexId} name={pkm.nameZh} size={64} />
            <div class="ed-types">
              {#each [pkm.types[0], pkm.types[1]].filter(Boolean) as t}
                <TypeBadge type={t} size="sm" />
              {/each}
            </div>
            <div class="ed-row"><span class="ed-label">特性</span><span>{abilityLabel(pkm.ability.name, pkm.ability.nameZh)}</span></div>
            <div class="ed-row"><span class="ed-label">技能</span></div>
            <div class="ed-moves">
              {#each pkm.moves as m}
                <span class="ed-move">
                  <span class="ed-move-type" style="background:{typeColor(m.type)}"></span>
                  {moveLabel(m.name, m.nameZh)}
                </span>
              {/each}
            </div>
            <div class="ed-stats">
              <span>HP {pkm.maxHp}</span>
              <span>攻击 {pkm.baseStats.attack}</span>
              <span>防御 {pkm.baseStats.defense}</span>
              <span>特攻 {pkm.baseStats.spAttack}</span>
              <span>特防 {pkm.baseStats.spDefense}</span>
              <span>速度 {pkm.baseStats.speed}</span>
            </div>
          </div>
        {:else}
          <div class="ed-card ed-placeholder">请选择要换入的宝可梦</div>
        {/if}
      </div>
    {:else}
      <div class="exchange-detail">
        <div class="ed-card ed-placeholder">请分别选择换出和换入的宝可梦查看详情</div>
        <div class="ed-arrow">→</div>
        <div class="ed-card ed-placeholder">请分别选择换出和换入的宝可梦查看详情</div>
      </div>
    {/if}

  {:else}
    <h2>打造改造（三选一）</h2>
    <p class="hint">选择一个改造项目，再选择改造目标宝可梦</p>

    <div class="section">
      <h3>选择改造目标</h3>
      <div class="card-row">
        {#each playerTeam as pkm, i}
          <button
            class="card"
            class:selected={modifyTarget === i}
            onclick={() => { modifyTarget = i; selectedModify = null; modifyOptions = []; }}
          >
            <div class="card-name">{pkm.nameZh}</div>
            <div class="card-types">
              {#each [pkm.types[0], pkm.types[1]].filter(Boolean) as t}
                <TypeBadge type={t} size="sm" />
              {/each}
            </div>
            {#if pkm.fainted}
              <div class="card-faint">已倒下</div>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    {#if modifyTarget !== null && modifyOptions.length > 0}
      <div class="modify-options">
        {#each modifyOptions as opt, i}
          <button
            class="modify-card"
            class:selected={selectedModify === i}
            onclick={() => selectedModify = i}
            onmouseenter={(e) => showModifyTooltip(opt, e)}
            onmouseleave={hideModifyTooltip}
          >
            <div class="modify-label">{opt.label}</div>
            <div class="modify-desc">{opt.desc}</div>
          </button>
        {/each}
      </div>

      {#if tooltipModify}
        <div class="modify-tooltip" style="left: {Math.min(tooltipPos.x, window.innerWidth - 360)}px; top: {tooltipPos.y}px;">
          <div class="mt-section">
            <div class="mt-section-label">改造前</div>
            <div class="mt-text">{tooltipModify.tooltip.oldDesc}</div>
          </div>
          <div class="mt-arrow">↓</div>
          <div class="mt-section">
            <div class="mt-section-label">改造后</div>
            <div class="mt-text">{tooltipModify.tooltip.newDesc}</div>
          </div>
        </div>
      {/if}
    {/if}

    <div class="actions">
      <button
        class="btn primary"
        disabled={selectedModify === null || modifyTarget === null}
        onclick={confirmModify}
      >确认改造</button>
    </div>
  {/if}
</div>

<style>
  .reward {
    height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 24px;
    background:
      radial-gradient(900px 460px at 80% -8%, rgba(74, 158, 255, 0.09), transparent 60%),
      radial-gradient(720px 420px at 10% 110%, rgba(245, 166, 35, 0.08), transparent 55%),
      var(--bg-base);
    overflow-y: auto;
  }
  h2 {
    color: var(--text-primary);
    margin-bottom: 4px;
    letter-spacing: 2px;
    animation: fade-in-up 0.4s var(--ease-out-back) both;
  }
  .hint {
    color: var(--text-muted);
    font-size: 14px;
    margin-bottom: 20px;
  }
  .section {
    margin-bottom: 20px;
  }
  .section h3 {
    color: var(--text-secondary);
    font-size: 14px;
    margin-bottom: 8px;
    letter-spacing: 1px;
  }
  .card-row {
    display: flex;
    gap: 12px;
  }
  .card {
    flex: 1;
    padding: 12px;
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    cursor: pointer;
    transition: all var(--transition-fast);
    text-align: left;
    position: relative;
    box-shadow: var(--glass-shadow);
  }
  .card:hover {
    border-color: var(--border-accent);
    transform: translateY(-3px);
    background: var(--bg-hover);
    box-shadow: var(--shadow-glow), var(--shadow-md);
  }
  .card.selected {
    border-color: var(--accent);
    background: var(--bg-hover);
    box-shadow: 0 0 16px rgba(245, 166, 35, 0.28), var(--shadow-sm);
    transform: translateY(-3px);
  }
  .card-name {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .card-types {
    display: flex;
    gap: 4px;
    margin-bottom: 4px;
  }
  .card-stat {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  .card-hp-bar {
    height: 6px;
    background: var(--bg-inset);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 2px;
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.5);
  }
  .card-hp-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s;
  }
  .card-hp {
    font-size: 11px;
    color: var(--text-muted);
  }
  .card-faint {
    position: absolute;
    top: 4px;
    right: 6px;
    font-size: 10px;
    color: var(--danger);
    font-weight: 600;
  }
  .modify-options {
    display: flex;
    gap: 12px;
    margin-bottom: 20px;
  }
  .modify-card {
    flex: 1;
    padding: 18px;
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    cursor: pointer;
    transition: all var(--transition-fast);
    text-align: center;
    box-shadow: var(--glass-shadow);
  }
  .modify-card:hover {
    border-color: var(--border-accent);
    transform: translateY(-3px);
    background: var(--bg-hover);
    box-shadow: var(--shadow-glow), var(--shadow-md);
  }
  .modify-card.selected {
    border-color: var(--accent);
    background: var(--bg-hover);
    box-shadow: 0 0 18px rgba(245, 166, 35, 0.3), var(--shadow-sm);
  }
  .modify-label { font-size: 14px; color: var(--text-secondary); margin-bottom: 6px; }
  .modify-desc { font-size: 14px; font-weight: 600; color: var(--accent); line-height: 1.4; }

  /* 改造悬浮提示 */
  .modify-tooltip {
    position: fixed;
    z-index: 100;
    background: var(--glass-bg-strong);
    backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-md);
    padding: 12px 14px;
    max-width: 340px;
    pointer-events: none;
    box-shadow: var(--shadow-lg), var(--glass-shadow);
    transform: translateY(-100%);
  }
  .mt-section { margin-bottom: 6px; }
  .mt-section:last-child { margin-bottom: 0; }
  .mt-section-label { font-size: 11px; color: var(--text-muted); margin-bottom: 2px; letter-spacing: 1px; }
  .mt-arrow { text-align: center; color: var(--accent); font-size: 16px; margin: 2px 0; }
  .mt-text { font-size: 12px; color: var(--text-secondary); line-height: 1.5; white-space: pre-wrap; }

  /* 交换详情对比 */
  .exchange-detail {
    display: flex;
    align-items: stretch;
    gap: 12px;
    margin-bottom: 20px;
    min-height: 140px;
  }
  .ed-card {
    flex: 1;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 12px;
    box-shadow: var(--glass-shadow);
  }
  .ed-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 13px;
  }
  .ed-arrow {
    display: flex;
    align-items: center;
    font-size: 24px;
    color: var(--accent);
    flex-shrink: 0;
  }
  .ed-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .ed-badge {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: var(--radius-pill);
    font-weight: 600;
    letter-spacing: 0.5px;
  }
  .ed-badge.give { background: var(--warning); color: #1a1204; }
  .ed-badge.get { background: var(--success); color: #06230f; }
  .ed-name { font-size: 15px; font-weight: 600; }
  .ed-types { display: flex; gap: 3px; margin-bottom: 6px; }
  .ed-row {
    display: flex;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }
  .ed-label { color: var(--text-muted); min-width: 28px; }
  .ed-moves {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }
  .ed-move {
    font-size: 11px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .ed-move-type {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .ed-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .actions {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-top: auto;
    padding-bottom: 24px;
  }
  .btn {
    padding: 10px 34px;
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    cursor: pointer;
    transition: all var(--transition-fast);
    background: var(--bg-elevated);
    box-shadow: var(--glass-shadow);
  }
  .btn:hover:not(:disabled) {
    border-color: var(--border-hover);
    transform: translateY(-2px);
    box-shadow: var(--shadow-sm);
  }
  .btn.primary {
    border-color: var(--border-accent);
    color: var(--accent);
    background: var(--glass-bg);
  }
  .btn.primary:disabled {
    border-color: var(--border);
    color: var(--text-muted);
    cursor: not-allowed;
    background: rgba(20, 26, 44, 0.4);
    box-shadow: none;
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--accent-gradient);
    color: var(--text-on-accent);
    border-color: var(--accent-hover);
    box-shadow: var(--shadow-glow), var(--shadow-md);
  }
</style>
