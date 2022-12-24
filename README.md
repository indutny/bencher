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

benchmark.js

```js
export const name = 'benchmark name';

// Function to benchmark
export default () => {
  // Make sure to return a side-effect number
  // (possibly result of a computation) to ensure that the pure function calls
  // are not optimized out by the runtime.
  return 0;
};
```

```sh
bencher benchmark.js
```

## LICENSE

This software is licensed under the MIT License.
