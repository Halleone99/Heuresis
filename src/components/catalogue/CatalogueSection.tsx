import { TriangleAlert } from "lucide-react";
import { registerCatalogueFonts } from "../../lib/catalogue/fonts";
import { ArticleDesigner } from "./ArticleDesigner";
import { ArticleReader } from "./ArticleReader";
import { CatalogueLibrary } from "./CatalogueLibrary";
import { catalogueShelf, CatalogueProvider, useCatalogue } from "./CatalogueData";
import { VolumeView } from "./VolumeView";
import "./article.css";
import "./catalogue.css";

registerCatalogueFonts();

function CatalogueRoutes() {
  const catalogue = useCatalogue();
  if (catalogue.loading && !catalogue.schema) return <div className="ws-loading" role="status"><span className="ws-spinner" /> Opening the Catalogue…</div>;
  if (catalogue.error && !catalogue.schema) return <div className="ws-error-panel" role="alert">
    <strong>The Catalogue could not be loaded.</strong><span>{catalogue.error}</span>
    <button type="button" className="ws-button" onClick={() => void catalogue.reload()}>Try again</button>
  </div>;
  if (catalogue.schema === "missing") return <div className="ct-library is-empty"><div className="ct-empty">
    <h1>Catalogue</h1>
    <p className="ct-schema"><TriangleAlert size={16} /> The Catalogue’s database tables do not exist yet. Apply <code>supabase/migrations/20261030090000_catalogue_publications.sql</code> to your Supabase project, then try again. Nothing else in Heuresis is affected.</p>
    <button type="button" className="ws-button" onClick={() => void catalogue.reload()}>Check again</button>
  </div></div>;
  const route = catalogue.route;
  const shelf = catalogueShelf(route);
  return <>
    {shelf.view === "volume" ? <VolumeView key={shelf.id} volumeId={shelf.id} />
      : <CatalogueLibrary key={shelf.view === "collection" ? shelf.id : shelf.view} route={shelf} />}
    {route.view === "design" ? <ArticleDesigner key={route.id} articleId={route.id} /> : null}
    {route.view === "read" ? <ArticleReader key={route.id} articleId={route.id} from={route.from} /> : null}
  </>;
}

/** The Catalogue section: independent publications, separate from the Notebook. */
export default function CatalogueSection({ userId }: { userId: string }) {
  return <CatalogueProvider userId={userId}><div className="ct-root"><CatalogueRoutes /></div></CatalogueProvider>;
}
