// قواعد الخطّافات فقط في هذه المرحلة: خطّاف داخل شرط أو حلقة يكسر React وقت التشغيل ولا
// يكشفه أي اختبار وحدة، وقائمة اعتماديات ناقصة تُنتج مؤقتات شبح — كلاهما وقع في تاريخ
// المشروع. قواعد الأسلوب خارج النطاق حتى لا يُعاد تنسيق ٥٠ ألف سطر في تغيير واحد.
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    // scripts/bank/workflows/*.js نصوص لأداة سير العمل (return في المستوى الأعلى)، لا وحدات Node.
    ignores: ['dist/**', 'node_modules/**', '.wrangler/**', 'ios/build/**', 'ios/Maydan/www/**', 'public/**', 'src/data/**', 'scripts/bank/workflows/**'],
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
  {
    files: ['server/**/*.mjs', 'scripts/**/*.mjs', 'tests/**/*.js', 'tests/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
];
