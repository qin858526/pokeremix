<script lang="ts">
  import { onMount } from 'svelte'
  import { gameStore } from '../stores/gameStore'
  import { hasSave, loadGame } from '../stores/saveManager'
  import type { SaveData } from '../stores/saveManager'

  let loading = $state(false)
  let hasSavedGame = $state(false)

  onMount(() => {
    hasSavedGame = hasSave()
  })

  function startGame() {
    loading = true
    gameStore.startNewRun()
  }

  function continueGame() {
    loading = true
    const data = loadGame()
    if (data) {
      gameStore.loadRun(data.seed, data.currentFloor, data.playerTeam)
    } else {
      hasSavedGame = false
      loading = false
    }
  }
</script>

<div class="title-screen">
  <div class="content">
    <h1 class="title">宝可梦：重组</h1>
    <p class="subtitle">在混乱中组建最优队伍</p>
    <p class="desc">
      随机重组的能力组合 · 每战后强制交换 · 三选一改造进化
    </p>

    {#if hasSavedGame}
      <button class="start-btn continue" onclick={continueGame}>
        {loading ? '加载中...' : '继续游戏'}
      </button>
      <button class="start-btn" onclick={startGame}>
        新游戏（覆盖存档）
      </button>
    {:else}
      <button class="start-btn" onclick={startGame}>
        {loading ? '加载中...' : '开始新游戏'}
      </button>
    {/if}

    <button class="start-btn simulator-btn" onclick={() => gameStore.setPhase('simulator_setup')}>
      对战模拟器
    </button>
  </div>
</div>

<style>
  .title-screen {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    overflow: hidden;
    background:
      radial-gradient(1000px 520px at 72% -12%, rgba(74, 158, 255, 0.14), transparent 60%),
      radial-gradient(820px 460px at 18% 112%, rgba(245, 166, 35, 0.12), transparent 55%),
      linear-gradient(160deg, #0a0d18 0%, #0e1220 45%, #131a30 100%);
  }
  /* 背景光晕装饰（伪元素，不依赖模板） */
  .title-screen::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(520px 320px at 50% 30%, rgba(245, 166, 35, 0.1), transparent 70%);
    animation: pulse-glow 4.5s ease-in-out infinite;
  }
  /* 底部地平线微光 */
  .title-screen::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 220px;
    pointer-events: none;
    background: linear-gradient(180deg, transparent, rgba(245, 166, 35, 0.06) 60%, rgba(74, 158, 255, 0.08));
  }
  .content {
    position: relative;
    z-index: 1;
    text-align: center;
    animation: fade-in-up 0.6s var(--ease-out-back) both;
  }
  .title {
    font-family: var(--font-pixel);
    font-size: 46px;
    color: var(--accent);
    margin-bottom: 18px;
    letter-spacing: 4px;
    animation: breathe-glow 3.2s ease-in-out infinite;
  }
  .subtitle {
    font-size: 20px;
    color: var(--text-secondary);
    margin-bottom: 8px;
    letter-spacing: 6px;
  }
  .desc {
    font-size: 14px;
    color: var(--text-muted);
    margin-bottom: 44px;
    letter-spacing: 1px;
  }
  .start-btn {
    position: relative;
    display: block;
    overflow: hidden;
    margin: 0 auto 14px;
    padding: 15px 52px;
    font-size: 19px;
    font-weight: 600;
    border: 2px solid var(--border-accent);
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    color: var(--accent);
    border-radius: var(--radius-md);
    cursor: pointer;
    letter-spacing: 3px;
    box-shadow: var(--shadow-md), var(--glass-shadow), inset 0 0 0 1px var(--glass-highlight);
    transition: transform var(--transition-fast), box-shadow var(--transition-normal), border-color var(--transition-fast), background var(--transition-fast);
  }
  .start-btn:hover {
    background: var(--accent-gradient);
    color: var(--text-on-accent);
    border-color: var(--accent-hover);
    transform: translateY(-2px);
    box-shadow: var(--shadow-glow), var(--shadow-md), inset 0 0 0 1px rgba(255, 255, 255, 0.25);
  }
  .start-btn:active {
    transform: translateY(0) scale(0.99);
  }
  /* 按钮光扫过 */
  .start-btn::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 46%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.28), transparent);
    transform: translateX(-130%) skewX(-18deg);
    pointer-events: none;
  }
  .start-btn:hover::after {
    animation: shine-sweep 0.9s ease forwards;
  }
  .start-btn.continue {
    border-color: rgba(62, 207, 110, 0.55);
    color: var(--success);
  }
  .start-btn.continue:hover {
    background: linear-gradient(135deg, #57e083 0%, #3ecf6e 55%, #2db85c 100%);
    color: #06230f;
    border-color: var(--success);
    box-shadow: 0 0 22px rgba(62, 207, 110, 0.4), var(--shadow-md);
  }
  .simulator-btn {
    margin-top: 34px;
    padding: 10px 38px;
    font-size: 15px;
    letter-spacing: 2px;
    border-color: var(--border-hover);
    color: var(--text-secondary);
    background: rgba(20, 26, 44, 0.5);
    box-shadow: var(--shadow-sm), var(--glass-shadow);
  }
  .simulator-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--text-secondary);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
</style>
