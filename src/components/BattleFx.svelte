<script lang="ts">
  // 技能命中特效：按属性分类的 CSS 爆发效果
  // 纯 CSS + 绝对定位 + 伪元素实现，不引入 canvas/three
  import { TYPE_COLORS } from '../game/data/types'

  let {
    type,
    side = 'enemy',
    key = 0,
  }: {
    /** 技能属性（决定特效形态） */
    type: string
    /** 受击方（决定特效挂载位置：player 靠左 / enemy 靠右） */
    side?: 'player' | 'enemy'
    /** 每次触发传不同 key 强制重建动画 */
    key?: number
  } = $props()

  // 属性主色（TYPE_COLORS 配色，统一视觉）
  let color = $derived(TYPE_COLORS[type as keyof typeof TYPE_COLORS] ?? '#ffffff')
</script>

{#key key}
  <div class="battle-fx fx-{type} {side}" style="--fx-color: {color}" aria-hidden="true">
    <!-- 主爆发层 -->
    <div class="fx-burst"></div>
    <!-- 光晕层 -->
    <div class="fx-halo"></div>
    <!-- 散落粒子层（伪元素承载） -->
    <div class="fx-particles"></div>
  </div>
{/key}

<style>
  /* ===== 特效容器（挂在目标精灵容器上，覆盖整个精灵区域） ===== */
  .battle-fx {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 30;
    overflow: visible;
  }

  /* 主爆发：缩放扩散 + 淡出 */
  .fx-burst {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 40px;
    height: 40px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: radial-gradient(circle, var(--fx-color) 0%, transparent 68%);
    opacity: 0;
    animation: fx-burst 0.5s ease-out forwards;
  }

  /* 光晕：外圈扩散光环 */
  .fx-halo {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 30px;
    height: 30px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 3px solid var(--fx-color);
    opacity: 0;
    animation: fx-halo 0.5s ease-out forwards;
  }

  /* 散落粒子：多个小颗粒向四周飞散 */
  .fx-particles {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
  }
  .fx-particles::before,
  .fx-particles::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fx-color);
    opacity: 0;
  }
  .fx-particles::before {
    animation: fx-particle-1 0.55s ease-out forwards;
  }
  .fx-particles::after {
    animation: fx-particle-2 0.55s ease-out forwards;
  }

  /* ===== 核心动画 ===== */
  @keyframes fx-burst {
    0%   { opacity: 0.95; transform: translate(-50%, -50%) scale(0.3); }
    60%  { opacity: 0.85; transform: translate(-50%, -50%) scale(1.5); }
    100% { opacity: 0;    transform: translate(-50%, -50%) scale(2.1); }
  }
  @keyframes fx-halo {
    0%   { opacity: 0.9;  transform: translate(-50%, -50%) scale(0.4); }
    100% { opacity: 0;    transform: translate(-50%, -50%) scale(2.6); }
  }
  @keyframes fx-particle-1 {
    0%   { opacity: 1; transform: translate(0, 0) scale(1); }
    100% { opacity: 0; transform: translate(26px, -22px) scale(0.4); }
  }
  @keyframes fx-particle-2 {
    0%   { opacity: 1; transform: translate(0, 0) scale(1); }
    100% { opacity: 0; transform: translate(-24px, 18px) scale(0.4); }
  }

  /* ===== 属性差异化形态 ===== */

  /* 火焰：火苗向上窜动 */
  .fx-fire .fx-burst {
    border-radius: 50% 50% 20% 50%;
    animation-name: fx-fire-burst;
  }
  .fx-fire .fx-particles::before,
  .fx-fire .fx-particles::after {
    border-radius: 50% 50% 0 50%;
    animation-name: fx-fire-particle;
  }
  @keyframes fx-fire-burst {
    0%   { opacity: 0.95; transform: translate(-50%, -50%) scale(0.3) rotate(-12deg); }
    60%  { opacity: 0.8;  transform: translate(-50%, -58%) scale(1.4) rotate(-12deg); }
    100% { opacity: 0;    transform: translate(-50%, -78%) scale(1.8) rotate(-12deg); }
  }
  @keyframes fx-fire-particle {
    0%   { opacity: 1; transform: translate(0, 0) scale(1); }
    100% { opacity: 0; transform: translate(6px, -30px) scale(0.3); }
  }

  /* 水：水滴上扬 + 蓝色光晕 */
  .fx-water .fx-halo { border-style: dashed; }
  .fx-water .fx-particles::before,
  .fx-water .fx-particles::after {
    border-radius: 2px;
    animation-name: fx-water-particle;
  }
  @keyframes fx-water-particle {
    0%   { opacity: 1; transform: translate(0, 0) scale(1); }
    100% { opacity: 0; transform: translate(8px, -26px) scale(0.5); }
  }

  /* 电：锯齿形电弧（用多段 transform 模拟） */
  .fx-electric .fx-burst {
    border-radius: 2px;
    box-shadow: 0 0 14px var(--fx-color), 0 0 30px var(--fx-color);
    animation-name: fx-electric-burst;
  }
  @keyframes fx-electric-burst {
    0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.2) skewX(20deg); }
    25%  { opacity: 0.6; transform: translate(-50%, -50%) scale(0.9) skewX(-30deg); }
    50%  { opacity: 0.9; transform: translate(-50%, -50%) scale(0.6) skewX(25deg); }
    100% { opacity: 0;   transform: translate(-50%, -50%) scale(1.6) skewX(-15deg); }
  }

  /* 草：绿叶旋转飞散 */
  .fx-grass .fx-burst {
    border-radius: 60% 0 60% 0;
    animation-name: fx-grass-burst;
  }
  .fx-grass .fx-particles::before,
  .fx-grass .fx-particles::after {
    border-radius: 60% 0 60% 0;
    animation-name: fx-grass-particle;
  }
  @keyframes fx-grass-burst {
    0%   { opacity: 0.95; transform: translate(-50%, -50%) scale(0.3) rotate(0deg); }
    100% { opacity: 0;    transform: translate(-50%, -50%) scale(2) rotate(120deg); }
  }
  @keyframes fx-grass-particle {
    0%   { opacity: 1; transform: translate(0, 0) rotate(0deg) scale(1); }
    100% { opacity: 0; transform: translate(20px, 14px) rotate(200deg) scale(0.3); }
  }

  /* 冰：冰晶碎裂（菱形） */
  .fx-ice .fx-burst {
    border-radius: 4px;
    animation-name: fx-ice-burst;
  }
  .fx-ice .fx-particles::before,
  .fx-ice .fx-particles::after {
    border-radius: 2px;
    animation-name: fx-ice-particle;
  }
  @keyframes fx-ice-burst {
    0%   { opacity: 0.95; transform: translate(-50%, -50%) scale(0.3) rotate(45deg); }
    100% { opacity: 0;    transform: translate(-50%, -50%) scale(1.9) rotate(135deg); }
  }
  @keyframes fx-ice-particle {
    0%   { opacity: 1; transform: translate(0, 0) rotate(0deg) scale(1); }
    100% { opacity: 0; transform: translate(-28px, -14px) rotate(160deg) scale(0.3); }
  }

  /* 格斗：冲击波（环形扩散） */
  .fx-fighting .fx-burst {
    border-radius: 50%;
    background: transparent;
    border: 5px solid var(--fx-color);
    animation-name: fx-fighting-burst;
  }
  @keyframes fx-fighting-burst {
    0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.2); }
    100% { opacity: 0; transform: translate(-50%, -50%) scale(2.4); }
  }

  /* 一般：白色打击闪光（快速白闪） */
  .fx-normal .fx-burst {
    background: radial-gradient(circle, #ffffff 0%, rgba(255,255,255,0.4) 40%, transparent 70%);
    animation-name: fx-normal-burst;
  }
  @keyframes fx-normal-burst {
    0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.2); }
    40%  { opacity: 0.9; transform: translate(-50%, -50%) scale(1.1); }
    100% { opacity: 0; transform: translate(-50%, -50%) scale(1.6); }
  }

  /* 超能力：紫色光波（两道光环交错） */
  .fx-psychic .fx-halo {
    border-color: var(--fx-color);
    animation-name: fx-psychic-halo;
  }
  .fx-psychic .fx-burst {
    animation-name: fx-psychic-burst;
  }
  @keyframes fx-psychic-halo {
    0%   { opacity: 0.8; transform: translate(-50%, -50%) scale(0.3) rotate(0deg); }
    100% { opacity: 0;   transform: translate(-50%, -50%) scale(2.8) rotate(90deg); }
  }
  @keyframes fx-psychic-burst {
    0%   { opacity: 0.9; transform: translate(-50%, -50%) scale(0.3); }
    100% { opacity: 0;   transform: translate(-50%, -50%) scale(2); }
  }

  /* 恶：暗影吞噬（暗色蔓延 + 紫黑） */
  .fx-dark .fx-burst {
    background: radial-gradient(circle, rgba(10, 8, 20, 0.9) 0%, rgba(60, 40, 90, 0.6) 45%, transparent 72%);
    animation-name: fx-dark-burst;
  }
  @keyframes fx-dark-burst {
    0%   { opacity: 0.95; transform: translate(-50%, -50%) scale(0.3); }
    70%  { opacity: 0.7;  transform: translate(-50%, -50%) scale(1.7); }
    100% { opacity: 0;    transform: translate(-50%, -50%) scale(2.2); }
  }

  /* 龙：紫蓝龙息（斜向光柱） */
  .fx-dragon .fx-burst {
    border-radius: 40%;
    box-shadow: 0 0 18px var(--fx-color);
    animation-name: fx-dragon-burst;
  }
  @keyframes fx-dragon-burst {
    0%   { opacity: 0.95; transform: translate(-50%, -50%) scale(0.3) rotate(-30deg); }
    100% { opacity: 0;    transform: translate(-50%, -50%) scale(2.2, 1.4) rotate(-30deg); }
  }

  /* 地面：尘土飞溅（土色粒子向下） */
  .fx-ground .fx-particles::before,
  .fx-ground .fx-particles::after {
    border-radius: 2px;
    animation-name: fx-ground-particle;
  }
  @keyframes fx-ground-particle {
    0%   { opacity: 1; transform: translate(0, 0) scale(1); }
    100% { opacity: 0; transform: translate(18px, 24px) scale(0.4); }
  }

  /* 岩石：碎石四射（方形碎片） */
  .fx-rock .fx-particles::before,
  .fx-rock .fx-particles::after {
    border-radius: 2px;
    animation-name: fx-rock-particle;
  }
  @keyframes fx-rock-particle {
    0%   { opacity: 1; transform: translate(0, 0) rotate(0deg) scale(1); }
    100% { opacity: 0; transform: translate(-20px, 20px) rotate(140deg) scale(0.5); }
  }

  /* 钢：金属闪光（银色十字闪光） */
  .fx-steel .fx-burst {
    background: radial-gradient(circle, #ffffff 0%, rgba(184, 184, 208, 0.7) 30%, transparent 65%);
    animation-name: fx-steel-burst;
  }
  @keyframes fx-steel-burst {
    0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.15); }
    45%  { opacity: 0.9; transform: translate(-50%, -50%) scale(1.2); }
    100% { opacity: 0; transform: translate(-50%, -50%) scale(1.7); }
  }

  /* 妖精：粉红星屑（小粒子多向） */
  .fx-fairy .fx-particles::before,
  .fx-fairy .fx-particles::after {
    border-radius: 50%;
    box-shadow: 0 0 8px var(--fx-color);
    animation-name: fx-fairy-particle;
  }
  @keyframes fx-fairy-particle {
    0%   { opacity: 1; transform: translate(0, 0) scale(1); }
    100% { opacity: 0; transform: translate(-16px, -20px) scale(0.2); }
  }

  /* 虫：绿色虫影（两个粒子快速抖动） */
  .fx-bug .fx-particles::before,
  .fx-bug .fx-particles::after {
    animation-name: fx-bug-particle;
  }
  @keyframes fx-bug-particle {
    0%   { opacity: 1; transform: translate(0, 0) scale(1); }
    30%  { opacity: 0.8; transform: translate(10px, -6px) scale(0.9); }
    60%  { opacity: 0.6; transform: translate(-8px, 8px) scale(0.7); }
    100% { opacity: 0; transform: translate(16px, -14px) scale(0.4); }
  }

  /* 毒：紫色毒雾（扩散 + 缓慢消失） */
  .fx-poison .fx-burst {
    background: radial-gradient(circle, rgba(160, 64, 160, 0.55) 0%, transparent 62%);
    animation-name: fx-poison-burst;
  }
  @keyframes fx-poison-burst {
    0%   { opacity: 0.9; transform: translate(-50%, -50%) scale(0.4); }
    100% { opacity: 0;   transform: translate(-50%, -50%) scale(2.4); }
  }

  /* 幽灵：幽蓝鬼火（上飘） */
  .fx-ghost .fx-burst {
    background: radial-gradient(circle, rgba(112, 88, 152, 0.8) 0%, transparent 60%);
    animation-name: fx-ghost-burst;
  }
  @keyframes fx-ghost-burst {
    0%   { opacity: 0.9; transform: translate(-50%, -50%) scale(0.4); }
    100% { opacity: 0;   transform: translate(-50%, -80%) scale(1.8); }
  }

  /* 飞行：白色风刃（斜向风刃） */
  .fx-flying .fx-burst {
    border-radius: 30% 70% 50% 50%;
    background: radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(168, 144, 240, 0.5) 45%, transparent 70%);
    animation-name: fx-flying-burst;
  }
  @keyframes fx-flying-burst {
    0%   { opacity: 0.9; transform: translate(-50%, -50%) scale(0.3) rotate(20deg); }
    100% { opacity: 0;   transform: translate(-50%, -50%) scale(1.9) rotate(60deg); }
  }
</style>
