-- ASSISTANT — assistant-2.sql — lot 2 (revue du matin, mode vocal, notes dictées, rappels), 23/10/2026.
-- À exécuter UNE FOIS dans l'éditeur SQL de Neon (projet gentle-firefly-91584148), AVANT d'envoyer
-- la nouvelle version de api/assistant.js. Peut être rejoué sans dommage.

-- 1. Les notes dictées (« note pour MONETA … ») : chacune devient un point du tableau de bord, identifiant N-<id>
CREATE TABLE IF NOT EXISTS assistant_note (
  id       bigserial PRIMARY KEY,
  appli    text NOT NULL,
  texte    text NOT NULL,
  cree_le  timestamptz NOT NULL DEFAULT now()
);

-- 2. Les rappels demandés en mode vocal pour les points à voir sur PC (« rappel à 15 heures »)
CREATE TABLE IF NOT EXISTS assistant_rappel (
  id        bigserial PRIMARY KEY,
  prevu_le  timestamptz NOT NULL,
  ids       text[] NOT NULL DEFAULT '{}',   -- les points concernés, à la date du rappel
  vu_le     timestamptz,                    -- rempli quand JFD a pris connaissance du rappel
  cree_le   timestamptz NOT NULL DEFAULT now()
);
