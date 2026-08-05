<script lang="ts">
  import { gameStore } from '../stores/gameStore'

  function restart() {
    gameStore.reset()
  }
</script>

<div class="screen">
  <h1 class="title">恭喜通关！</h1>
  <p class="sub">你击败了重组联盟冠军</p>
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
      radial-gradient(760px 420px at 50% 32%, rgba(245, 166, 35, 0.14), transparent 65%),
      radial-gradient(900px 500px at 78% 110%, rgba(62, 207, 110, 0.1), transparent 60%),
      linear-gradient(160deg, #0a0d18, #101a30 60%, #0d1424);
  }
  .screen::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(480px 300px at 50% 34%, rgba(245, 166, 35, 0.16), transparent 70%);
    animation: pulse-glow 4s ease-in-out infinite;
  }
  .title {
    position: relative;
    font-size: 48px;
    color: var(--accent);
    letter-spacing: 6px;
    animation: breathe-glow 3s ease-in-out infinite, fade-in-up 0.6s var(--ease-out-back) both;
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
