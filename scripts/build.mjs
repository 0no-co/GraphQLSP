import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

const isDev = process.env.NODE_ENV === 'development';

/** @type {import('rollup').RollupOptions} */
export default {
  input: './src/index.ts',
  output: [
    { file: './dist/index.module.js', format: 'esm' },
    { file: './dist/index.js', format: 'cjs' },
  ],
  plugins: [
    typescript(),
    !isDev &&
      terser({
        warnings: true,
        ecma: 2015,
        ie8: false,
        toplevel: true,
        compress: {
          keep_infinity: true,
          pure_getters: true,
          passes: 10,
        },
        mangle: {
          module: true,
        },
        output: {
          comments: false,
        },
      }),
  ],
};
