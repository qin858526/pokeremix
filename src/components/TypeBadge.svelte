<script lang="ts">
  import { TYPE_COLORS } from '../game/data/types'
  import { getTypeZh } from '../game/data/type-zh'
  import type { Type } from '../game/data/types'

  let { type, size = 'md' }: { type: string | null | undefined; size?: 'sm' | 'md' | 'lg' } = $props()
</script>

{#if type}
  <span
    class="type-badge {size}"
    style="background: {TYPE_COLORS[type as keyof typeof TYPE_COLORS] ?? '#888'}"
  >{getTypeZh(type)}</span>
{/if}

<style>
  .type-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-pill);
    color: white;
    font-weight: 600;
    white-space: nowrap;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
    box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.22), 0 1px 2px rgba(0, 0, 0, 0.3);
    letter-spacing: 0.3px;
  }
  .sm {
    padding: 0 4px;
    font-size: 10px;
    line-height: 16px;
  }
  .md {
    padding: 1px 6px;
    font-size: 11px;
    line-height: 18px;
  }
  .lg {
    padding: 2px 10px;
    font-size: 13px;
    line-height: 22px;
  }
</style>
