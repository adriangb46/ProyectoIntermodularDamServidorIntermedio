/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  // Sin transform: usamos ESM nativo con --experimental-vm-modules
  transform: {},
  testMatch: ['**/src/**/*.test.js'],
  verbose: true,
};
