-- ASSISTANT — assistant.sql — lot 1 (ASSISTANT OUTIL), 23/10/2026.
-- À exécuter UNE FOIS dans l'éditeur SQL de Neon (projet gentle-firefly-91584148),
-- AVANT le premier essai de la page. Peut être rejoué sans dommage.
-- Les points eux-mêmes ne sont PAS en base : Claude les inscrit dans le dossier Drive
-- « ASSISTANT – journal ». La base ne garde que ce que JFD en fait (tranché, reporté, sur PC, rétrogradé).

-- 1. L'état de chaque point (une ligne par point touché au moins une fois)
CREATE TABLE IF NOT EXISTS assistant_etat (
  point_id       text PRIMARY KEY,
  statut         text NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'tranche', 'reporte', 'pc')),
  reporte_jusqu  timestamptz,                      -- un point reporté revient seul à cette date
  retrograde     boolean NOT NULL DEFAULT false,   -- faux rouge rétrogradé par JFD : plafonné à l'orange
  maj_le         timestamptz NOT NULL DEFAULT now()
);

-- 2. La trace de chaque geste (sert au bilan du vendredi, plus tard) ; rien n'est jamais supprimé
CREATE TABLE IF NOT EXISTS assistant_action (
  id        bigserial PRIMARY KEY,
  point_id  text NOT NULL,
  action    text NOT NULL,          -- statut | retrograde
  valeur    text,
  fait_le   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_action_date ON assistant_action (fait_le DESC);
