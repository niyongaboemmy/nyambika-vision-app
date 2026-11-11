import { MEASUREMENT_FIELDS, type Measurements } from "@nyambika/contracts";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../../config";

/**
 * Field-level encryption for measurement profiles (FR-SIZE-08, SRS §10): every value is sealed on its
 * own with AES-256-GCM under TWIN_KEY (the same key and scheme as twin images), so a database dump
 * reveals neither values nor which fields are equal across shoppers (fresh IV per field).
 */
export function encryptField(value: string, key = config.twinKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ct.toString("base64")}`;
}

export function decryptField(sealed: string, key = config.twinKey) {
  const [v, iv, tag, ct] = sealed.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unknown measurement encoding");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

export function sealMeasurements(m: Measurements, key = config.twinKey) {
  const out: Record<string, string> = {};
  for (const f of MEASUREMENT_FIELDS) if (m[f] !== undefined) out[f] = encryptField(String(m[f]), key);
  return out;
}

export function openMeasurements(fields: unknown, key = config.twinKey): Measurements {
  const out: Measurements = {};
  const rec = (fields ?? {}) as Record<string, string>;
  for (const f of MEASUREMENT_FIELDS) if (typeof rec[f] === "string") out[f] = Number(decryptField(rec[f], key));
  return out;
}
