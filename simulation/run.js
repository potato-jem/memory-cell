#!/usr/bin/env node
/**
 * simulation/run.js
 *
 * CLI entry point for the headless simulation harness.
 *
 * Usage:
 *   node simulation/run.js --strategy random --runs 20
 *   node simulation/run.js --strategy greedy --runs 50 --seed 42
 *   node simulation/run.js --strategy conservative --runs 30 --output results.json
 *
 * Options:
 *   --strategy   random | greedy | conservative   (default: random)
 *   --runs       number of games to simulate      (default: 20)
 *   --seed       integer seed for reproducibility (default: 1)
 *   --maxTurns   turn ceiling per game            (default: 500)
 *   --output     path to write full JSON log      (optional)
 *   --quiet      suppress per-run progress lines  (optional)
 *   --omniscient strategy receives full ground truth instead of perceived state (optional)
 */

import { writeFileSync } from 'fs';
import { runGame } from './engine.js';
import { getStrategy } from './strategies.js';
import { makeRng, childSeed } from './rng.js';

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    strategy: 'random',
    runs: 20,
    seed: 1,
    maxTurns: 500,
    output: null,
    quiet: false,
    omniscient: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];

    switch (flag) {
      case '--strategy': args.strategy = value; i++; break;
      case '--runs':     args.runs = parseInt(value, 10); i++; break;
      case '--seed':     args.seed = parseInt(value, 10); i++; break;
      case '--maxTurns': args.maxTurns = parseInt(value, 10); i++; break;
      case '--output':    args.output = value; i++; break;
      case '--quiet':     args.quiet = true; break;
      case '--omniscient': args.omniscient = true; break;
      default:
        if (flag.startsWith('--')) {
          console.error(`Unknown flag: ${flag}`);
          process.exit(1);
        }
    }
  }

  return args;
}

// ── Statistics ────────────────────────────────────────────────────────────────

