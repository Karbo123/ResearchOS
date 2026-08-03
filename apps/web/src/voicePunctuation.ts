const ZH_QUESTION_END = new Set(['吗', '呢', '么', '嘛'])
const ZH_CONNECTORS = ['然后', '但是', '所以', '因为', '如果', '虽然', '不过', '而且', '接着', '另外', '总之', '比如']
const EN_QUESTION_WORDS = new Set([
  'am', 'are', 'can', 'could', 'did', 'do', 'does', 'how', 'is', 'may', 'might', 'should', 'was', 'were',
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'will', 'would',
])
const ES_QUESTION_WORDS = new Set(['cómo', 'cuál', 'cuáles', 'cuándo', 'dónde', 'por qué', 'qué', 'quién', 'quiénes'])
const END_PUNCTUATION = new Set(['。', '！', '？', '.', '!', '?', '…'])

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
  return addEndPunctuation(addConnectorPunctuation(value), locale)
}
