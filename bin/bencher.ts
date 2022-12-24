#!/usr/bin/env node

import { realpath } from 'fs/promises';

export type RunnerOptions = Readonly<{
  duration: number; // seconds
  sweepWidth: number;
  samples: number;
  warmUpIterations: number;
}>;

export interface RunnerModule {
  readonly name: string;
  readonly options: RunnerOptions;

  default(): number;
}

async function main() {
  const modules: Array<RunnerModule> = await Promise.all(
    process.argv.slice(2).map(async (file) => {
      const path = await realpath(file);

      const m = await import(path);

      const {
        duration = 5,
        sweepWidth = 10,
        samples = 100,
        warmUpIterations = 100,
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
        name: m.name ?? file,
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

  for (const m of modules) {
    run(m);
  }
}

type Sample = Readonly<{
  duration: number;
  iterations: number;
}>;

function run(m: RunnerModule): void {
  const baseIterations = warmUp(m);

  const samples = new Array<Sample>();

  for (let i = 0; i < m.options.samples; i++) {
    const iterations = baseIterations * (1 + (i % m.options.sweepWidth));
    const duration = measure(m, iterations);
    samples.push({ duration, iterations });
  }

  const { beta, c95, outliers } = regress(m, samples);

  const ops = 1 / beta;
  const lowOps = 1 / (beta + c95);
  const highOps = 1 / (beta - c95);
  const maxError = Math.max(highOps - ops, ops - lowOps);

  const usedSamples = samples.length - outliers;

  console.log(
    `${m.name}: ${ops.toFixed(1)} ops/s ` +
      `(±${maxError.toFixed(1)}, p=0.05, n=${usedSamples})`,
  );
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
    iterations *= 1.25;
    duration = measure(m, Math.round(iterations));
  } while (duration < maxSampleDuration);
  iterations = Math.round(iterations / 1.25);

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
  c95: number;
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

  // t-distribution value for large sample count and p=0.05
  const T_VALUE = 1.9719;

  return {
    alpha,
    beta,
    c95: T_VALUE * stdError,
    outliers: samples.length - withoutOutliers.length,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
