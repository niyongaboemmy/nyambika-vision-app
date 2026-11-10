import { Global, Injectable, Module } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { config } from "../config";

/**
 * Local stand-in for the S3-compatible object store (plan §4.1).
 * `public/` holds member-owned catalogue media; `private/` holds personal data
 * (twins encrypted with AES-256-GCM, generated looks) reachable only via short-lived signed URLs.
 */
@Injectable()
export class StorageService {
  readonly root = resolve(config.storageDir);

  private safe(rel: string) {
    const p = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
    return join(this.root, p);
  }

  async put(rel: string, data: Buffer) {
    const full = this.safe(rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    return rel;
  }

  read(rel: string) {
    return readFile(this.safe(rel));
  }

  async remove(rel: string) {
    await rm(this.safe(rel), { force: true });
  }

  publicUrl(rel: string | null | undefined) {
    return rel ? `/api/files/${rel}` : null;
  }

  async putEncrypted(rel: string, data: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", config.twinKey, iv);
    const enc = Buffer.concat([cipher.update(data), cipher.final()]);
    await this.put(rel, enc);
    return { iv: iv.toString("hex"), authTag: cipher.getAuthTag().toString("hex") };
  }

  async readEncrypted(rel: string, iv: string, authTag: string) {
    const decipher = createDecipheriv("aes-256-gcm", config.twinKey, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(authTag, "hex"));
    return Buffer.concat([decipher.update(await this.read(rel)), decipher.final()]);
  }

  /** Signed URL for private objects; expires after `signedUrlTtlSec` (≤ 5 min, plan §17). */
  sign(rel: string, kind: "look" | "twin") {
    const exp = Math.floor(Date.now() / 1000) + config.signedUrlTtlSec;
    const sig = createHmac("sha256", config.jwtSecret).update(`${kind}:${rel}:${exp}`).digest("hex");
    return `/api/private/${kind}?p=${encodeURIComponent(rel)}&exp=${exp}&sig=${sig}`;
  }

  verify(kind: string, rel: string, exp: string, sig: string) {
    if (Number(exp) < Date.now() / 1000) return false;
    const expected = createHmac("sha256", config.jwtSecret).update(`${kind}:${rel}:${exp}`).digest();
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
