import "./index.css";
import { MyComposition } from "./Composition";
import { DocumentalComposition } from "./DocumentalComposition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <DocumentalComposition id="Documental" slug="validar-idea-48h" />
      <DocumentalComposition id="ClaudeEnTuNegocio" slug="claude-en-tu-negocio" />
      <DocumentalComposition id="HistoriasNoVendenIG" slug="historias-no-venden-ig" />
      <DocumentalComposition id="Mundial2026Resumen" slug="mundial-2026-resumen" />
      <DocumentalComposition id="MitosClaudeNegocio" slug="mitos-claude-negocio" />
    </>
  );
};
