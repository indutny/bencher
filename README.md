# @indutny/bencher

[![npm](https://img.shields.io/npm/v/@indutny/bencher)](https://www.npmjs.com/package/@indutny/bencher)
![CI Status](https://github.com/indutny/bencher/actions/workflows/test.yml/badge.svg)

Simple JavaScript benchmarking tool inspired by my bad understanding of how
[Criterion.rs](https://github.com/bheisler/criterion.rs/blob/27642b476837753cbb539f269fbbcbefa815bf00/book/src/analysis.md)
works.

## Disclaimer

Let's be honest, I'm terrible at statistics. This approach that I took here is
probably incorrect, but the results appear to be stable enough so I'm happy to
use it for my personal projects.

Any ideas on improving the algorithm are very welcome!

## Installation

```sh
npm install -g @indutny/bencher
```

## Usage

```js
// Function to benchmark
export function benchmarkName() => {
  let sum = 0;
  for (let i = 0; i < 1e6; i++) {
    sum += i;
  }

  // Make sure to return a side-effect value (possibly a result of the
  // run) to ensure that the pure function calls are not optimized out by the
  // JIT compiler.
  return sum;
};
```

```sh
$ bencher benchmark.js
benchmark.js/benchmarkName: 1’037.8 ops/sec (±18.8, p=0.001, n=98)
```

## LICENSE

This software is licensed under the MIT License.
