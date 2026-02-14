export const name = 'runner';

export function help(): number {
  let sum = 0;
  for (let i = 0; i < 1e6; i++) {
    sum += i;
  }
  return sum;
}
