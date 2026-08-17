// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// ── The Alert ban (operator ruling 2026-08-15) ──────────────────────────────
//
// react-native-web 0.21.2 implements Alert as `class Alert { static alert() {} }`
// — a literal no-op. CaptainPad ships a web build (`npm run web:build`) to the
// podium, so every `Alert.alert(...)` there is INVISIBLE: the engine refuses a
// request, the panel rolls back, and the operator sees the UI snap back with no
// explanation. It looks correct in review and in the iOS simulator, which is
// how 81 call sites accumulated before anyone noticed.
//
// The fix surface is `utils/op_dialog.ts`. This rule stops the import at the
// door; `components/no_raw_alerts.test.ts` covers what a lint rule cannot see —
// `window.alert/confirm/prompt`, a bare `alert('x')`, and an `Alert` reached
// through a namespace or re-export.
const ALERT_BAN = {
  name: 'react-native',
  importNames: ['Alert'],
  message:
    "react-native's Alert is a NO-OP on the web build (react-native-web ships an "
    + 'empty stub), so it is invisible on the podium. Use utils/op_dialog.ts: '
    + 'opError / opWarn / opInfo for a toast, opConfirm / opDialog for a question.',
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      'no-restricted-imports': ['error', { paths: [ALERT_BAN] }],
    },
  },
  {
    // The ban's own documentation and its guard test necessarily NAME the thing
    // they ban. Neither imports it.
    files: ['utils/op_dialog.ts', 'components/no_raw_alerts.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
]);
