<script lang="ts">
  import { gameStore } from '../stores/gameStore'

  function restart() {
    gameStore.reset()
  }
</script>

<div class="screen">
  <h1 class="title">游戏结束</h1>
  <p class="sub">你的队伍全军覆没了…</p>
  <button class="btn" onclick={restart}>返回主页</button>
</div>

<style>
  .screen {
    position: relative;
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    overflow: hidden;
    background:
      radial-gradient(760px 420px at 50% 30%, rgba(255, 90, 95, 0.12), transparent 65%),
      radial-gradient(900px 500px at 20% 110%, rgba(74, 158, 255, 0.08), transparent 60%),
      linear-gradient(160deg, #120a12, #1a0f18 55%, #0d1424);
  }
  .screen::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(480px 300px at 50% 32%, rgba(255, 90, 95, 0.14), transparent 70%);
    animation: pulse-glow 4s ease-in-out infinite;
  }
  .title {
    position: relative;
    font-size: 48px;
    color: var(--danger);
    letter-spacing: 6px;
    animation: fade-in-up 0.6s var(--ease-out-back) both;
    text-shadow: 0 0 22px rgba(255, 90, 95, 0.4), 0 2px 4px rgba(0,0,0,0.6);
  }
  .sub { position: relative; color: var(--text-secondary); letter-spacing: 2px; animation: fade-in-up 0.6s 0.15s var(--ease-out-back) both; }
  .btn {
    position: relative;
    padding: 13px 42px;
    border: 2px solid var(--border-accent);
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    color: var(--accent);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: 18px;
    letter-spacing: 2px;
    box-shadow: var(--shadow-md), var(--glass-shadow), inset 0 0 0 1px var(--glass-highlight);
    transition: all var(--transition-fast);
    animation: fade-in-up 0.6s 0.3s var(--ease-out-back) both;
  }
  .btn:hover {
    background: var(--accent-gradient);
    color: var(--text-on-accent);
    border-color: var(--accent-hover);
    transform: translateY(-2px);
    box-shadow: var(--shadow-glow), var(--shadow-md);
  }
</style>
