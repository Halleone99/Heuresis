import {
  articleTitle, blankArticle, newBlock, roman,
  type CatalogueArticle, type CatalogueVolume, type ColourPreset, type CoverBlock, type TypographyPreset,
} from "../../lib/catalogue/model";
import { pageStyle } from "../../lib/catalogue/presets";

/**
 * The opening pages of a volume PDF: a title page and a table of contents.
 * Both are ordinary A4 `.ap-page` elements, so they are laid out, measured and
 * painted into the PDF exactly like article pages. Nothing here is stored.
 */
export type VolumeLook = { typography_preset: TypographyPreset; colour_preset: ColourPreset };
export type ContentsEntry = { article: CatalogueArticle; number: number; start: number };

/** The title page, expressed as a one-page article whose only block is a cover. */
export function volumeTitleArticle(volume: CatalogueVolume, look: VolumeLook, userId: string, dateLabel: string): CatalogueArticle {
  const cover: CoverBlock = { ...(newBlock("cover") as CoverBlock), style: volume.cover ? "framed" : "plain", image: volume.cover, kicker: "" };
  return {
    ...blankArticle(userId, { title: volume.title, typography_preset: look.typography_preset, colour_preset: look.colour_preset }),
    subtitle: volume.subtitle,
    author: [volume.edition, dateLabel].filter(Boolean).join(" · "),
    page_numbers: false, running_header: false,
    pages: [{ id: `volume-title-${volume.id}`, blocks: [cover] }],
  };
}

export function VolumeContentsPage({ volume, entries, look, first }: {
  volume: CatalogueVolume; entries: ContentsEntry[]; look: VolumeLook; first: boolean;
}) {
  return <div className={`ap-page ap-type-${look.typography_preset} ap-colour-${look.colour_preset} is-reading ap-volume-contents`} style={pageStyle(look.typography_preset)}>
    <div className="ap-content">
      {first ? <header className="ap-contents-head">
        <div className="ap-kicker">{[volume.title, volume.edition].filter(Boolean).join(" · ")}</div>
        <h1 className="ap-section-title">Contents</h1>
      </header> : null}
      <ol className="ap-contents">
        {entries.map(({ article, number, start }) => <li key={article.id}>
          <span className="ap-contents-number">{roman(number)}</span>
          <span className="ap-contents-title">
            <span className="ap-contents-name">{articleTitle(article)}</span>
            {article.subtitle.trim() ? <span className="ap-contents-sub">{article.subtitle}</span> : null}
          </span>
          <span className="ap-contents-page">{start}</span>
        </li>)}
      </ol>
    </div>
  </div>;
}
