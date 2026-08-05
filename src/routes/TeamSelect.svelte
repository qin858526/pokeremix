<script lang="ts">
  import { onMount } from 'svelte'
  import { gameStore } from '../stores/gameStore'
  import { RecombineFactory } from '../game/factory/RecombineFactory'
  import { TYPE_COLORS } from '../game/data/types'
  import type { RecombinedPokemon } from '../game/data/types'
  import { abilityLabel, moveLabel } from '../game/data/impl-marks'
  import { getTypeZh } from '../game/data/type-zh'

  let candidates = $state<RecombinedPokemon[]>([])
  let selected = $state<Set<number>>(new Set())
  let cursor = $state(0)

  onMount(() => {
    const seed = Date.now()
    const factory = new RecombineFactory(seed)
    candidates = factory.generateInitialTeam(6)
  })

  function toggleSelect(idx: number) {
    const next = new Set(selected)
    if (next.has(idx)) {
      next.delete(idx)
    } else if (next.size < 3) {
      next.add(idx)
    }
    selected = next
  }

  function confirm() {
    if (selected.size !== 3) return
    const team = [...selected].map(i => candidates[i])
    gameStore.setTeam(team)
  }

  function moveCursor(d: number) {
    cursor = (cursor + d + 6) % 6
  }
</script>

