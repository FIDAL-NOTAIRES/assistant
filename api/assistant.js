// ASSISTANT — fonction serveur unique (lot 1, ASSISTANT OUTIL, 23/10/2026).
// GET  /api/assistant                                   → { etats: [...] }
// POST /api/assistant { action: 'statut', id, statut }  statut = ouvert | tranche | reporte | pc
//                     { action: 'retrograde', id, valeur: true|false }
// Accès : en-tête x-assistant-code comparé à la variable ASSISTANT_CODE_ADMIN (JFD seul).
// Règle du report (23/10/2026) : un point reporté revient seul dans la liste au bout de TROIS JOURS.
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
    return repondre(res, 200, { etats: etats });
  }
  if (req.method !== 'POST') return repondre(res, 405, { erreur: 'Méthode refusée.' });

  const b = await corps(req);
  const id = String(b.id || '').trim();
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(id)) return repondre(res, 400, { erreur: 'Identifiant de point invalide.' });

  if (b.action === 'statut') {
    const s = String(b.statut || '');
    if (STATUTS.indexOf(s) < 0) return repondre(res, 400, { erreur: 'Statut inconnu.' });
    const jusqu = s === 'reporte' ? new Date(Date.now() + REPORT_JOURS * 86400000).toISOString() : null;
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
