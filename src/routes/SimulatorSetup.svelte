<script lang="ts">
  import SearchPicker from '../components/SearchPicker.svelte'
  import { SPECIES_DB, createPokemonInstance, type SpeciesEntry } from '../game/data/pokemon'
  import { MOVE_DB, getMoveByName, getMoveById } from '../game/data/moves'
  import { ABILITY_DB, getAbilityByName, getAbilityById } from '../game/data/abilities'
  import { gameStore } from '../stores/gameStore'
  import { battleStore } from '../stores/battleStore'
  import { TYPE_COLORS } from '../game/data/types'
  import type { Move, Ability, RecombinedPokemon } from '../game/data/types'
  import { getTypeZh } from '../game/data/type-zh'
  import { abilityLabel, moveLabel } from '../game/data/impl-marks'
  import { v4 as uuid } from '../game/data/uid'

  // ======== localStorage 缓存：组件重新挂载时保持配置不变 ========
  const CACHE_KEY = 'simulator_config'

  // 只保存关键 ID，不存整个对象（轻量、无循环引用）
  interface CacheData {
    playerSpeciesDex: number
    playerAbilityId: number
    playerMoveIds: number[]
    enemySpeciesDex: number
    enemyAbilityId: number
    enemyMoveIds: number[]
  }

  function saveCache() {
    if (!playerSpecies || !playerAbility || !enemySpecies || !enemyAbility) return
    try {
      const data: CacheData = {
        playerSpeciesDex: playerSpecies.dexId,
        playerAbilityId: playerAbility.id,
        playerMoveIds: playerMoves.map(m => m.id),
        enemySpeciesDex: enemySpecies.dexId,
        enemyAbilityId: enemyAbility.id,
        enemyMoveIds: enemyMoves.map(m => m.id),
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
    } catch (e) { console.warn('saveCache failed', e) }
  }

  function loadCache(): boolean {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (!raw) return false
      const data: CacheData = JSON.parse(raw)
      const pSpec = data.playerSpeciesDex ? SPECIES_DB.find(s => s.dexId === data.playerSpeciesDex) : null
      const eSpec = data.enemySpeciesDex ? SPECIES_DB.find(s => s.dexId === data.enemySpeciesDex) : null
      if (!pSpec || !eSpec) return false
      playerSpecies = pSpec
      playerAbility = getAbilityById(data.playerAbilityId) ?? getAbilityByName(pSpec.abilityIds[0]) ?? ABILITY_DB[0]
      playerMoves = data.playerMoveIds.map(id => getMoveById(id)).filter(Boolean) as Move[]
      enemySpecies = eSpec
      enemyAbility = getAbilityById(data.enemyAbilityId) ?? getAbilityByName(eSpec.abilityIds[0]) ?? ABILITY_DB[0]
      enemyMoves = data.enemyMoveIds.map(id => getMoveById(id)).filter(Boolean) as Move[]
      return true
    } catch { return false }
  }

  let pickerState = $state<{
    side: 'player' | 'enemy'
    type: 'species' | 'ability' | 'move'
    slot?: number
  } | null>(null)

  // 双方配置（从缓存恢复或随机初始化）
  let playerSpecies = $state<SpeciesEntry | null>(null)
  let playerAbility = $state<Ability | null>(null)
  let playerMoves = $state<Move[]>([])
  let enemySpecies = $state<SpeciesEntry | null>(null)
  let enemyAbility = $state<Ability | null>(null)
  let enemyMoves = $state<Move[]>([])

  function randomMove(): Move {
    return MOVE_DB[Math.floor(Math.random() * MOVE_DB.length)]
  }

  function initDefaults() {
    if (loadCache()) return
    // 首次进入：随机填充
    if (SPECIES_DB.length > 0) {
      const r1 = SPECIES_DB[Math.floor(Math.random() * SPECIES_DB.length)]
      const r2 = SPECIES_DB[Math.floor(Math.random() * SPECIES_DB.length)]
      playerSpecies = r1
      playerAbility = getAbilityByName(r1.abilityIds[0]) ?? ABILITY_DB[0]
      playerMoves = [randomMove(), randomMove(), randomMove(), randomMove()]
      enemySpecies = r2
      enemyAbility = getAbilityByName(r2.abilityIds[0]) ?? ABILITY_DB[0]
      enemyMoves = [randomMove(), randomMove(), randomMove(), randomMove()]
    }
    saveCache()
  }

  initDefaults()

  function openPicker(side: 'player' | 'enemy', type: 'species' | 'ability' | 'move', slot?: number) {
    pickerState = { side, type, slot }
  }

  function handleSelect(item: any) {
    if (!pickerState) return
    const { side, type, slot } = pickerState
    if (type === 'species') {
      const species = item as SpeciesEntry
      if (side === 'player') {
        playerSpecies = species
        playerAbility = getAbilityByName(species.abilityIds[0]) ?? ABILITY_DB[0]
      } else {
        enemySpecies = species
        enemyAbility = getAbilityByName(species.abilityIds[0]) ?? ABILITY_DB[0]
      }
    } else if (type === 'ability') {
      if (side === 'player') playerAbility = item as Ability
      else enemyAbility = item as Ability
    } else if (type === 'move' && slot !== undefined) {
      if (side === 'player') {
        const next = [...playerMoves]
        next[slot] = item as Move
        playerMoves = next
      } else {
        const next = [...enemyMoves]
        next[slot] = item as Move
        enemyMoves = next
      }
    }
    pickerState = null
    saveCache()
  }

  function startBattle() {
    if (!playerSpecies || !enemySpecies) return
    const pAbility = playerAbility ?? getAbilityByName(playerSpecies.abilityIds[0]) ?? ABILITY_DB[0]
    const eAbility = enemyAbility ?? getAbilityByName(enemySpecies.abilityIds[0]) ?? ABILITY_DB[0]
    const pMoves = playerMoves.length === 4 ? playerMoves : [randomMove(), randomMove(), randomMove(), randomMove()]
    const eMoves = enemyMoves.length === 4 ? enemyMoves : [randomMove(), randomMove(), randomMove(), randomMove()]

    const player = createPokemonInstance(playerSpecies, pMoves as [Move, Move, Move, Move], pAbility)
    const enemy = createPokemonInstance(enemySpecies, eMoves as [Move, Move, Move, Move], eAbility)

    // 重置 HP（createPokemonInstance 已满血）
    battleStore.initBattle([player], [enemy], Date.now())
    gameStore.setPhase('simulator_battle')
  }

  function speciesLabel(s: SpeciesEntry): string {
    return `#${String(s.dexId).padStart(3, '0')} ${s.nameZh}`
  }
  function speciesSublabel(s: SpeciesEntry): string {
    return s.types.filter(Boolean).map(t => getTypeZh(t)).join(' / ')
  }
  function abilitySublabel(a: Ability): string {
    return a.description.slice(0, 30) + (a.description.length > 30 ? '...' : '')
  }
  function moveSublabel(m: Move): string {
    const cat = ({ physical: '物理', special: '特殊', status: '变化' })[m.category] ?? m.category
    return `[${getTypeZh(m.type)}] ${cat} 威力:${m.power || '-'} 命中:${m.accuracy}`
  }

  // 清除选择
  function clearPokemon(side: 'player' | 'enemy') {
    if (side === 'player') {
      playerSpecies = null; playerAbility = null; playerMoves = []
    } else {
      enemySpecies = null; enemyAbility = null; enemyMoves = []
    }
  }

  function randomizeAll() {
    const r1 = SPECIES_DB[Math.floor(Math.random() * SPECIES_DB.length)]
    const r2 = SPECIES_DB[Math.floor(Math.random() * SPECIES_DB.length)]
    playerSpecies = r1
    playerAbility = getAbilityByName(r1.abilityIds[0]) ?? ABILITY_DB[Math.floor(Math.random() * ABILITY_DB.length)]
    playerMoves = [randomMove(), randomMove(), randomMove(), randomMove()]
    enemySpecies = r2
    enemyAbility = getAbilityByName(r2.abilityIds[0]) ?? ABILITY_DB[Math.floor(Math.random() * ABILITY_DB.length)]
    enemyMoves = [randomMove(), randomMove(), randomMove(), randomMove()]
    saveCache()
  }
