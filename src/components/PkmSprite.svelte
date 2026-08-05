<script lang="ts">
  let { dexId, name, back = false, size = 64 }: {
    dexId: number
    name: string
    back?: boolean
    size?: number
  } = $props()

  let hidden = $state(false)
  let src = $derived(back ? `/sprites/back/${dexId}.png` : `/sprites/${dexId}.png`)
</script>

{#if !hidden}
  <img
    class="pkm-sprite"
    src={src}
    alt={name}
    style="width: {size}px; height: {size}px"
    onerror={() => hidden = true}
  />
{/if}

<style>
  .pkm-sprite {
    object-fit: contain;
    image-rendering: pixelated;
    display: block;
  }
</style>
