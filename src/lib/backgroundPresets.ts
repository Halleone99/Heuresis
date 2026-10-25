/** Curated atmospheres render locally, then use Heuresis' existing per-page image upload. */
export const BACKGROUND_PRESETS = [
  { id: "mist", label: "Mist", description: "Quiet cool grey and sage", colours: ["#dbe4e3","#9ab7b4","#577b82"], glow: "#e4f4e9" },
  { id: "dusk", label: "Dusk", description: "Indigo and distant rose", colours: ["#1d2943","#545078","#ae7b95"], glow: "#d2a9bf" },
  { id: "forest", label: "Forest", description: "Deep green and muted gold", colours: ["#173b3e","#4c766a","#afaa7c"], glow: "#c1d2a1" },
  { id: "ember", label: "Ember", description: "Warm stone, amber and sand", colours: ["#453b3a","#ac7865","#dfba9c"], glow: "#ffe3c1" },
  { id: "polar", label: "Polar", description: "Marine blue and soft northern light", colours: ["#15283c","#3d6e86","#93c1bf"], glow: "#a1dad6" },
  { id: "rose", label: "Rose", description: "Dusty mauve and pale blush", colours: ["#594a67","#a58ca1","#e2c2bd"], glow: "#f7dfe3" },
] as const;
export type BackgroundPreset = typeof BACKGROUND_PRESETS[number];
export function presetSwatch(preset: BackgroundPreset): string {
  return `linear-gradient(135deg, ${preset.colours.join(", ")})`;
}
export async function createBackgroundPresetImage(preset: BackgroundPreset): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 1600; canvas.height = 900;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This device cannot render a wallpaper.");
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  preset.colours.forEach((colour, index) => gradient.addColorStop(index / (preset.colours.length - 1), colour));
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const r = parseInt(preset.glow.slice(1,3), 16);
  const g = parseInt(preset.glow.slice(3,5), 16);
  const b = parseInt(preset.glow.slice(5,7), 16);
  for (const light of [{ x:.24,y:.20,radius:.68,alpha:.37 }, { x:.79,y:.78,radius:.47,alpha:.23 }]) {
    const x = canvas.width * light.x, y = canvas.height * light.y;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, canvas.width * light.radius);
    glow.addColorStop(0, `rgba(${r},${g},${b},${light.alpha})`);
    glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = glow; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not create wallpaper.")), "image/png"));
  return new File([blob], `heuresis-${preset.id}.png`, { type: "image/png" });
}
