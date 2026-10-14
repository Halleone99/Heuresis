/** One visual Dim slider while retaining Personal OS's opacity + veil fields. */
export function dimPercent(opacity: number, veil: number): number {
  const image = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
  const cover = Math.max(0, Math.min(1, Number.isFinite(veil) ? veil : 0));
  return Math.round((1 - image * (1 - cover)) * 100);
}

export function dimToLegacySettings(percent: number) {
  const dim = Math.max(0, Math.min(1, (Number.isFinite(percent) ? percent : 40) / 100));
  const visible = Math.sqrt(1 - dim);
  return { opacity: visible, veil: 1 - visible };
}
