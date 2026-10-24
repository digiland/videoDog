import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'crypto';

/**
 * AES-256-GCM for national ID numbers. KYC_ENCRYPTION_KEY is 32 random bytes, base64
 * (`openssl rand -base64 32`). Encryption and lookup keys are derived separately (HKDF) so
 * the dedupe hash can't be used to decrypt anything.
 */
export class NationalIdCrypto {
  private readonly encKey: Buffer;
  private readonly lookupKey: Buffer;

  constructor(base64Key: string) {
    const master = Buffer.from(base64Key, 'base64');
    if (master.length !== 32) throw new Error('KYC_ENCRYPTION_KEY must be 32 bytes, base64');
    this.encKey = Buffer.from(hkdfSync('sha256', master, '', 'streamzw:national-id:enc', 32));
    this.lookupKey = Buffer.from(hkdfSync('sha256', master, '', 'streamzw:national-id:lookup', 32));
  }

  static fromEnv(): NationalIdCrypto | null {
    const key = process.env.KYC_ENCRYPTION_KEY;
    return key ? new NationalIdCrypto(key) : null;
  }

  encrypt(plaintext: string, userId: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    cipher.setAAD(Buffer.from(userId)); // binds the ciphertext to its row's owner
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag() };
  }

  decrypt(row: { ciphertext: Buffer; iv: Buffer; authTag: Buffer }, userId: string): string {
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, row.iv);
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(row.authTag);
    return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8');
  }

  lookupHash(normalised: string): string {
    return createHmac('sha256', this.lookupKey).update(normalised).digest('hex');
  }
}

/**
 * Zimbabwe national ID, e.g. "63-123456 A 12" / "63-1234567-A-12": district code, serial,
 * check letter, origin code. Returns the canonical form or null.
 */
export function normaliseZimNationalId(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, '');
  return /^\d{2}\d{6,7}[A-Z]\d{2}$/.test(compact) ? compact : null;
}
