declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    UAZAPI_SERVER_URL?: string;
    UAZAPI_INSTANCE_TOKEN?: string;
  }
}
