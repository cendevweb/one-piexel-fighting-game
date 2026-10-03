/**
 * Where the two browsers meet, and how room codes and invite links look.
 *
 * Pure functions only (no PeerJS, no DOM access unless passed in), so the
 * tests can run them under Node.
 *
 * Configuration, all optional, through Vite env vars at build time:
 *   VITE_PEER_HOST     signalling host (default: the free PeerJS cloud, 0.peerjs.com)
 *   VITE_PEER_PORT     its port (default 443)
 *   VITE_PEER_PATH     its path (default "/")
 *   VITE_PEER_SECURE   "true" / "false" (default: true unless the host is local)
 *   VITE_PEER_KEY      API key of the PeerServer (default "peerjs")
 *   VITE_ICE_SERVERS   JSON array of RTCIceServer, e.g. to add a TURN server
 * and, for local tests (dev builds or pages served from localhost only), the
 * query parameter `?peer=host:port[/path]` which
 * points at a local PeerServer (`npm run peer:local`) and drops the STUN
 * servers (two browsers on one machine only need host candidates).
 */

export interface PeerConfig {
    /** Undefined: PeerJS's own cloud broker. */
    host?: string;
    port?: number;
    path?: string;
    secure?: boolean;
    key?: string;
    iceServers: RTCIceServer[];
    /** The `?peer=` value, kept so invite links carry it along. */
    debugPeer?: string;
}

export const DEFAULT_ICE: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
];

type Env = Record<string, string | boolean | undefined>;

const isLocal = (host: string) => host === 'localhost' || host.startsWith('127.') || host === '[::1]';

/**
 * `pageHost`: the host name of the page. The `?peer=` override is honoured
 * only by a dev build or a page served from this machine: on the public
 * site, an invite link must not be able to send both players through a
 * signalling server of the sender's choosing.
 */
export function peerConfig(env: Env, search: string, pageHost = 'localhost'): PeerConfig {
    const str = (k: string) => {
        const v = env[k];
        return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
    };
    const cfg: PeerConfig = { iceServers: DEFAULT_ICE };
    const host = str('VITE_PEER_HOST');
    if (host) {
        cfg.host = host;
        const port = Number(str('VITE_PEER_PORT'));
        cfg.port = Number.isInteger(port) && port > 0 ? port : undefined;
        cfg.secure = str('VITE_PEER_SECURE') ? str('VITE_PEER_SECURE') === 'true' : !isLocal(host);
        cfg.port ??= cfg.secure ? 443 : 80;
    }
    const path = str('VITE_PEER_PATH');
    if (path) cfg.path = path;
    const key = str('VITE_PEER_KEY');
    if (key) cfg.key = key;
    const ice = str('VITE_ICE_SERVERS');
    if (ice) {
        try {
            const parsed = JSON.parse(ice) as unknown;
            if (Array.isArray(parsed)) cfg.iceServers = parsed as RTCIceServer[];
        } catch {
            console.warn('VITE_ICE_SERVERS n\'est pas du JSON valide ; serveurs STUN par défaut.');
        }
    }
    // Debug override: ?peer=127.0.0.1:9000 or ?peer=host:port/path
    const debugAllowed = env.DEV === true || isLocal(pageHost);
    const debug = debugAllowed ? new URLSearchParams(search).get('peer') : null;
    const m = debug?.match(/^([^:/]+):(\d+)(\/.*)?$/);
    if (debug && m) {
        cfg.host = m[1];
        cfg.port = Number(m[2]);
        cfg.path = m[3] ?? '/';
        cfg.secure = !isLocal(m[1]) && m[2] === '443';
        if (!ice) cfg.iceServers = [];
        cfg.debugPeer = debug;
    }
    return cfg;
}

// ——— Room codes ———

/** No I, L, O, 0, 1: nothing that reads two ways when dictated. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
/** Peer ids on the shared broker are namespaced to this game. */
export const PEER_PREFIX = 'onepeaxel-salon-';

export function makeRoomCode(rand: () => number = Math.random): string {
    let s = '';
    for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
    return s;
}

/**
 * The code in whatever the player typed or pasted: a bare code (any case,
 * with spaces or dashes) or a whole invite link. Null when no valid code
 * is found.
 */
export function codeFromText(text: string): string | null {
    const fromUrl = text.match(/[?&](?:salon|spectateur)=([A-Za-z0-9-]+)/i);
    const raw = (fromUrl ? fromUrl[1] : text).toUpperCase().replace(/[\s-]/g, '');
    if (raw.length !== CODE_LENGTH) return null;
    return [...raw].every((c) => CODE_ALPHABET.includes(c)) ? raw : null;
}

export function peerIdFor(code: string): string {
    return PEER_PREFIX + code.toLowerCase();
}

/**
 * The link to send to the other player: `?salon=CODE` on the game's public
 * address when one is known, on this page otherwise. The page's own URL
 * may be a private deployment URL the other player cannot open. A local
 * debug broker (`debugPeer`) keeps the link on this page, the only one that
 * honours `?peer=`. `param`: `spectateur` for the spectator's link.
 */
export function inviteUrl(code: string, loc: { origin: string; pathname: string }, debugPeer?: string, publicUrl?: string, param: 'salon' | 'spectateur' = 'salon'): string {
    const base = !debugPeer && publicUrl ? new URL(publicUrl) : loc;
    // host:port is URL-safe as is; left unencoded so the link stays readable.
    const peer = debugPeer ? `peer=${debugPeer}&` : '';
    return `${base.origin}${base.pathname}?${peer}${param}=${code}`;
}
