/**
 * momopay.js — asking a phone to pay (SALJOE TECH selling Tallix licences; the same as Tallix lib/momo.js): MTN MoMo (Collections API) and
 * Airtel Money (Collections API). The payer gets a prompt on their phone and
 * approves with their PIN; the request is then checked until it is paid or
 * refused. Keys come from the school's own MTN and Airtel developer accounts.
 *
 * Written from the providers' published APIs; not yet tried against the live
 * services with a school's keys — the first school to connect checks it.
 */
import crypto from "node:crypto";

/** Which network a Ugandan number is on: MTN 076/077/078/039, Airtel 070/074/075/020. */
function networkOf(phone) {
  const n = String(phone || "").replace(/\D/g, "").replace(/^256/, "").replace(/^0/, "");
  if (/^(76|77|78|39)\d{7}$/.test(n)) return "mtn";
  if (/^(70|74|75|20)\d{7}$/.test(n)) return "airtel";
  return null;
}
const msisdn = (phone) => "256" + String(phone || "").replace(/\D/g, "").replace(/^256/, "").replace(/^0/, "");

async function j(r) { const t = await r.text(); try { return t ? JSON.parse(t) : {}; } catch { return { raw: t }; } }
const fail = (msg) => { const e = new Error(msg); e.provider = true; throw e; };

/* ── MTN MoMo ── */
const MTN_BASE = { sandbox: "https://sandbox.momodeveloper.mtn.com", live: "https://proxy.momoapi.mtn.com" };
const tokens = new Map();
async function mtnToken(c) {
  const k = "mtn:" + c.user;
  const t = tokens.get(k);
  if (t && t.until > Date.now()) return t.token;
  const r = await fetch(`${MTN_BASE[c.env] || MTN_BASE.live}/collection/token/`, { method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${c.user}:${c.secret}`).toString("base64"), "Ocp-Apim-Subscription-Key": c.key } });
  const b = await j(r);
  if (!r.ok || !b.access_token) fail(`MTN did not accept the SALJOE keys (${r.status}${b.message ? ": " + b.message : ""}). Check the MTN keys.`);
  tokens.set(k, { token: b.access_token, until: Date.now() + (Number(b.expires_in || 3600) - 60) * 1000 });
  return b.access_token;
}
async function mtnRequest(c, { amount, phone, ref, note }) {
  const tok = await mtnToken(c);
  const r = await fetch(`${MTN_BASE[c.env] || MTN_BASE.live}/collection/v1_0/requesttopay`, { method: "POST",
    headers: { Authorization: "Bearer " + tok, "X-Reference-Id": ref, "X-Target-Environment": c.env === "sandbox" ? "sandbox" : (c.target || "mtnuganda"), "Ocp-Apim-Subscription-Key": c.key, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: String(Math.round(amount)), currency: c.env === "sandbox" ? "EUR" : "UGX", externalId: ref.slice(0, 30), payer: { partyIdType: "MSISDN", partyId: msisdn(phone) },
      payerMessage: String(note || "School fees").slice(0, 160), payeeNote: String(note || "School fees").slice(0, 160) }) });
  if (r.status !== 202 && !r.ok) { const b = await j(r); fail(`MTN refused the request (${r.status}${b.message ? ": " + b.message : ""})`); }
  return { ref };
}
async function mtnStatus(c, ref) {
  const tok = await mtnToken(c);
  const r = await fetch(`${MTN_BASE[c.env] || MTN_BASE.live}/collection/v1_0/requesttopay/${ref}`, {
    headers: { Authorization: "Bearer " + tok, "X-Target-Environment": c.env === "sandbox" ? "sandbox" : (c.target || "mtnuganda"), "Ocp-Apim-Subscription-Key": c.key } });
  const b = await j(r);
  if (!r.ok) fail(`MTN did not say how the request stands (${r.status})`);
  const s = String(b.status || "").toUpperCase();
  return { state: s === "SUCCESSFUL" ? "paid" : s === "FAILED" || s === "REJECTED" || s === "TIMEOUT" ? "failed" : "pending", reason: b.reason && (b.reason.message || b.reason), txn: b.financialTransactionId || null };
}

/* ── Airtel Money ── */
const AIRTEL_BASE = { sandbox: "https://openapiuat.airtel.africa", live: "https://openapi.airtel.africa" };
async function airtelToken(c) {
  const k = "airtel:" + c.id;
  const t = tokens.get(k);
  if (t && t.until > Date.now()) return t.token;
  const r = await fetch(`${AIRTEL_BASE[c.env] || AIRTEL_BASE.live}/auth/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify({ client_id: c.id, client_secret: c.secret, grant_type: "client_credentials" }) });
  const b = await j(r);
  if (!r.ok || !b.access_token) fail(`Airtel did not accept the SALJOE keys (${r.status}). Check the Airtel keys.`);
  tokens.set(k, { token: b.access_token, until: Date.now() + (Number(b.expires_in || 180) - 20) * 1000 });
  return b.access_token;
}
const airtelHead = (tok) => ({ Authorization: "Bearer " + tok, "X-Country": "UG", "X-Currency": "UGX", "Content-Type": "application/json", Accept: "*/*" });
async function airtelRequest(c, { amount, phone, ref, note }) {
  const tok = await airtelToken(c);
  const r = await fetch(`${AIRTEL_BASE[c.env] || AIRTEL_BASE.live}/merchant/v1/payments/`, { method: "POST", headers: airtelHead(tok),
    body: JSON.stringify({ reference: String(note || "School fees").slice(0, 60), subscriber: { country: "UG", currency: "UGX", msisdn: msisdn(phone).slice(3) },
      transaction: { amount: Math.round(amount), country: "UG", currency: "UGX", id: ref } }) });
  const b = await j(r);
  if (!r.ok || (b.status && b.status.success === false)) fail(`Airtel refused the request (${r.status}${b.status && b.status.message ? ": " + b.status.message : ""})`);
  return { ref };
}
async function airtelStatus(c, ref) {
  const tok = await airtelToken(c);
  const r = await fetch(`${AIRTEL_BASE[c.env] || AIRTEL_BASE.live}/standard/v1/payments/${ref}`, { headers: airtelHead(tok) });
  const b = await j(r);
  if (!r.ok) fail(`Airtel did not say how the request stands (${r.status})`);
  const t = (b.data && b.data.transaction) || {};
  const s = String(t.status || "").toUpperCase();
  return { state: s === "TS" ? "paid" : s === "TF" || s === "TE" ? "failed" : "pending", reason: t.message || null, txn: t.airtel_money_id || t.id || null };
}

/** A prompt to pay, sent to the phone's network. keys: { mtn: {key,user,secret,env}, airtel: {id,secret,env} } */
async function request(keys, { amount, phone, note }) {
  const net = networkOf(phone) || fail("That is not an MTN or Airtel number");
  const ref = crypto.randomUUID();
  if (net === "mtn") { if (!keys.mtn || !keys.mtn.key) fail("Connect MTN MoMo first (its keys)"); await mtnRequest(keys.mtn, { amount, phone, ref, note }); }
  else { if (!keys.airtel || !keys.airtel.id) fail("Connect Airtel Money first (its keys)"); await airtelRequest(keys.airtel, { amount, phone, ref, note }); }
  return { ref, network: net };
}
async function status(keys, network, ref) {
  return network === "mtn" ? mtnStatus(keys.mtn, ref) : airtelStatus(keys.airtel, ref);
}

export { networkOf, msisdn, request, status };
