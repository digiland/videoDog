import { Injectable } from '@nestjs/common';
import {
  S3Client,
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream, statSync } from 'fs';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly videoBucket: string;
  private readonly thumbBucket: string;

  constructor() {
    const endpoint = process.env.MINIO_ENDPOINT ?? 'http://localhost:9000';
    const region = process.env.MINIO_REGION ?? 'us-east-1';
    this.s3 = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
        secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
      },
      forcePathStyle: true, // MinIO requires path-style
      // AWS SDK ≥3.729 adds CRC checksums by default, sending streamed uploads as
      // `aws-chunked` with a trailer. S3-compatible stores (MinIO/RustFS versions, test
      // servers) may store those framing bytes inside the object, corrupting video files.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    this.videoBucket = process.env.MINIO_BUCKET_VIDEOS ?? 'streamzw-videos';
    this.thumbBucket = process.env.MINIO_BUCKET_THUMBS ?? 'streamzw-thumbs';
  }

  get videoBucketName(): string {
    return this.videoBucket;
  }

  get thumbBucketName(): string {
    return this.thumbBucket;
  }

  async getPresignedPutUrl(bucket: string, key: string, ttlSeconds = 3600): Promise<string> {
    const cmd = new PutObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.s3, cmd, { expiresIn: ttlSeconds });
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async getPresignedGetUrl(bucket: string, key: string, ttlSeconds = 3600): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.s3, cmd, { expiresIn: ttlSeconds });
  }

  async uploadBuffer(
    bucket: string,
    key: string,
    data: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    });
    await this.s3.send(cmd);
  }

  async download(bucket: string, key: string): Promise<Buffer> {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const result = await this.s3.send(cmd);
    if (!result.Body) throw new Error(`Empty object: ${bucket}/${key}`);
    const chunks: Uint8Array[] = [];
    // @ts-expect-error - Body is a stream
    for await (const chunk of result.Body) {
      chunks.push(chunk as Uint8Array);
    }
    return Buffer.concat(chunks);
  }

  /** Stream an object to disk without holding it in memory (originals can be gigabytes). */
  async downloadToFile(bucket: string, key: string, filePath: string): Promise<void> {
    const result = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) throw new Error(`Empty object: ${bucket}/${key}`);
    await pipeline(result.Body as Readable, createWriteStream(filePath));
  }

  /** Stream a file from disk to the bucket. */
  async uploadFile(
    bucket: string,
    key: string,
    filePath: string,
    contentType: string,
  ): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentLength: statSync(filePath).size,
        ContentType: contentType,
      }),
    );
  }

  // ─── Multipart (resumable) uploads ─────────────────────────────────────────

  async createMultipart(bucket: string, key: string, contentType: string): Promise<string> {
    const res = await this.s3.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    );
    if (!res.UploadId) throw new Error('No UploadId from storage');
    return res.UploadId;
  }

  presignPart(bucket: string, key: string, uploadId: string, partNumber: number, ttl: number) {
    return getSignedUrl(
      this.s3,
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: ttl },
    );
  }

  /** Parts already stored — lets a client resume after a dropped connection. */
  async listParts(bucket: string, key: string, uploadId: string) {
    const parts: { partNumber: number; etag: string; size: number }[] = [];
    let marker: string | undefined;
    do {
      const res = await this.s3.send(
        new ListPartsCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const p of res.Parts ?? []) {
        if (p.PartNumber && p.ETag)
          parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size ?? 0 });
      }
      marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
    } while (marker);
    return parts;
  }

  async completeMultipart(
    bucket: string,
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipart(bucket: string, key: string, uploadId: string): Promise<void> {
    await this.s3.send(
      new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
    );
  }
}
