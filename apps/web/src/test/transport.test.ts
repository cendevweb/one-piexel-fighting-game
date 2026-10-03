import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, DEFAULT_ICE, codeFromText, inviteUrl, makeRoomCode, peerConfig, peerIdFor } from '../net/peer-config';
import { OFFICIAL_URL, publicUrlFrom } from '../net/public-url';

describe('room codes', () => {
    it('are six unambiguous characters', () => {
        let seed = 1;
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 200; i++) {
            const c = makeRoomCode(rand);
            expect(c).toHaveLength(CODE_LENGTH);
            expect([...c].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
            expect(c).not.toMatch(/[ILO01]/);
        }
    });

    it('are found in typed text and in invite links', () => {
        expect(codeFromText('abc def')).toBe('ABCDEF');
        expect(codeFromText('ABC-DEF')).toBe('ABCDEF');
        expect(codeFromText('https://x.app/?salon=K7P2QM')).toBe('K7P2QM');
        expect(codeFromText('http://127.0.0.1:5201/?peer=127.0.0.1:9000&salon=k7p2qm')).toBe('K7P2QM');
        expect(codeFromText('https://x.app/?spectateur=K7P2QM')).toBe('K7P2QM');
        expect(codeFromText('ABCDE')).toBeNull();
        expect(codeFromText('ABCDE0')).toBeNull();
    });

    it('map to namespaced peer ids and invite links', () => {
        expect(peerIdFor('K7P2QM')).toBe('onepeaxel-salon-k7p2qm');
        const loc = { origin: 'https://game.example', pathname: '/' };
        expect(inviteUrl('K7P2QM', loc)).toBe('https://game.example/?salon=K7P2QM');
        expect(inviteUrl('K7P2QM', loc, undefined, OFFICIAL_URL, 'spectateur')).toBe('https://www.one-piexel.gg/?spectateur=K7P2QM');
        const debug = inviteUrl('K7P2QM', loc, '127.0.0.1:9000');
        expect(codeFromText(debug)).toBe('K7P2QM');
        expect(new URL(debug).searchParams.get('peer')).toBe('127.0.0.1:9000');
    });

    it('point at the public address, not a private deployment URL', () => {
        const loc = { origin: 'https://web-abc123-team.vercel.app', pathname: '/' };
        expect(inviteUrl('K7P2QM', loc, undefined, OFFICIAL_URL)).toBe('https://www.one-piexel.gg/?salon=K7P2QM');
        expect(inviteUrl('K7P2QM', loc, undefined, '')).toBe('https://web-abc123-team.vercel.app/?salon=K7P2QM');
        // A local broker only works on the page that set it.
        const local = { origin: 'http://127.0.0.1:5173', pathname: '/' };
        expect(inviteUrl('K7P2QM', local, '127.0.0.1:9000', OFFICIAL_URL)).toBe('http://127.0.0.1:5173/?peer=127.0.0.1:9000&salon=K7P2QM');
    });
});

describe('peer config', () => {
    it('defaults to the PeerJS cloud and Google STUN', () => {
        const c = peerConfig({}, '');
        expect(c.host).toBeUndefined();
        expect(c.iceServers).toEqual(DEFAULT_ICE);
    });

    it('reads the VITE_PEER_* variables', () => {
        const c = peerConfig({
            VITE_PEER_HOST: 'peer.onrender.com', VITE_PEER_PATH: '/salon',
            VITE_ICE_SERVERS: '[{"urls":"turn:t.example:3478","username":"u","credential":"p"}]'
        }, '');
        expect(c).toMatchObject({ host: 'peer.onrender.com', port: 443, secure: true, path: '/salon' });
        expect(c.iceServers[0].urls).toBe('turn:t.example:3478');
        expect(peerConfig({ VITE_PEER_HOST: 'localhost', VITE_PEER_PORT: '9000' }, '')).toMatchObject({ port: 9000, secure: false });
    });

    it('?peer= points at a local server without STUN', () => {
        const c = peerConfig({}, '?peer=127.0.0.1:9000&salon=ABCDEF');
        expect(c).toMatchObject({ host: '127.0.0.1', port: 9000, path: '/', secure: false, iceServers: [], debugPeer: '127.0.0.1:9000' });
    });

    it('ignores ?peer= on the public site (production build)', () => {
        const c = peerConfig({}, '?peer=evil.example:443&salon=ABCDEF', 'one-piexel.vercel.app');
        expect(c.host).toBeUndefined();
        expect(c.debugPeer).toBeUndefined();
        expect(c.iceServers.length).toBeGreaterThan(0);
        expect(peerConfig({ DEV: true }, '?peer=127.0.0.1:9000', 'one-piexel.vercel.app').host).toBe('127.0.0.1');
    });

    it('use the official domain on every Vercel build', () => {
        expect(OFFICIAL_URL).toBe('https://www.one-piexel.gg');
        expect(publicUrlFrom({ VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'web-kappa-blush-23.vercel.app' })).toBe(OFFICIAL_URL);
        expect(publicUrlFrom({ VERCEL: '1', VITE_PUBLIC_URL: ' https://autre.example ' })).toBe('https://autre.example');
        expect(publicUrlFrom({})).toBe('');
    });
});
