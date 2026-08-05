<script lang="ts">
  interface Props<T> {
    items: T[]
    label: (item: T) => string
    sublabel?: (item: T) => string
    group?: (item: T) => string
    value?: string
    searchPlaceholder?: string
    onselect: (item: T) => void
    onclose: () => void
  }

  let { items, label, sublabel, group, value, searchPlaceholder = '搜索...', onselect, onclose }: Props<any> = $props()

  let search = $state('')

  let filtered = $derived.by(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter(item => label(item).toLowerCase().includes(q) || (sublabel ? sublabel(item).toLowerCase().includes(q) : false))
  })

  let grouped = $derived.by(() => {
    if (!group) return null
    const map = new Map<string, any[]>()
    for (const item of filtered) {
      const g = group(item) || '其他'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(item)
    }
    return [...map.entries()]
  })

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose()
  }

  function autofocusInput(node: HTMLInputElement) {
    node.focus()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="picker-overlay" onclick={onclose} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && onclose()}>
  <div class="picker-modal" onclick={(e) => e.stopPropagation()} role="presentation" onkeydown={(e) => e.stopPropagation()}>
    <div class="picker-header">
      <input
        class="search-input"
        type="text"
        placeholder={searchPlaceholder}
        bind:value={search}
        use:autofocusInput
      />
      <button class="close-btn" onclick={onclose}>✕</button>
    </div>
    <div class="picker-list">
      {#if filtered.length === 0}
        <div class="empty">无匹配结果</div>
      {:else if grouped}
        {#each grouped as [g, gItems]}
          <div class="group-label">{g}</div>
          {#each gItems as item}
            <button
              class="picker-item"
              class:selected={value !== undefined && label(item) === value}
              onclick={() => onselect(item)}
            >
              <span class="item-label">{label(item)}</span>
              {#if sublabel}
                <span class="item-sublabel">{sublabel(item)}</span>
              {/if}
            </button>
          {/each}
        {/each}
      {:else}
        {#each filtered as item}
          <button
            class="picker-item"
            class:selected={value !== undefined && label(item) === value}
            onclick={() => onselect(item)}
          >
            <span class="item-label">{label(item)}</span>
            {#if sublabel}
              <span class="item-sublabel">{sublabel(item)}</span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .picker-overlay {
    position: fixed;
    inset: 0;
    background: rgba(6, 8, 16, 0.72);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fade-in 0.2s ease;
  }
  .picker-modal {
    background: var(--glass-bg-strong);
    backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    width: min(500px, 90vw);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg), var(--glass-shadow), inset 0 0 0 1px var(--glass-highlight);
    animation: pop-in-soft 0.25s var(--ease-out-back) both;
  }
  .picker-header {
    display: flex;
    gap: 8px;
    padding: 12px;
    border-bottom: 1px solid var(--border);
  }
  .search-input {
    flex: 1;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-inset);
    color: var(--text-primary);
    font-size: 15px;
    outline: none;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }
  .search-input:focus {
    border-color: var(--border-accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .close-btn {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    transition: all var(--transition-fast);
  }
  .close-btn:hover { color: var(--accent); border-color: var(--accent); }
  .picker-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
  }
  .group-label {
    padding: 8px 12px 4px;
    font-size: 12px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .picker-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 10px 14px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
  }
  .picker-item:hover { background: rgba(255, 255, 255, 0.06); }
  .picker-item.selected { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--border-accent); }
  .item-label { font-size: 14px; }
  .item-sublabel { font-size: 12px; color: var(--text-muted); }
  .empty { padding: 24px; text-align: center; color: var(--text-muted); }
</style>
