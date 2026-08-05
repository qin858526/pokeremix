<script lang="ts">
  let { current = 0, max = 1, showText = true, height = 6, animated = true }: {
    current: number
    max: number
    showText?: boolean
    height?: number
    animated?: boolean
  } = $props()

  let percent = $derived(Math.max(0, Math.min(100, (current / max) * 100)))

  let barColor = $derived(
    percent > 50 ? 'var(--success)' : percent > 25 ? 'var(--warning)' : 'var(--danger)',
  )
</script>

<div class="hp-bar-wrapper" style="--bar-height: {height}px">
  <div class="hp-bar-bg">
    <div
      class="hp-bar-fill"
      class:animated
      style="width: {percent}%; background: {barColor}"
    ></div>
  </div>
  {#if showText}
    <span class="hp-text">{Math.max(0, current)}/{max}</span>
  {/if}
</div>

<style>
  .hp-bar-wrapper {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hp-bar-bg {
    flex: 1;
    height: var(--bar-height);
    background: var(--bg-inset);
    border-radius: calc(var(--bar-height) / 2);
    overflow: hidden;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  }
  .hp-bar-fill {
    height: 100%;
    border-radius: calc(var(--bar-height) / 2);
    transition: width 0.3s ease;
  }
  .hp-bar-fill.animated {
    transition: width 0.4s ease;
  }
  .hp-text {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    flex-shrink: 0;
  }
</style>
