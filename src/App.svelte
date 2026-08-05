<script lang="ts">
  import { onMount } from 'svelte'
  import './styles/variables.css'
  import './styles/global.css'
  import './styles/animations.css'
  import Home from './routes/Home.svelte'
  import TeamSelect from './routes/TeamSelect.svelte'
  import Battle from './routes/Battle.svelte'
  import Reward from './routes/Reward.svelte'
  import Victory from './routes/Victory.svelte'
  import GameOver from './routes/GameOver.svelte'
  import SimulatorSetup from './routes/SimulatorSetup.svelte'
  import { gameStore } from './stores/gameStore'

  let phase = $state('title')

  onMount(() => {
    gameStore.subscribe(g => {
      phase = g.phase
    })
  })
</script>

{#if phase === 'title'}
  <Home />
{:else if phase === 'team_select'}
  <TeamSelect />
{:else if phase === 'battle'}
  <Battle />
{:else if phase === 'reward_exchange' || phase === 'reward_modify'}
  <Reward />
{:else if phase === 'victory'}
  <Victory />
{:else if phase === 'game_over'}
  <GameOver />
{:else if phase === 'simulator_setup'}
  <SimulatorSetup />
{:else if phase === 'simulator_battle'}
  <Battle simulator={true} />
{/if}
