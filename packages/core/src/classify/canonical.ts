// RED stub (03-05 Task 2): replaced by the implementation in the GREEN commit.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value) ?? '';
}

export function sha256Hex(text: string): string {
  return text;
}
