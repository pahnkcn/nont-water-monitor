import { Redis } from "@upstash/redis";

// The handful of Redis operations this app needs. Backed by Upstash when its
// env vars exist (UPSTASH_REDIS_REST_* or the KV_REST_API_* names the Vercel
// Marketplace integration sets), otherwise by process memory for local dev.

export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  /** Set only if absent, expiring after `ex` seconds. Returns true when set. */
  setNX(key: string, value: unknown, ex: number): Promise<boolean>;
  del(key: string): Promise<void>;
  zadd(key: string, score: number, member: unknown): Promise<void>;
  zrangeByScore<T>(key: string, min: number, max: number): Promise<T[]>;
  zremBelow(key: string, maxScore: number): Promise<void>;
  hgetall<T>(key: string): Promise<Record<string, T>>;
  hget<T>(key: string, field: string): Promise<T | null>;
  hset(key: string, entries: Record<string, unknown>): Promise<void>;
  hdel(key: string, ...fields: string[]): Promise<void>;
  hlen(key: string): Promise<number>;
  lpushTrim(key: string, value: unknown, max: number): Promise<void>;
  lrange<T>(key: string, start: number, stop: number): Promise<T[]>;
}

function upstash(redis: Redis): KV {
  return {
    get: (k) => redis.get(k),
    set: async (k, v) => {
      await redis.set(k, v);
    },
    setNX: async (k, v, ex) => (await redis.set(k, v, { nx: true, ex })) === "OK",
    del: async (k) => {
      await redis.del(k);
    },
    zadd: async (k, score, member) => {
      await redis.zadd(k, { score, member });
    },
    zrangeByScore: (k, min, max) => redis.zrange(k, min, max, { byScore: true }),
    zremBelow: async (k, max) => {
      await redis.zremrangebyscore(k, "-inf", max);
    },
    hgetall: async <T,>(k: string) => ((await redis.hgetall(k)) ?? {}) as Record<string, T>,
    hget: (k, f) => redis.hget(k, f),
    hset: async (k, entries) => {
      if (Object.keys(entries).length) await redis.hset(k, entries);
    },
    hdel: async (k, ...fields) => {
      if (fields.length) await redis.hdel(k, ...fields);
    },
    hlen: (k) => redis.hlen(k),
    lpushTrim: async (k, v, max) => {
      const p = redis.pipeline();
      p.lpush(k, v);
      p.ltrim(k, 0, max - 1);
      await p.exec();
    },
    lrange: (k, start, stop) => redis.lrange(k, start, stop),
  };
}

type Mem = {
  strings: Map<string, { v: unknown; exp: number | null }>;
  zsets: Map<string, { score: number; member: unknown }[]>;
  hashes: Map<string, Map<string, unknown>>;
  lists: Map<string, unknown[]>;
};

function memory(): KV {
  const g = globalThis as unknown as { __nontKV?: Mem };
  const m: Mem = (g.__nontKV ??= { strings: new Map(), zsets: new Map(), hashes: new Map(), lists: new Map() });
  const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
  const live = (k: string) => {
    const e = m.strings.get(k);
    if (e && e.exp !== null && e.exp < Date.now()) {
      m.strings.delete(k);
      return undefined;
    }
    return e;
  };
  const hash = (k: string) => {
    let h = m.hashes.get(k);
    if (!h) m.hashes.set(k, (h = new Map()));
    return h;
  };
  return {
    get: async <T,>(k: string) => clone((live(k)?.v ?? null) as T | null),
    set: async (k, v) => void m.strings.set(k, { v: clone(v), exp: null }),
    setNX: async (k, v, ex) => {
      if (live(k)) return false;
      m.strings.set(k, { v, exp: Date.now() + ex * 1000 });
      return true;
    },
    del: async (k) => {
      m.strings.delete(k);
      m.zsets.delete(k);
      m.hashes.delete(k);
      m.lists.delete(k);
    },
    zadd: async (k, score, member) => {
      const z = m.zsets.get(k) ?? [];
      z.push({ score, member: clone(member) });
      z.sort((a, b) => a.score - b.score);
      m.zsets.set(k, z);
    },
    zrangeByScore: async <T,>(k: string, min: number, max: number) =>
      (m.zsets.get(k) ?? []).filter((e) => e.score >= min && e.score <= max).map((e) => clone(e.member) as T),
    zremBelow: async (k, max) => {
      m.zsets.set(k, (m.zsets.get(k) ?? []).filter((e) => e.score > max));
    },
    hgetall: async <T,>(k: string) => Object.fromEntries([...hash(k)].map(([f, v]) => [f, clone(v)])) as Record<string, T>,
    hget: async <T,>(k: string, f: string) => clone((hash(k).get(f) ?? null) as T | null),
    hset: async (k, entries) => {
      for (const [f, v] of Object.entries(entries)) hash(k).set(f, clone(v));
    },
    hdel: async (k, ...fields) => {
      for (const f of fields) hash(k).delete(f);
    },
    hlen: async (k) => hash(k).size,
    lpushTrim: async (k, v, max) => {
      const l = m.lists.get(k) ?? [];
      l.unshift(clone(v));
      m.lists.set(k, l.slice(0, max));
    },
    lrange: async <T,>(k: string, start: number, stop: number): Promise<T[]> =>
      (m.lists.get(k) ?? []).slice(start, stop === -1 ? undefined : stop + 1).map((v) => clone(v) as T),
  };
}

let instance: KV | null = null;

export function hasRedis() {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
      (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN),
  );
}

export function kv(): KV {
  if (!instance) instance = hasRedis() ? upstash(Redis.fromEnv()) : memory();
  return instance;
}

export const KEYS = {
  readings: "readings",
  state: "state",
  snapshot: "snapshot",
  snapshotMeta: "snapshot:meta",
  subs: "subs",
  config: "config",
  alertLog: "alerts:log",
  tickLock: "lock:tick",
} as const;