<div class="team-select">
  <h2 class="title">选择你的初始队伍</h2>
  <p class="hint">从 6 只重组宝可梦中选 3 只</p>

  <div class="ball-grid">
    {#each candidates as pkm, i}
      <button
        class="ball-wrapper"
        class:cursor={cursor === i}
        class:selected={selected.has(i)}
        onclick={() => toggleSelect(i)}
        onmouseenter={() => cursor = i}
      >
        <div class="ball" class:open={cursor === i}>
          {#if cursor === i}
            <div class="preview">
              <img
                class="preview-sprite"
                src="/sprites/{pkm.dexId}.png"
                alt={pkm.nameZh}
                onerror={(e) => (e.target as HTMLImageElement).style.display = 'none'}
              />
              <div class="pkm-name">{pkm.nameZh}</div>
              <div class="pkm-types">
                {#if pkm.types[0]}
                  <span class="type-badge" style="background: {TYPE_COLORS[pkm.types[0]]}">{getTypeZh(pkm.types[0])}</span>
                {/if}
                {#if pkm.types[1]}
                  <span class="type-badge" style="background: {TYPE_COLORS[pkm.types[1]]}">{getTypeZh(pkm.types[1])}</span>
                {/if}
              </div>
              <div class="pkm-ability">{abilityLabel(pkm.ability.name, pkm.ability.nameZh)}</div>
              <div class="pkm-moves">
                {#each pkm.moves as m}
                  <span class="move">{moveLabel(m.name, m.nameZh)}</span>
                {/each}
              </div>
              <div class="pkm-stats">
                <div>HP {pkm.baseStats.hp}</div>
                <div>攻 {pkm.baseStats.attack}</div>
                <div>防 {pkm.baseStats.defense}</div>
                <div>特攻 {pkm.baseStats.spAttack}</div>
                <div>特防 {pkm.baseStats.spDefense}</div>
                <div>速 {pkm.baseStats.speed}</div>
              </div>
            </div>
          {:else}
            <div class="ball-closed">?<span class="ball-num">{i + 1}</span></div>
          {/if}
        </div>
        {#if selected.has(i)}
          <div class="selected-mark">✓</div>
        {/if}
      </button>
    {/each}
  </div>

  <div class="controls">
    <button onclick={() => moveCursor(-1)}>◀</button>
    <span class="selected-info">已选 {selected.size}/3</span>
    <button onclick={() => moveCursor(1)}>▶</button>
  </div>

  <button
    class="confirm-btn"
    disabled={selected.size !== 3}
    onclick={confirm}
  >
    确认出发
  </button>
</div>

<style>
  .team-select {
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px;
    background:
      radial-gradient(900px 460px at 80% -8%, rgba(74, 158, 255, 0.09), transparent 60%),
      radial-gradient(720px 420px at 10% 110%, rgba(245, 166, 35, 0.08), transparent 55%),
      var(--bg-base);
    overflow-y: auto;
  }
  .title {
    color: var(--text-primary);
    margin-bottom: 4px;
    letter-spacing: 2px;
    animation: fade-in-up 0.5s var(--ease-out-back) both;
  }
  .hint {
    color: var(--text-muted);
    font-size: 14px;
    margin-bottom: 24px;
  }
  .ball-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    max-width: 700px;
    width: 100%;
  }
  .ball-wrapper {
    position: relative;
    border: 2px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    padding: 12px;
    cursor: pointer;
    transition: all var(--transition-normal);
    min-height: 80px;
    box-shadow: var(--shadow-sm), var(--glass-shadow);
  }
  .ball-wrapper.cursor {
    border-color: var(--border-accent);
    transform: scale(1.05) translateY(-4px);
    box-shadow: var(--shadow-glow), var(--shadow-md), var(--glass-shadow);
    background: var(--bg-hover);
    min-height: 320px;
  }
  .ball-wrapper.selected {
    border-color: var(--success);
    box-shadow: 0 0 16px rgba(62, 207, 110, 0.25), var(--shadow-sm);
  }
  .ball-closed {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 60px;
    font-size: 28px;
    color: var(--text-muted);
    position: relative;
    font-family: var(--font-pixel);
  }
  .ball-num {
    font-size: 14px;
    position: absolute;
    bottom: 0;
    right: 0;
    color: var(--text-secondary);
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
    animation: fade-in-up 0.35s var(--ease-out-back) both;
  }
  .preview-sprite {
    width: 80px;
    height: 80px;
    object-fit: contain;
    image-rendering: pixelated;
    align-self: center;
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.5));
  }
  .pkm-name {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    text-transform: capitalize;
  }
  .pkm-types {
    display: flex;
    gap: 4px;
  }
  .type-badge {
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    font-size: 12px;
    color: white;
    text-transform: capitalize;
    box-shadow: inset 0 -1px 0 rgba(0,0,0,0.25);
  }
  .pkm-ability {
    font-size: 12px;
    color: var(--text-secondary);
  }
  .pkm-moves {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .move {
    font-size: 11px;
    padding: 2px 8px;
    background: var(--bg-secondary);
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }
  .pkm-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .selected-mark {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--success);
    color: #06230f;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: bold;
    box-shadow: 0 0 12px rgba(62, 207, 110, 0.5);
    animation: mark-pop 0.3s var(--ease-out-back) both;
    z-index: 2;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 16px;
  }
  .controls button {
    padding: 8px 18px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    background: var(--bg-elevated);
    transition: all var(--transition-fast);
  }
  .controls button:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-soft);
    transform: translateY(-1px);
  }
  .selected-info {
    color: var(--text-secondary);
    font-size: 16px;
  }
  .confirm-btn {
    margin-top: 16px;
    padding: 13px 52px;
    font-size: 18px;
    letter-spacing: 3px;
    border: 2px solid var(--border-accent);
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    color: var(--accent);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition-normal);
    box-shadow: var(--shadow-md), var(--glass-shadow), inset 0 0 0 1px var(--glass-highlight);
  }
  .confirm-btn:disabled {
    border-color: var(--border);
    color: var(--text-muted);
    cursor: not-allowed;
    background: rgba(20, 26, 44, 0.4);
    box-shadow: none;
  }
  .confirm-btn:not(:disabled):hover {
    background: var(--accent-gradient);
    color: var(--text-on-accent);
    border-color: var(--accent-hover);
    transform: translateY(-2px);
    box-shadow: var(--shadow-glow), var(--shadow-md);
  }
  .confirm-btn:not(:disabled):active { transform: translateY(0) scale(0.99); }
</style>
