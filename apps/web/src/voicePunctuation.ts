const ZH_QUESTION_END = new Set(['吗', '呢', '么', '嘛'])
const ZH_CONNECTORS = ['然后', '但是', '所以', '因为', '如果', '虽然', '不过', '而且', '接着', '另外', '总之', '比如']
const EN_QUESTION_WORDS = new Set([
  'am', 'are', 'can', 'could', 'did', 'do', 'does', 'how', 'is', 'may', 'might', 'should', 'was', 'were',
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'will', 'would',
])
const ES_QUESTION_WORDS = new Set(['cómo', 'cuál', 'cuáles', 'cuándo', 'dónde', 'por qué', 'qué', 'quién', 'quiénes'])
const END_PUNCTUATION = new Set(['。', '！', '？', '.', '!', '?', '…'])

function isAsciiLetter(char: string | undefined): boolean {
  return Boolean(char && /[a-zA-Z]/.test(char))
}

function isAsciiWord(char: string | undefined): boolean {
  return Boolean(char && /[a-zA-Z0-9]/.test(char))
}

function isAsciiDigit(char: string | undefined): boolean {
  return Boolean(char && /[0-9]/.test(char))
}

function hasChineseCharacters(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

export function localizeTranscriptPunctuation(text: string, locale: string): string {
  if (locale !== 'zh-CN' && locale !== 'zh-TW') return text
  if (!hasChineseCharacters(text)) return text

  let doubleQuoteOpen = false
  let singleQuoteOpen = false
  const value = text.replace(/\.{3,}/g, '……')
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    const prev = value[index - 1]
    const next = value[index + 1]
    switch (char) {
      case ',':
        result += isAsciiDigit(prev) && isAsciiDigit(next) ? char : '，'
        break
      case '.':
        result += isAsciiWord(prev) && isAsciiWord(next) ? char : '。'
        break
      case '?':
        result += '？'
        break
      case '!':
        result += '！'
        break
      case ';':
        result += '；'
        break
      case ':':
        result += '：'
        break
      case '(':
        result += '（'
        break
      case ')':
        result += '）'
        break
      case '"':
        if (isAsciiWord(prev) && isAsciiWord(next)) {
          result += char
        } else {
          result += doubleQuoteOpen ? '\u201D' : '\u201C'
          doubleQuoteOpen = !doubleQuoteOpen
        }
        break
      case "'":
        if (isAsciiLetter(prev) && isAsciiLetter(next)) {
          result += char
        } else {
          result += singleQuoteOpen ? '\u2019' : '\u2018'
          singleQuoteOpen = !singleQuoteOpen
        }
        break
      default:
        result += char
        break
    }
  }
  return result
}

function addConnectorPunctuation(value: string): string {
  let next = value
  for (const connector of ZH_CONNECTORS) {
    next = next.replace(new RegExp(`(?<=^|[，。！？；、,.!?;:])${connector}(?=\\S)`, 'g'), `${connector}，`)
  }
  return next
}

function addEndPunctuation(value: string, locale: string): string {
  const last = value[value.length - 1]
  if (END_PUNCTUATION.has(last)) return value
  if (locale === 'zh-CN' || locale === 'zh-TW') {
    return ZH_QUESTION_END.has(last) ? `${value}？` : `${value}。`
  }
  const words = value.trim().split(/\s+/)
  const lastWord = words[words.length - 1]?.toLowerCase().replace(/[^a-záéíóúüñ]/gi, '') ?? ''
  if (locale === 'es' && ES_QUESTION_WORDS.has(words.slice(-2).join(' ').toLowerCase())) return `${value}?`
  if (EN_QUESTION_WORDS.has(lastWord)) return `${value}?`
  return `${value}.`
}

export function punctuateTranscript(text: string, locale: string): string {
  const value = text.trim().replace(/\s+/g, ' ')
  if (!value) return ''
  return localizeTranscriptPunctuation(addEndPunctuation(addConnectorPunctuation(value), locale), locale)
}
