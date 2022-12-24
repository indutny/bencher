# @indutny/bencher

[![npm](https://img.shields.io/npm/v/@indutny/bencher)](https://www.npmjs.com/package/@indutny/bencher)
![CI Status](https://github.com/indutny/bencher/actions/workflows/test.yml/badge.svg)

Sneaky equals comparison between objects that checks only the properties that
were touched.

Inspired by [proxy-compare](https://github.com/dai-shi/proxy-compare).

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

## Credits

Name coined by [Scott Nonnenberg](https://github.com/scottnonnenberg/).

## LICENSE

This software is licensed under the MIT License.
