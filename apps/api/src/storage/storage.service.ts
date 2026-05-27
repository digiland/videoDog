import { Injectable } from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
}
