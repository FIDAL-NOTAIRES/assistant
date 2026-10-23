-- ASSISTANT — assistant-4.sql — bilan quotidien de 6 h 30 (23/10/2026).
-- À exécuter UNE FOIS dans l'éditeur SQL de Neon (projet gentle-firefly-91584148), AVANT d'envoyer api/bilan.js.
-- Peut être rejoué sans dommage. Une ligne par jour et par service ou source relevé ; rien n'est jamais supprimé.
CREATE TABLE IF NOT EXISTS assistant_bilan (
  jour           date NOT NULL,
  nom            text NOT NULL,            -- nom du service ou de la source, tel que MORNING le donne
  type           text NOT NULL,            -- service | source
  etat           text NOT NULL,            -- ok | lent | degrade | ko | inconnu
  ms             integer,
  code           integer,
  detail         text,
  incidents_24h  integer NOT NULL DEFAULT 0,
  releve_le      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (jour, nom)
);
