#!/usr/bin/env node

import { realpath } from 'fs/promises';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// ANSI colors
const BOLD = 1;
const ITALIC = 3;

// Go back to previous line, clear the line
const PREV_LINE = '\x1b[F\x1b[K';

// t-distribution value for large sample count and p=0.001
// https://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm
const STUDENT_T = 3.09;
const P_VALUE = 0.001;

export type RunnerOptions = Readonly<{
  duration: number; // seconds
  samples: number;
  sweepWidth: number;
  warmUpIterations: number;
}>;

export interface RunnerModule {
  readonly name: string;
  readonly options: RunnerOptions;

  default(): number;
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .alias('h', 'help')
    .option('d', {
      alias: 'duration',
      type: 'number',
      default: 5,
      describe: 'maximum duration in seconds per runner',
    })
    .option('s', {
      alias: 'samples',
      type: 'number',
      default: 100,
      describe: 'number of samples to collect per runner',
    })
    .option('w', {
      alias: 'sweep-width',
      type: 'number',
      default: 10,
      describe: 'width of iteration sweep',
    })
    .option('warm-up-iterations', {
      type: 'number',
      default: 100,
      describe: 'number of warm up iterations',
    }).argv;

  const modules: Array<RunnerModule> = await Promise.all(
    argv._.map(async (file) => {
      const path = await realpath(String(file));

      const m = await import(path);

      const {
        duration = argv['duration'],
        sweepWidth = argv['sweepWidth'],
        samples = argv['samples'],
        warmUpIterations = argv['warmUpIterations'],
      } = m.options ?? {};

      if (duration <= 0) {
        throw new Error(`${file}: options.duration must be positive`);
      }
      if (sweepWidth <= 1) {
        throw new Error(`${file}: options.sweepWidth must be greater than 0`);
      }
      if (samples <= 0) {
        throw new Error(`${file}: options.samples must be positive`);
      }
      if (samples / sweepWidth < 2) {
        throw new Error(
          `${file}: options.samples must be greater than 2 * sweepWidth`,
        );
      }
      if (warmUpIterations <= 0) {
        throw new Error(`${file}: options.warmUpIterations must be positive`);
      }

      return {
        name: m.name ?? String(file),
        options: {
          duration,
          sweepWidth,
          samples,
          warmUpIterations,
        },
        default: m.default,
      };
    }),
  );

  const maxNameLength = modules.reduce(
    (len, { name }) => Math.max(len, name.length),
    0,
  );

  for (const m of modules) {
    const paddedName = m.name + ' '.repeat(maxNameLength - m.name.length);
    process.stdout.write(`${style(paddedName, BOLD)}: running...\n`);

    const { ops, maxError, usedSamples } = run(m);

    process.stdout.write(PREV_LINE);
    process.stdout.write(
      `${style(paddedName, BOLD)}: ${ops.toFixed(1)} ops/s ` +
        style(
          `(±${maxError.toFixed(1)}, p=${P_VALUE}, n=${usedSamples})`,
          ITALIC,
        ) +
        '\n',
    );
  }
}

type Sample = Readonly<{
  duration: number;
  iterations: number;
}>;

type RunResult = Readonly<{
  ops: number;
  maxError: number;
  usedSamples: number;
}>;

function run(m: RunnerModule): RunResult {
  const baseIterations = warmUp(m);

  const samples = new Array<Sample>();

  for (let i = 0; i < m.options.samples; i++) {
    const iterations = baseIterations * (1 + (i % m.options.sweepWidth));
    const duration = measure(m, iterations);
    samples.push({ duration, iterations });
  }

  const { beta, confidence, outliers } = regress(m, samples);

  const ops = 1 / beta;
  const lowOps = 1 / (beta + confidence);
  const highOps = 1 / (beta - confidence);
  const maxError = Math.max(highOps - ops, ops - lowOps);

  const usedSamples = samples.length - outliers;

  return {
    ops,
    maxError,
    usedSamples,
  };
}

function warmUp(m: RunnerModule): number {
  // Initial warm-up
  for (let i = 0; i < m.options.warmUpIterations; i++) {
    m.default();
  }

  // Compute max duration per base sample
  let sampleMultiplier = 0;
  for (let i = 0; i < m.options.samples; i++) {
    sampleMultiplier += 1 + (i % m.options.sweepWidth);
  }
  const maxSampleDuration = m.options.duration / sampleMultiplier;

  // Compute iteration count per base sample
  let iterations = 1;
  let duration = 0;
  do {
    iterations *= 2;
    duration = measure(m, Math.round(iterations));
  } while (duration < maxSampleDuration);

  iterations = Math.max(
    iterations / 2,
    (maxSampleDuration / duration) * iterations,
  );

  return iterations;
}

function measure(m: RunnerModule, iterations: number): number {
  let sum = 0;
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    sum += m.default();
  }
  const duration = Number(process.hrtime.bigint() - start) / 1e9;

  if (isNaN(sum)) {
    throw new Error(`${m.name}: runner function did not return number`);
  }

  return duration;
}

type Regression = Readonly<{
  alpha: number;
  beta: number;
  confidence: number;
  outliers: number;
}>;

function regress(m: RunnerModule, samples: ReadonlyArray<Sample>): Regression {
  // Bin the data by iteration count
  const bins = new Map<number, Array<number>>();
  for (const { iterations, duration } of samples) {
    let bin = bins.get(iterations);
    if (bin === undefined) {
      bin = [];
      bins.set(iterations, bin);
    }
    bin.push(duration);
  }

  // Within each iteration bin get rid of the outliers.
  const withoutOutliers = new Array<Sample>();
  for (const [iterations, durations] of bins) {
    durations.sort();

    const p25 = durations[Math.floor(durations.length * 0.25)] ?? -Infinity;
    const p75 = durations[Math.ceil(durations.length * 0.75)] ?? +Infinity;
    const iqr = p75 - p25;
    const outlierLow = p25 - iqr * 1.5;
    const outlierHigh = p75 + iqr * 1.5;

    // Tukey's method
    const filtered = durations.filter(
      (d) => d >= outlierLow && d <= outlierHigh,
    );

    for (const duration of filtered) {
      withoutOutliers.push({ iterations, duration });
    }
  }

  if (withoutOutliers.length < 2) {
    throw new Error(`${m.name}: low sample count`);
  }

  let meanDuration = 0;
  let meanIterations = 0;
  for (const { duration, iterations } of withoutOutliers) {
    meanDuration += duration;
    meanIterations += iterations;
  }
  meanDuration /= withoutOutliers.length;
  meanIterations /= withoutOutliers.length;

  let betaNum = 0;
  let betaDenom = 0;
  for (const { duration, iterations } of withoutOutliers) {
    betaNum += (duration - meanDuration) * (iterations - meanIterations);
    betaDenom += (iterations - meanIterations) ** 2;
  }

  // Slope
  const beta = betaNum / betaDenom;

  // Intercept
  const alpha = meanDuration - beta * meanIterations;

  let stdError = 0;
  for (const { duration, iterations } of withoutOutliers) {
    stdError += (duration - alpha - beta * iterations) ** 2;
  }
  stdError /= withoutOutliers.length - 2;
  stdError /= betaDenom;
  stdError = Math.sqrt(stdError);

  return {
    alpha,
    beta,
    confidence: STUDENT_T * stdError,
    outliers: samples.length - withoutOutliers.length,
  };
}

function style(text: string, code: number): string {
  return `\x1b[${code}m${text}\x1b[m`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
