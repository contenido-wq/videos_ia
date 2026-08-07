import "./index.css";
import { MyComposition } from "./Composition";
import { DocumentalComposition } from "./DocumentalComposition";
import { SocialChecklistComposition } from "./SocialChecklistComposition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <DocumentalComposition id="Documental" slug="validar-idea-48h" />
      <DocumentalComposition id="ClaudeEnTuNegocio" slug="claude-en-tu-negocio" />
      <DocumentalComposition id="HistoriasNoVendenIG" slug="historias-no-venden-ig" />
      <DocumentalComposition id="Mundial2026Resumen" slug="mundial-2026-resumen" />
      <DocumentalComposition id="MitosClaudeNegocio" slug="mitos-claude-negocio" />
      <SocialChecklistComposition id="CincoHerramientasIA" slug="5-herramientas-ia" />
      <SocialChecklistComposition id="CincoHerramientasRanking" slug="5-herramientas-ranking" />
    </>
  );
};
