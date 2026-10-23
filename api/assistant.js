// ASSISTANT — fonction serveur unique (lot 1, ASSISTANT OUTIL, 23/10/2026).
// GET  /api/assistant                                   → { etats: [...] }
// POST /api/assistant { action: 'statut', id, statut, jusqu? }  statut = ouvert | tranche | reporte | pc
//                     { action: 'note', appli, texte }          note dictée → point N-<id>
//                     { action: 'rappel', prevu_le, ids }       rappel des points à voir sur PC
//                     { action: 'rappel_vu', id }
//                     { action: 'fusion', id: <point gardé>, autre: <point retiré> }   doublon : l'autre passe en tranché
//                     { action: 'pas_doublon', id, autre }                         les deux points ne seront plus rapprochés
//                     { action: 'contact', adresse, nom?, qualite?, civilite?, prenom?, ajoute?, masque? }  répertoire de l'ASSISTANT GÉNÉRAL
// Le GET rend aussi les dossiers ouverts de SUIVI (même base, lecture seule) pour rapprocher les rendez-vous du jour.
//                     { action: 'retrograde', id, valeur: true|false }
// Accès : en-tête x-assistant-code comparé à la variable ASSISTANT_CODE_ADMIN (JFD seul).
// Règle du report (23/10/2026) : un point reporté revient seul dans la liste au bout de TROIS JOURS,
// sauf report explicite (mode vocal : points « sur PC » reportés au LENDEMAIN À 9 H, date calculée par la page).
'use strict';
const crypto = require('crypto');

let sqlInjecte = null; // pour les essais
function db() {
  if (sqlInjecte) return sqlInjecte;
  const { neon } = require('@neondatabase/serverless');
  return neon(process.env.DATABASE_URL);
}
const STATUTS = ['ouvert', 'tranche', 'reporte', 'pc'];
const REPORT_JOURS = 3;
const JOUR = 86400000;
function texte(v, max) { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : ''; }
function instantFutur(v) {
  const t = Date.parse(String(v || ''));
  if (isNaN(t) || t < Date.now() - 60000 || t > Date.now() + 31 * JOUR) return null;
  return new Date(t).toISOString();
}

