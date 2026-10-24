// @ts-check
// Extends the monorepo config with Next's ESLint plugin so `next build`'s lint step knows the
// `@next/next/*` rules (and the disable comments that reference them).
import nextPlugin from '@next/eslint-plugin-next';
import rootConfig from '../../eslint.config.mjs';

export default [
  ...rootConfig,
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
];