</script>

<div class="simulator-setup">
  <h2 class="page-title">对战模拟器</h2>
  <p class="page-desc">自由配置双方宝可梦，点击项目可搜索替换</p>

  <div class="teams">
    <!-- 我方 -->
    <div class="team-panel player-panel">
      <h3 class="panel-title">我方</h3>

      <div class="selector-row">
        <span class="field-label">宝可梦</span>
        <button class="selector" onclick={() => openPicker('player', 'species')}>
          {#if playerSpecies}
            <span class="sel-label">{speciesLabel(playerSpecies)}</span>
            <span class="sel-sub">{speciesSublabel(playerSpecies)}</span>
          {:else}
            <span class="sel-placeholder">点击选择</span>
          {/if}
        </button>
      </div>

      {#if playerSpecies}
        <div class="mini-stats">
          {#each ['hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed'] as s}
            <span class="stat">{s === 'hp' ? 'HP' : s === 'spAttack' ? '特攻' : s === 'spDefense' ? '特防' : s.charAt(0).toUpperCase() + s.slice(1)}
              {playerSpecies.baseStats[s as keyof typeof playerSpecies.baseStats]}</span>
          {/each}
        </div>

        <div class="selector-row">
          <span class="field-label">特性</span>
          <button class="selector" onclick={() => openPicker('player', 'ability')}>
            {#if playerAbility}
              <span class="sel-label">{abilityLabel(playerAbility.name, playerAbility.nameZh)}</span>
              <span class="sel-sub">{playerAbility.description.slice(0, 25)}</span>
            {:else}
              <span class="sel-placeholder">点击选择</span>
            {/if}
          </button>
        </div>

        <div class="moves-section">
          <span class="field-label">技能</span>
          {#each [0, 1, 2, 3] as i}
            <button class="move-slot" onclick={() => openPicker('player', 'move', i)}>
              {#if playerMoves[i]}
                <span class="move-name">{moveLabel(playerMoves[i].name, playerMoves[i].nameZh)}</span>
                <span class="move-info">{moveSublabel(playerMoves[i])}</span>
              {:else}
                <span class="sel-placeholder">点击选择技能 #{i + 1}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- 敌方 -->
    <div class="team-panel enemy-panel">
      <h3 class="panel-title">敌方</h3>

      <div class="selector-row">
        <span class="field-label">宝可梦</span>
        <button class="selector" onclick={() => openPicker('enemy', 'species')}>
          {#if enemySpecies}
            <span class="sel-label">{speciesLabel(enemySpecies)}</span>
            <span class="sel-sub">{speciesSublabel(enemySpecies)}</span>
          {:else}
            <span class="sel-placeholder">点击选择</span>
          {/if}
        </button>
      </div>

      {#if enemySpecies}
        <div class="mini-stats">
          {#each ['hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed'] as s}
            <span class="stat">{s === 'hp' ? 'HP' : s === 'spAttack' ? '特攻' : s === 'spDefense' ? '特防' : s.charAt(0).toUpperCase() + s.slice(1)}
              {enemySpecies.baseStats[s as keyof typeof enemySpecies.baseStats]}</span>
          {/each}
        </div>

        <div class="selector-row">
          <span class="field-label">特性</span>
          <button class="selector" onclick={() => openPicker('enemy', 'ability')}>
            {#if enemyAbility}
              <span class="sel-label">{abilityLabel(enemyAbility.name, enemyAbility.nameZh)}</span>
              <span class="sel-sub">{enemyAbility.description.slice(0, 25)}</span>
            {:else}
              <span class="sel-placeholder">点击选择</span>
            {/if}
          </button>
        </div>

        <div class="moves-section">
          <span class="field-label">技能</span>
          {#each [0, 1, 2, 3] as i}
            <button class="move-slot" onclick={() => openPicker('enemy', 'move', i)}>
              {#if enemyMoves[i]}
                <span class="move-name">{moveLabel(enemyMoves[i].name, enemyMoves[i].nameZh)}</span>
                <span class="move-info">{moveSublabel(enemyMoves[i])}</span>
              {:else}
                <span class="sel-placeholder">点击选择技能 #{i + 1}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <div class="actions">
    <button class="btn btn-secondary" onclick={randomizeAll}>随机填充</button>
    <button class="btn btn-primary" onclick={startBattle} disabled={!playerSpecies || !enemySpecies}>
      开始战斗
    </button>
  </div>
</div>

<!-- 搜索弹窗 -->
{#if pickerState}
  {#if pickerState.type === 'species'}
    <SearchPicker
      items={SPECIES_DB}
      label={speciesLabel}
      sublabel={speciesSublabel}
      searchPlaceholder="搜索宝可梦..."
      onselect={handleSelect}
      onclose={() => pickerState = null}
    />
  {:else if pickerState.type === 'ability'}
    <SearchPicker
      items={ABILITY_DB}
      label={(a: Ability) => a.nameZh}
      sublabel={abilitySublabel}
      searchPlaceholder="搜索特性..."
      onselect={handleSelect}
      onclose={() => pickerState = null}
    />
  {:else if pickerState.type === 'move'}
    <SearchPicker
      items={MOVE_DB}
      label={(m: Move) => m.nameZh}
      sublabel={moveSublabel}
      searchPlaceholder="搜索技能..."
      onselect={handleSelect}
      onclose={() => pickerState = null}
    />
  {/if}
{/if}

<style>
  .simulator-setup {
    min-height: 100vh;
    padding: 24px;
    background:
      radial-gradient(900px 460px at 80% -8%, rgba(74, 158, 255, 0.09), transparent 60%),
      radial-gradient(720px 420px at 10% 110%, rgba(245, 166, 35, 0.08), transparent 55%),
      var(--bg-base);
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow-y: auto;
  }
  .page-title { font-size: 28px; color: var(--accent); margin-bottom: 4px; letter-spacing: 2px; animation: fade-in-up 0.5s var(--ease-out-back) both; }
  .page-desc { font-size: 14px; color: var(--text-muted); margin-bottom: 24px; }

  .teams {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    width: min(900px, 100%);
    flex: 1;
  }
  .team-panel {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--shadow-sm), var(--glass-shadow), inset 0 0 0 1px var(--glass-highlight);
  }
  .player-panel { border-color: rgba(74, 158, 255, 0.35); background: rgba(24, 32, 56, 0.66); }
  .enemy-panel { border-color: rgba(255, 90, 95, 0.35); background: rgba(32, 24, 44, 0.66); }
  .panel-title { font-size: 18px; color: var(--text-primary); margin: 0 0 8px; letter-spacing: 1px; }

  .selector-row { display: flex; flex-direction: column; gap: 4px; }
  .field-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; }

  .selector, .move-slot {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: rgba(9, 12, 22, 0.6);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  }
  .selector:hover, .move-slot:hover {
    border-color: var(--border-accent);
    background: rgba(245, 166, 35, 0.06);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .sel-label { font-size: 14px; }
  .sel-sub { font-size: 12px; color: var(--text-muted); }
  .sel-placeholder { font-size: 14px; color: var(--text-muted); font-style: italic; }

  .mini-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px 8px;
    padding: 4px 0;
    font-size: 11px;
    color: var(--text-secondary);
  }
  .stat { text-transform: capitalize; }

  .moves-section { display: flex; flex-direction: column; gap: 4px; }
  .move-slot { padding: 8px 12px; }
  .move-name { font-size: 13px; }
  .move-info { font-size: 11px; color: var(--text-muted); }

  .actions {
    display: flex;
    gap: 12px;
    margin-top: 20px;
  }
  .btn {
    padding: 12px 36px;
    font-size: 16px;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-primary {
    border: 2px solid var(--border-accent);
    background: var(--accent-gradient);
    color: var(--text-on-accent);
    box-shadow: var(--shadow-sm);
    letter-spacing: 1px;
  }
  .btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    box-shadow: none;
  }
  .btn-primary:not(:disabled):hover { filter: brightness(1.1); transform: translateY(-2px); box-shadow: var(--shadow-glow); }
  .btn-secondary {
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
  }
  .btn-secondary:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); transform: translateY(-2px); }
</style>
