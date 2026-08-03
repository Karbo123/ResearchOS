const JSON_OUTPUT_INSTRUCTION = 'Return a JSON object that conforms to the requested JSON Schema.'

export function structuredJsonInput(input: string): string {
  return `${JSON_OUTPUT_INSTRUCTION}\n\n${input}`
}

export function structuredJsonValue(value: unknown): string {
  return structuredJsonInput(JSON.stringify(value) ?? '')
}
