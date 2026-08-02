import assert from 'node:assert/strict'
import { DEFAULT_LOCALE, LOCALE_OPTIONS, dictionaries } from '../apps/web/src/i18n.js'
import { THEME_OPTIONS } from '../apps/web/src/theme.js'

const referenceKeys = Object.keys(dictionaries[DEFAULT_LOCALE]).sort()
assert.equal(LOCALE_OPTIONS.length, 4, 'must provide four interface languages')
assert.equal(LOCALE_OPTIONS[0]?.value, 'zh-CN', 'default language must be zh-CN')
assert.deepEqual(Object.keys(dictionaries['zh-TW']).sort(), referenceKeys, 'zh-TW dictionary must match zh-CN keys')
assert.deepEqual(Object.keys(dictionaries.en).sort(), referenceKeys, 'en dictionary must match zh-CN keys')
assert.deepEqual(Object.keys(dictionaries.es).sort(), referenceKeys, 'es dictionary must match zh-CN keys')

for (const locale of ['zh-CN', 'zh-TW', 'en', 'es'] as const) {
  for (const [key, value] of Object.entries(dictionaries[locale])) {
    assert.ok(String(value).trim().length > 0, `${locale} has empty translation for ${key}`)
  }
}

assert.deepEqual(THEME_OPTIONS, ['light', 'dark'], 'must provide light and dark themes')
console.log('UI i18n and theme check passed')
