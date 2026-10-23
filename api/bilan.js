// ASSISTANT — bilan quotidien (23/10/2026). Décision : UNE SEULE tâche, dans l'ASSISTANT, fait chaque matin le relevé
// pour toute la suite (au lieu d'une tâche par appli : une seule tâche par jour et par projet sur l'offre gratuite de
// Vercel, et beaucoup d'applis n'ont pas de partie serveur).
// Sources : la sonde de MORNING (chaque service et source répond-il ?) et le journal commun des incidents (table incident,
// même base Neon). Résultat : une ligne par service ou source dans assistant_bilan, pour le jour.
// Déclenchement : la tâche automatique de Vercel (vercel.json, vers 6 h – 7 h) ou un clic « Relever maintenant »
// (en-tête x-assistant-code). Si la variable CRON_SECRET est posée, la tâche automatique doit la présenter.
'use strict';
const crypto = require('crypto');
const SONDE = 'https://connexion-omega.vercel.app/api/sante';

let sqlInjecte = null, fetchInjecte = null;
function db() { if (sqlInjecte) return sqlInjecte; const { neon } = require('@neondatabase/serverless'); return neon(process.env.DATABASE_URL); }
function egal(a, b) { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); }
function autorise(req) {
  const code = process.env.ASSISTANT_CODE_ADMIN, secret = process.env.CRON_SECRET;
  if (code && typeof req.headers['x-assistant-code'] === 'string' && egal(req.headers['x-assistant-code'], code)) return 'main';
  const auth = String(req.headers.authorization || '');
  if (secret) return auth === 'Bearer ' + secret || egal(auth, 'Bearer ' + secret) ? 'tache' : null;
  return req.headers['user-agent'] && /vercel-cron/i.test(req.headers['user-agent']) ? 'tache' : null;
}
function repondre(res, code, obj) { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); }
function jourParis(d) { return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date()); }

async function lireSonde() {
  const f = fetchInjecte || fetch;
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 28000);
  try { const r = await f(SONDE, { signal: c.signal }); if (!r.ok) throw new Error('sonde ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

async function relever() {
  const sql = db();
  const jour = jourParis();
  let sonde = null, erreur = null;
  try { sonde = await lireSonde(); } catch (e) { erreur = 'sonde de MORNING injoignable : ' + e.message; }
  let incidents = [];
  try { incidents = await sql`SELECT outil, count(*)::int AS n FROM incident WHERE ouvert_le >= now() - interval '24 hours' OR clos_le IS NULL OR clos_le >= now() - interval '24 hours' GROUP BY outil`; } catch (e) { incidents = []; }
  const parOutil = {}; incidents.forEach(i => { parOutil[i.outil] = i.n; });
  const lignes = [];
  if (sonde) {
    (sonde.services || []).forEach(s => lignes.push({ nom: s.nom, type: 'service', etat: s.etat || 'inconnu', ms: s.ms || null, code: s.code || null, detail: (s.detail || []).map(d => d.texte).join(' ; ') || s.erreur || null }));
    (sonde.sources || []).forEach(s => lignes.push({ nom: s.nom, type: 'source', etat: s.etat || 'inconnu', ms: s.ms || null, code: s.code || null, detail: s.erreur || null }));
  }
  for (const l of lignes) {
    l.incidents_24h = parOutil[l.nom] || 0;
    await sql`INSERT INTO assistant_bilan (jour, nom, type, etat, ms, code, detail, incidents_24h, releve_le)
      VALUES (${jour}, ${l.nom}, ${l.type}, ${String(l.etat).slice(0, 20)}, ${l.ms}, ${l.code}, ${l.detail ? String(l.detail).slice(0, 500) : null}, ${l.incidents_24h}, now())
      ON CONFLICT (jour, nom) DO UPDATE SET type = EXCLUDED.type, etat = EXCLUDED.etat, ms = EXCLUDED.ms, code = EXCLUDED.code,
        detail = EXCLUDED.detail, incidents_24h = EXCLUDED.incidents_24h, releve_le = now()`;
  }
  return { jour, releves: lignes.length, en_panne: lignes.filter(l => l.etat === 'ko').map(l => l.nom), erreur };
}

module.exports = async function handler(req, res) {
  try {
    if (!process.env.DATABASE_URL && !sqlInjecte) return repondre(res, 503, { erreur: 'Base non configurée.' });
    if (!autorise(req)) return repondre(res, 401, { erreur: 'Accès refusé.' });
    const r = await relever();
    return repondre(res, r.erreur && !r.releves ? 502 : 200, Object.assign({ ok: !r.erreur }, r));
  } catch (e) {
    console.error('ASSISTANT bilan', e);
    return repondre(res, 500, { erreur: 'Relevé impossible : la base ne répond pas.' });
  }
};
module.exports._injecter = (s, f) => { sqlInjecte = s; fetchInjecte = f || null; };
module.exports._jourParis = jourParis;
