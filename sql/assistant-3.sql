-- ASSISTANT — assistant-3.sql — lot 3 (ASSISTANT GÉNÉRAL : répertoire des correspondants), 23/10/2026.
-- À exécuter UNE FOIS dans l'éditeur SQL de Neon (projet gentle-firefly-91584148), AVANT d'envoyer
-- la nouvelle version de api/assistant.js. Peut être rejoué sans dommage.
-- La liste de départ des correspondants vient du Drive (fichier « repertoire-….json » déposé par Claude) ;
-- cette table ne garde que ce que JFD y change : correspondant ajouté, masqué, ou formule d'appel corrigée.
-- Aucune adresse n'est écrite dans le dépôt GitHub (public).
CREATE TABLE IF NOT EXISTS assistant_contact (
  adresse   text PRIMARY KEY,           -- en minuscules
  nom       text,
  qualite   text CHECK (qualite IS NULL OR qualite IN ('confrere', 'client', 'prenom_vous', 'prenom_tu', 'collegue', 'aucune')),
  civilite  text CHECK (civilite IS NULL OR civilite IN ('Madame', 'Monsieur')),
  prenom    text,
  ajoute    boolean NOT NULL DEFAULT false,   -- ajouté à la main dans l'ASSISTANT
  masque    boolean NOT NULL DEFAULT false,   -- retiré du répertoire par JFD
  maj_le    timestamptz NOT NULL DEFAULT now()
);
