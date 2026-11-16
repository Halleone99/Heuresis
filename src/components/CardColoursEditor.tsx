import { useState } from "react";
const KEY = "heuresis.cardColours.v1";
type Token = { key: string; label: string; fallback: string };
const GROUPS: { title: string; items: Token[] }[] = [
  { title:"Importance",items:[{key:"--imp-core",label:"Core",fallback:"#f0b46c"},{key:"--imp-useful",label:"Active",fallback:"#6fd3bf"},{key:"--imp-peripheral",label:"Passive",fallback:"#ab9ef2"}] },
  { title:"Actions",items:[{key:"--act-later",label:"Later",fallback:"#7c8799"},{key:"--act-discard",label:"Discard",fallback:"#ef7b7b"}] },
  { title:"Automatic colouring",items:[{key:"--gram-m",label:"Masculine",fallback:"#86b2ff"},{key:"--gram-f",label:"Feminine",fallback:"#f2907f"},{key:"--gram-n",label:"Neuter",fallback:"#86d49a"},{key:"--gram-stress",label:"Stress",fallback:"#f0b46c"},{key:"--gram-sep",label:"Separable verb",fallback:"#f1c56c"}] },
  { title:"Chinese tones",items:[{key:"--tone-1",label:"First tone",fallback:"#f2907f"},{key:"--tone-2",label:"Second tone",fallback:"#f1c56c"},{key:"--tone-3",label:"Third tone",fallback:"#86d49a"},{key:"--tone-4",label:"Fourth tone",fallback:"#86b2ff"}] },
  { title:"Highlighter",items:[1,2,3,4,5].map((n,i)=>({key:"--hl-mk"+n,label:"Colour "+n,fallback:["#f1c56c","#86d49a","#86b2ff","#f29ac1","#ab9ef2"][i]})) },
];
const ALLOWED = new Set(GROUPS.flatMap(g=>g.items.map(item=>item.key)));
export type CardColourMap = Record<string,string>;
export function readCardColours(): CardColourMap {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string,unknown>;
    return Object.fromEntries(Object.entries(value).filter(([key,v]) => ALLOWED.has(key) && typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v))) as CardColourMap;
  } catch { return {}; }
}
export function applyCardColours(value = readCardColours()) {
  const root = document.documentElement;
  for (const key of ALLOWED) root.style.removeProperty(key);
  for (const [key,color] of Object.entries(value)) if (ALLOWED.has(key)) root.style.setProperty(key,color);
}
export default function CardColoursEditor() {
  const [colours,setColours] = useState(readCardColours);
  const [notice,setNotice] = useState("");
  const choose = (key:string,color:string) => {
    if (!ALLOWED.has(key) || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
    const next = {...colours,[key]:color};
    setColours(next);
    localStorage.setItem(KEY,JSON.stringify(next));
    applyCardColours(next);
    setNotice("");
  };
  const reset = () => {
    localStorage.removeItem(KEY);setColours({});applyCardColours({});setNotice("Card colours reset.");
  };
  const css = () => ":root {\n"+Object.entries(colours).map(([key,val])=>"  "+key+": "+val+";").join("\n")+"\n}";
  const copy = () => { void navigator.clipboard.writeText(css()).then(()=>setNotice("CSS copied."),()=>setNotice("Could not copy CSS.")); };
  return <section className="card-colours-editor" aria-label="Card colours">
    <div className="card-colours-heading"><h3>Card colours</h3><div><button type="button" onClick={reset}>Reset</button>
      <button type="button" onClick={copy}>Copy as CSS</button></div></div>
    <p>Card-specific colours. Changes apply immediately across the four palettes.</p>
    {GROUPS.map(group => <fieldset key={group.title}><legend>{group.title}</legend>
      <div className="card-colours-grid">{group.items.map(item => <label key={item.key}>
        <span>{item.label}</span><input type="color" value={colours[item.key] || item.fallback}
          onChange={event => choose(item.key,event.target.value)} />
      </label>)}</div>
    </fieldset>)}
    {notice ? <p role="status">{notice}</p> : null}
  </section>;
}