function median(sorted) {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ── Reporting ─────────────────────────────────────────────────────────────────

function buildReport(results, args) {
  const n = results.length;
  const wins = results.filter(r => r.outcome === 'win');
  const losses = results.filter(r => r.outcome === 'loss');
  const timeouts = results.filter(r => r.outcome === 'timeout');

  const turns = results.map(r => r.turns).sort((a, b) => a - b);
  const lossTurns = losses.map(r => r.turns).sort((a, b) => a - b);

  // Action frequency aggregated across all runs
  const totalActions = {};
  for (const r of results) {
    for (const [type, count] of Object.entries(r.actionFrequency ?? {})) {
      totalActions[type] = (totalActions[type] ?? 0) + count;
    }
  }

  // Named event frequency
  const namedEventCounts = {};
  for (const r of results) {
    for (const ev of (r.namedEvents ?? [])) {
      namedEventCounts[ev.type] = (namedEventCounts[ev.type] ?? 0) + 1;
    }
  }

  // Engagement by pathogen type — how often each type spawned / was cleared
  const spawns = {};
  const clears = {};
  for (const r of results) {
    for (const ev of (r.namedEvents ?? [])) {
      if (ev.type === 'pathogen_spawned') {
        const t = ev.detail?.pathogenType ?? 'unknown';
        spawns[t] = (spawns[t] ?? 0) + 1;
      }
      if (ev.type === 'pathogen_cleared') {
        const t = ev.detail?.pathogenType ?? 'unknown';
        clears[t] = (clears[t] ?? 0) + 1;
      }
    }
  }

  // Dead content check — pathogen types that were never cleared in any run
  const neverCleared = Object.keys(spawns).filter(t => !(t in clears));

  // Modifier statistics — split by category
  const upgradeCounts = {};
  const scarChoiceCounts = {};
  const scarCounts = {};
  for (const r of results) {
    for (const ev of (r.namedEvents ?? [])) {
      if (ev.type === 'modifier_chosen') {
        const key = `${ev.detail?.modifierId ?? '?'} (${ev.detail?.rarity ?? '?'})`;
        if (ev.detail?.category === 'scar') {
          scarChoiceCounts[key] = (scarChoiceCounts[key] ?? 0) + 1;
        } else {
          upgradeCounts[key] = (upgradeCounts[key] ?? 0) + 1;
        }
      }
      if (ev.type === 'scar_earned') {
        const key = ev.detail?.scarId ?? '?';
        scarCounts[key] = (scarCounts[key] ?? 0) + 1;
      }
    }
  }
  const modifierCounts = { ...upgradeCounts, ...scarChoiceCounts };

  // Stress spikes and node events
  const integrityHitRuns = results.filter(r =>
    (r.namedEvents ?? []).some(e => e.type === 'integrity_hit')
  ).length;

  const stressSpikeRuns = results.filter(r =>
    (r.namedEvents ?? []).some(e => e.type === 'stress_spike')
  ).length;

  return {
    config: {
      strategy: args.strategy,
      omniscient: args.omniscient,
      runs: n,
      seed: args.seed,
      maxTurns: args.maxTurns,
    },
    upgradeCounts,
    scarChoiceCounts,
    scarCounts,
    outcomes: {
      win:     wins.length,
      loss:    losses.length,
      timeout: timeouts.length,
      winRate:     (wins.length  / n * 100).toFixed(1) + '%',
      lossRate:    (losses.length / n * 100).toFixed(1) + '%',
      timeoutRate: (timeouts.length / n * 100).toFixed(1) + '%',
    },
    turnCounts: {
      mean:   Math.round(mean(turns)),
      median: Math.round(median(turns)),
      p10:    Math.round(percentile(turns, 10)),
      p90:    Math.round(percentile(turns, 90)),
      min:    turns[0] ?? 0,
      max:    turns[turns.length - 1] ?? 0,
    },
    lossTurnCounts: losses.length > 0 ? {
      mean:   Math.round(mean(lossTurns)),
      median: Math.round(median(lossTurns)),
      p10:    Math.round(percentile(lossTurns, 10)),
      p90:    Math.round(percentile(lossTurns, 90)),
    } : null,
    actionFrequency: totalActions,
    pathogenSpawns: spawns,
    pathogenClears: clears,
    neverClearedPathogens: neverCleared,
    systemicEvents: {
      runsWithIntegrityHit: integrityHitRuns,
      runsWithStressSpike:  stressSpikeRuns,
    },
  };
}

function printReport(report) {
  const { config, outcomes, turnCounts, lossTurnCounts, actionFrequency,
          pathogenSpawns, pathogenClears, neverClearedPathogens, systemicEvents,
          upgradeCounts, scarChoiceCounts, scarCounts } = report;

  const hr = '─'.repeat(58);

  console.log('');
  console.log('Memory Cell — Balance Simulation Report');
  console.log(hr);
  const omniscientTag = config.omniscient ? '  [OMNISCIENT]' : '  [perceived state]';
  console.log(`Strategy : ${config.strategy}${omniscientTag}`);
  console.log(`Runs     : ${config.runs}   Seed: ${config.seed}   Max turns: ${config.maxTurns}`);
  console.log(hr);

  console.log('');
  console.log('OUTCOMES');
  console.log(`  Win       ${outcomes.win.toString().padStart(4)} / ${config.runs}   (${outcomes.winRate})`);
  console.log(`  Loss      ${outcomes.loss.toString().padStart(4)} / ${config.runs}   (${outcomes.lossRate})`);
  console.log(`  Timeout   ${outcomes.timeout.toString().padStart(4)} / ${config.runs}   (${outcomes.timeoutRate})`);

  console.log('');
  console.log('TURN COUNTS (all runs)');
  console.log(`  Mean   ${turnCounts.mean}   Median ${turnCounts.median}   p10 ${turnCounts.p10}   p90 ${turnCounts.p90}`);
  console.log(`  Min    ${turnCounts.min}   Max    ${turnCounts.max}`);

  if (lossTurnCounts) {
    console.log('');
    console.log('TURN COUNTS (loss runs only)');
    console.log(`  Mean   ${lossTurnCounts.mean}   Median ${lossTurnCounts.median}   p10 ${lossTurnCounts.p10}   p90 ${lossTurnCounts.p90}`);
  }

  console.log('');
  console.log('ACTION FREQUENCY');
  const totalActions = Object.values(actionFrequency).reduce((s, v) => s + v, 0);
  for (const [type, count] of Object.entries(actionFrequency).sort((a, b) => b[1] - a[1])) {
    const pct = (count / totalActions * 100).toFixed(1);
    console.log(`  ${type.padEnd(24)} ${count.toString().padStart(7)}   (${pct}%)`);
  }

  console.log('');
  console.log('PATHOGEN ACTIVITY (spawns → clears across all runs)');
  const allTypes = new Set([...Object.keys(pathogenSpawns), ...Object.keys(pathogenClears)]);
  for (const type of [...allTypes].sort()) {
    const s = pathogenSpawns[type] ?? 0;
    const c = pathogenClears[type] ?? 0;
    const clearRate = s > 0 ? (c / s * 100).toFixed(0) + '%' : 'n/a';
    console.log(`  ${type.padEnd(28)} spawned ${s.toString().padStart(4)}   cleared ${c.toString().padStart(4)}   (${clearRate})`);
  }

  if (neverClearedPathogens.length > 0) {
    console.log('');
    console.log('POTENTIAL DEAD CONTENT (spawned but never cleared)');
    for (const t of neverClearedPathogens) {
      console.log(`  ! ${t}`);
    }
  }

  console.log('');
  console.log('SYSTEMIC EVENTS');
  console.log(`  Runs with integrity damage : ${systemicEvents.runsWithIntegrityHit} / ${config.runs}`);
  console.log(`  Runs with stress ≥ 80      : ${systemicEvents.runsWithStressSpike} / ${config.runs}`);

  if (Object.keys(upgradeCounts).length > 0) {
    console.log('');
    console.log('TOP UPGRADES CHOSEN (across all runs)');
    const topMods = Object.entries(upgradeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [key, count] of topMods) {
      console.log(`  ${key.padEnd(42)} ${count.toString().padStart(5)}`);
    }
  }

  if (Object.keys(scarChoiceCounts).length > 0) {
    console.log('');
    console.log('TOP SCAR CHOICES (across all runs)');
    const topScarChoices = Object.entries(scarChoiceCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [key, count] of topScarChoices) {
      console.log(`  ${key.padEnd(42)} ${count.toString().padStart(5)}`);
    }
  }

  if (Object.keys(scarCounts).length > 0) {
    console.log('');
    console.log('SCARS EARNED (across all runs)');
    const topScars = Object.entries(scarCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [key, count] of topScars) {
      console.log(`  ${key.padEnd(42)} ${count.toString().padStart(5)}`);
    }
  }

  console.log('');
  console.log(hr);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  const strategyFactory = getStrategy(args.strategy);
  const results = [];

  if (!args.quiet) {
    console.log(`Running ${args.runs} games with strategy="${args.strategy}" seed=${args.seed}...`);
  }

  for (let i = 0; i < args.runs; i++) {
    const rng = makeRng(childSeed(args.seed, i));
    const strategy = strategyFactory();   // fresh strategy instance per run

    const result = runGame({
      strategy,
      rng,
      maxTurns: args.maxTurns,
      omniscient: args.omniscient,
    });

    results.push(result);

    if (!args.quiet) {
      const status = result.outcome === 'loss'
        ? `LOSS  turn ${result.turns}`
        : result.outcome === 'win'
        ? `WIN   turn ${result.turns}`
        : `SURV  turn ${result.turns}`;
      const stress = result.finalState?.systemicStress ?? 0;
      const integrity = result.finalState?.systemicIntegrity ?? 0;
      console.log(`  run ${(i + 1).toString().padStart(3)}  ${status}  stress=${Math.round(stress)}  integrity=${Math.round(integrity)}`);
    }
  }

  const report = buildReport(results, args);
  printReport(report);

  if (args.output) {
    const payload = {
      report,
      runs: results.map(r => ({
        outcome: r.outcome,
        turns: r.turns,
        actionFrequency: r.actionFrequency,
        namedEvents: r.namedEvents,
        turnLog: r.turnLog,
        // Exclude finalState from JSON output (too large) — add back if needed
      })),
    };
    writeFileSync(args.output, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Full log written to ${args.output}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
