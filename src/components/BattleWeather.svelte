<script lang="ts">
  // 天气视觉层：在战斗场地上叠加动态天气特效（雨 / 阳光 / 沙暴 / 冰雹）
  // 仅做纯 CSS 动画叠加，不影响交互（pointer-events: none）
  let { weather = 'none' }: { weather: string } = $props()
</script>

{#if weather !== 'none'}
  <div class="weather-layer weather-{weather}" aria-hidden="true">
    {#if weather === 'sun'}
      <div class="sun-core"></div>
      <div class="sun-rays"></div>
      <div class="sun-glow"></div>
    {:else if weather === 'rain'}
      {#each Array(20) as _, i (i)}
        <div
          class="rain-drop"
          style="left: {(i * 5.3) % 100}%; animation-delay: {(i * 0.13).toFixed(2)}s; animation-duration: {(0.55 + (i % 5) * 0.07).toFixed(2)}s"
        ></div>
      {/each}
    {:else if weather === 'sandstorm'}
      {#each Array(26) as _, i (i)}
        <div
          class="sand-particle"
          style="left: {(i * 4.2) % 100}%; top: {(i * 11) % 100}%; animation-delay: {(i * 0.11).toFixed(2)}s; animation-duration: {(1.3 + (i % 6) * 0.22).toFixed(2)}s"
        ></div>
      {/each}
    {:else if weather === 'hail'}
      {#each Array(22) as _, i (i)}
        <div
          class="hail-flake"
          style="left: {(i * 4.8) % 100}%; animation-delay: {(i * 0.17).toFixed(2)}s; animation-duration: {(1.1 + (i % 4) * 0.16).toFixed(2)}s"
        ></div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .weather-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 3;
    overflow: hidden;
  }

  /* ===== 大晴天：金色光核 + 旋转光芒 + 暖色光晕 ===== */
  .sun-core {
    position: absolute;
    top: 4%;
    left: 50%;
    transform: translateX(-50%);
    width: 130px;
    height: 130px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 226, 140, 0.95) 0%, rgba(255, 174, 48, 0.6) 45%, transparent 72%);
    filter: blur(1px);
    animation: sun-pulse 3.2s ease-in-out infinite;
  }
  .sun-rays {
    position: absolute;
    top: 4%;
    left: 50%;
    width: 360px;
    height: 360px;
    transform: translate(-50%, -22%);
    background: conic-gradient(
      from 0deg,
      rgba(255, 205, 95, 0) 0deg,
      rgba(255, 205, 95, 0.16) 18deg,
      transparent 38deg,
      rgba(255, 205, 95, 0.16) 58deg,
      transparent 78deg,
      rgba(255, 205, 95, 0.16) 98deg,
      transparent 118deg,
      rgba(255, 205, 95, 0.16) 138deg,
      transparent 158deg,
      rgba(255, 205, 95, 0.16) 178deg,
      transparent 198deg,
      rgba(255, 205, 95, 0.16) 218deg,
      transparent 238deg,
      rgba(255, 205, 95, 0.16) 258deg,
      transparent 278deg,
      rgba(255, 205, 95, 0.16) 298deg,
      transparent 318deg,
      rgba(255, 205, 95, 0.16) 338deg,
      transparent 358deg
    );
    animation: sun-rotate 26s linear infinite;
    opacity: 0.55;
  }
  .sun-glow {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at 50% 0%, rgba(255, 196, 80, 0.16) 0%, transparent 55%);
  }
  @keyframes sun-pulse {
    0%, 100% { opacity: 0.85; transform: translateX(-50%) scale(1); }
    50%      { opacity: 1;    transform: translateX(-50%) scale(1.08); }
  }
  @keyframes sun-rotate {
    to { transform: translate(-50%, -22%) rotate(360deg); }
  }

  /* ===== 下雨：蓝色斜向雨丝 ===== */
  .rain-drop {
    position: absolute;
    top: -12%;
    width: 2px;
    height: 64px;
    background: linear-gradient(transparent, rgba(150, 200, 255, 0.85));
    transform: rotate(12deg);
    animation: rain-fall linear infinite;
  }
  @keyframes rain-fall {
    0%   { transform: translateY(-20%) rotate(12deg); opacity: 0; }
    10%  { opacity: 1; }
    100% { transform: translateY(118vh) rotate(12deg); opacity: 0.65; }
  }

  /* ===== 沙暴：暖褐色横向吹卷粒子 ===== */
  .sand-particle {
    position: absolute;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: rgba(214, 184, 124, 0.5);
    filter: blur(1px);
    animation: sand-blow linear infinite;
  }
  @keyframes sand-blow {
    0%   { transform: translate(-12vw, 0);     opacity: 0; }
    12%  { opacity: 0.7; }
    100% { transform: translate(112vw, -9vh);   opacity: 0; }
  }

  /* ===== 冰雹：浅蓝冰粒飘落 ===== */
  .hail-flake {
    position: absolute;
    top: -6%;
    width: 9px;
    height: 11px;
    border-radius: 50%;
    background: rgba(222, 237, 255, 0.9);
    box-shadow: 0 0 6px rgba(180, 212, 255, 0.7);
    animation: hail-fall linear infinite;
  }
  @keyframes hail-fall {
    0%   { transform: translateY(-12%); opacity: 0; }
    10%  { opacity: 1; }
    100% { transform: translateY(116vh); opacity: 0.8; }
  }
</style>