function codeValide(recu) {
  const attendu = process.env.ASSISTANT_CODE_ADMIN || '';
  if (!attendu || typeof recu !== 'string') return false;
  const a = crypto.createHash('sha256').update(recu).digest();
  const b = crypto.createHash('sha256').update(attendu).digest();
  return crypto.timingSafeEqual(a, b);
}
function repondre(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
function corps(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') { try { return Promise.resolve(JSON.parse(req.body)); } catch (e) { return Promise.resolve({}); } }
  return new Promise(function (ok) {
    let d = '';
    req.on('data', function (c) { d += c; if (d.length > 100000) req.destroy(); });
    req.on('end', function () { try { ok(JSON.parse(d || '{}')); } catch (e) { ok({}); } });
    req.on('error', function () { ok({}); });
  });
}

async function traiter(req, res) {
  if (!process.env.ASSISTANT_CODE_ADMIN) return repondre(res, 503, { erreur: 'Accès non configuré (variable ASSISTANT_CODE_ADMIN absente).' });
  if (!codeValide(req.headers['x-assistant-code'])) {
    await new Promise(function (ok) { setTimeout(ok, 400); });
    return repondre(res, 401, { erreur: 'Code incorrect.' });
  }
  if (!sqlInjecte && !process.env.DATABASE_URL) return repondre(res, 503, { erreur: 'Base non configurée (variable DATABASE_URL absente).' });
  const sql = db();

  if (req.method === 'GET') {
    const etats = await sql`SELECT point_id, statut, reporte_jusqu, retrograde, maj_le FROM assistant_etat`;
    const notes = await sql`SELECT id, appli, texte, cree_le FROM assistant_note ORDER BY id`;
    const rappels = await sql`SELECT id, prevu_le, ids FROM assistant_rappel WHERE vu_le IS NULL ORDER BY prevu_le`;
    let contacts = [], dossiers = [];
    try { contacts = await sql`SELECT adresse, nom, qualite, civilite, prenom, ajoute, masque FROM assistant_contact`; } catch (e) { contacts = []; }
    /* lecture seule des dossiers de SUIVI ; si la table manque ou change, l'ASSISTANT continue sans */
    try { dossiers = await sql`SELECT id, intitule, partie1, partie2 FROM suivi_dossier WHERE etape NOT IN ('abandonne', 'clos')`; } catch (e) { dossiers = []; }
    /* gestes des huit derniers jours, pour le bilan du vendredi */
    let semaine = [];
    try { semaine = await sql`SELECT point_id, action, valeur, fait_le FROM assistant_action WHERE fait_le >= now() - interval '8 days' AND action IN ('statut', 'fusion') ORDER BY fait_le`; } catch (e) { semaine = []; }
    /* bilan du matin : le dernier jour relevé par api/bilan.js */
    let bilan = [];
    try { bilan = await sql`SELECT jour, nom, type, etat, ms, code, detail, incidents_24h, releve_le FROM assistant_bilan WHERE jour = (SELECT max(jour) FROM assistant_bilan) ORDER BY type DESC, nom`; } catch (e) { bilan = []; }
    let distincts = [];
    try { distincts = await sql`SELECT point_id, valeur FROM assistant_action WHERE action = 'pas_doublon'`; } catch (e) { distincts = []; }
    return repondre(res, 200, { etats: etats, notes: notes, rappels: rappels, contacts: contacts, dossiers: dossiers, distincts: distincts, semaine: semaine, bilan: bilan });
  }
  if (req.method !== 'POST') return repondre(res, 405, { erreur: 'Méthode refusée.' });

  const b = await corps(req);
  if (b.action === 'note') {
    const appli = texte(b.appli, 40).toUpperCase() || 'DIVERS';
    const t = texte(b.texte, 2000);
    if (!t) return repondre(res, 400, { erreur: 'Note vide.' });
    const r = await sql`INSERT INTO assistant_note (appli, texte) VALUES (${appli}, ${t}) RETURNING id, appli, texte, cree_le`;
    return repondre(res, 200, { ok: true, note: r[0] });
  }
  if (b.action === 'rappel') {
    const quand = instantFutur(b.prevu_le);
    if (!quand) return repondre(res, 400, { erreur: 'Heure de rappel invalide.' });
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter(x => /^[A-Za-z0-9._:-]{1,80}$/.test(x)).slice(0, 200);
    const r = await sql`INSERT INTO assistant_rappel (prevu_le, ids) VALUES (${quand}, ${ids}) RETURNING id, prevu_le, ids`;
    return repondre(res, 200, { ok: true, rappel: r[0] });
  }
  if (b.action === 'rappel_vu') {
    const n = parseInt(b.id, 10);
    if (!(n > 0)) return repondre(res, 400, { erreur: 'Rappel inconnu.' });
    await sql`UPDATE assistant_rappel SET vu_le = now() WHERE id = ${n} AND vu_le IS NULL`;
    return repondre(res, 200, { ok: true });
  }
  if (b.action === 'fusion' || b.action === 'pas_doublon') {
    const garde = String(b.id || '').trim(), autre = String(b.autre || '').trim();
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(garde) || !/^[A-Za-z0-9._:-]{1,80}$/.test(autre) || garde === autre) return repondre(res, 400, { erreur: 'Points invalides.' });
    if (b.action === 'pas_doublon') {
      const [x, y] = [garde, autre].sort();
      await sql`INSERT INTO assistant_action (point_id, action, valeur) VALUES (${x}, 'pas_doublon', ${y})`;
      return repondre(res, 200, { ok: true });
    }
    /* fusion validée par JFD : le point retiré passe en « tranché » (rien n'est effacé), la trace dit avec quel point il a été fusionné */
    const r = await sql`INSERT INTO assistant_etat (point_id, statut, reporte_jusqu, maj_le) VALUES (${autre}, 'tranche', ${null}, now())
      ON CONFLICT (point_id) DO UPDATE SET statut = 'tranche', reporte_jusqu = NULL, maj_le = now()
      RETURNING point_id, statut, reporte_jusqu, retrograde, maj_le`;
    await sql`INSERT INTO assistant_action (point_id, action, valeur) VALUES (${autre}, 'fusion', ${garde})`;
    return repondre(res, 200, { ok: true, etat: r[0] });
  }
  if (b.action === 'contact') {
    const adresse = texte(b.adresse, 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adresse)) return repondre(res, 400, { erreur: 'Adresse invalide.' });
    const QUALITES = ['confrere', 'client', 'prenom_vous', 'prenom_tu', 'collegue', 'aucune'];
    const qualite = QUALITES.indexOf(b.qualite) >= 0 ? b.qualite : null;
    const civilite = b.civilite === 'Madame' || b.civilite === 'Monsieur' ? b.civilite : null;
    const nom = texte(b.nom, 120) || null, prenom = texte(b.prenom, 60) || null;
    const ajoute = b.ajoute === true, masque = b.masque === true;
    const r = await sql`INSERT INTO assistant_contact (adresse, nom, qualite, civilite, prenom, ajoute, masque, maj_le)
      VALUES (${adresse}, ${nom}, ${qualite}, ${civilite}, ${prenom}, ${ajoute}, ${masque}, now())
      ON CONFLICT (adresse) DO UPDATE SET
        nom = COALESCE(EXCLUDED.nom, assistant_contact.nom),
        qualite = COALESCE(EXCLUDED.qualite, assistant_contact.qualite),
        civilite = COALESCE(EXCLUDED.civilite, assistant_contact.civilite),
        prenom = COALESCE(EXCLUDED.prenom, assistant_contact.prenom),
        ajoute = assistant_contact.ajoute OR EXCLUDED.ajoute,
        masque = EXCLUDED.masque, maj_le = now()
      RETURNING adresse, nom, qualite, civilite, prenom, ajoute, masque`;
    return repondre(res, 200, { ok: true, contact: r[0] });
  }
  const id = String(b.id || '').trim();
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(id)) return repondre(res, 400, { erreur: 'Identifiant de point invalide.' });

  if (b.action === 'statut') {
    const s = String(b.statut || '');
    if (STATUTS.indexOf(s) < 0) return repondre(res, 400, { erreur: 'Statut inconnu.' });
    let jusqu = null;
    if (s === 'reporte') {
      jusqu = b.jusqu !== undefined ? instantFutur(b.jusqu) : new Date(Date.now() + REPORT_JOURS * JOUR).toISOString();
      if (!jusqu) return repondre(res, 400, { erreur: 'Date de report invalide.' });
    }
    const r = await sql`INSERT INTO assistant_etat (point_id, statut, reporte_jusqu, maj_le)
      VALUES (${id}, ${s}, ${jusqu}, now())
      ON CONFLICT (point_id) DO UPDATE SET statut = EXCLUDED.statut, reporte_jusqu = EXCLUDED.reporte_jusqu, maj_le = now()
      RETURNING point_id, statut, reporte_jusqu, retrograde, maj_le`;
    await sql`INSERT INTO assistant_action (point_id, action, valeur) VALUES (${id}, 'statut', ${s})`;
    return repondre(res, 200, { ok: true, etat: r[0] });
  }
  if (b.action === 'retrograde') {
    const v = !!b.valeur;
    const r = await sql`INSERT INTO assistant_etat (point_id, retrograde, maj_le)
      VALUES (${id}, ${v}, now())
      ON CONFLICT (point_id) DO UPDATE SET retrograde = EXCLUDED.retrograde, maj_le = now()
      RETURNING point_id, statut, reporte_jusqu, retrograde, maj_le`;
    await sql`INSERT INTO assistant_action (point_id, action, valeur) VALUES (${id}, 'retrograde', ${v ? 'oui' : 'non'})`;
    return repondre(res, 200, { ok: true, etat: r[0] });
  }
  return repondre(res, 400, { erreur: 'Action inconnue.' });
}

module.exports = async function handler(req, res) {
  try { await traiter(req, res); }
  catch (e) {
    console.error('ASSISTANT', e);
    repondre(res, 500, { erreur: 'La base de données ne répond pas. Réessayez dans un instant.' });
  }
};
module.exports._injecter = function (s) { sqlInjecte = s; };
