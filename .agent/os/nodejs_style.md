# Node.js Style Guide

The essential style rules for all JavaScript/Node.js code in this project.

## 1. Imports

- **All `require()` / `import` statements at the top of the file.** Never inside functions or callbacks.
- **Never wrap imports in try/catch.** A missing dependency must crash at startup.
- **Order:** Node built-ins → third-party packages → local modules, separated by blank lines.

```javascript
// ✅ GOOD
const fs = require('fs');
const path = require('path');

const yaml = require('js-yaml');
const dmxlib = require('dmxnet');

const fixtures = require('./fixtures');

// ❌ BAD — require inside function
function loadConfig() {
    const yaml = require('js-yaml');  // NO
}

// ❌ BAD — swallowing missing deps
try {
    const dmxlib = require('dmxnet');
} catch (e) {
    dmxlib = null;  // NO — hides broken dependencies
}
```

## 2. Naming

| What | Convention | Example |
|------|-----------|---------|
| Files, directories | `snake_case` | `marsin_play.js` |
| Variables, functions | `camelCase` | `loadFixture()` |
| Classes | `PascalCase` | `DmxController` |
| Constants | `UPPER_SNAKE` | `DMX_UNIVERSE_SIZE` |
| Private / internal | `_leadingUnderscore` | `_parseChannel()` |

## 3. Functions

- Keep functions short — one job each.
- Use `const` for functions assigned to variables.
- Prefer arrow functions for callbacks and short helpers.
- Use named functions for top-level definitions (better stack traces).

```javascript
// ✅ GOOD — named function at top level
function startUniverse(config) { ... }

// ✅ GOOD — arrow for callbacks
channels.forEach((ch) => {
    ch.update(value);
});
```

## 4. Async / Promises

- Use `async`/`await` over raw `.then()` chains.
- Always handle errors — never leave promises unhandled.
- Use `try`/`catch` around `await` calls.

```javascript
// ✅ GOOD
async function connect() {
    try {
        const device = await dmx.open(port);
        return device;
    } catch (err) {
        console.error(`Connection failed: ${err.message}`);
        throw err;
    }
}

// ❌ BAD — unhandled promise
dmx.open(port).then(device => { ... });
```

## 5. Variables

- **`const`** by default. Only use `let` when reassignment is needed.
- **Never** use `var`.
- Declare variables close to where they're used.

## 6. Error Handling

- Catch specific errors when possible.
- Always log the error message — never silently swallow.
- Use `process.exit(1)` for fatal startup errors.

```javascript
// ✅ GOOD
try {
    const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
    console.error(`Config error: ${err.message}`);
    process.exit(1);
}

// ❌ BAD
try { ... } catch (e) { }  // silent swallow
```

## 7. String Formatting

- Use template literals for all string building.

```javascript
// ✅ GOOD
console.log(`Channel ${ch.name} set to ${value}`);

// ❌ BAD
console.log('Channel ' + ch.name + ' set to ' + value);
```

## 8. Code Organization

- One module = one responsibility.
- Export only what's needed — keep internals private.
- Configuration and constants at the top, after imports.
- Use `module.exports` at the bottom of the file.

## 9. Comments

- Explain **why**, not **what**.
- Use `// ──` section separators for visual grouping.
- JSDoc for public functions with `@param` and `@returns`.

## 10. Formatting

- 2-space indentation (Node.js convention).
- Semicolons required.
- Single quotes for strings.
- Max 100 characters per line.
- Trailing commas in multiline arrays/objects.
